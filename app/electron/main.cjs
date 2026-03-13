const path = require("node:path");
const {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
} = require("electron");

const {
  DEFAULT_SHORTCUT,
  LocalWorkspaceRepository,
} = require("./repositories/localWorkspaceRepository.cjs");
const { LocalAiAdapter } = require("./services/localAiAdapter.cjs");
const { CapturePipeline } = require("./services/capturePipeline.cjs");
const { getDesktopCopy, normalizeLanguage } = require("./i18n.cjs");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const trayIconDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAVFBMVEVHcEzOujvRu0DfuErz0V7DuDPopTDWrDLWrDPUujfku2LvwkXcqSzrwUDz4XLTvDTlzzPjyz3Syj7FtjHcty7WtTTVxDDOqSvQqCrRwSvNsivcvjDkzDSuQofPAAAAHHRSTlMAB3qRy6f+v8a4Iu/79hRGeRjdi0mDUGANwqMK+ds46QAAAHVJREFUGNNVzccSgCAMBNBoY0Ts+/7/00QJ2czMIHfAQQ5t96caGfXAOQgW8Twg5KJLOzFWB6C2b+DmQl3Q1nJ5VoQxk6zSQ1sRAUnRVsdr5LytM+7EV+hybMtn8gnna1uNtr9dNMaO0s9WQxh4H0DUuVwlpZoKJxe/G2MHMqEj59IAAAAASUVORK5CYII=";

let mainWindow = null;
let tray = null;
let isQuitting = false;

const repository = new LocalWorkspaceRepository(
  path.join(app.getPath("userData"), "canvas-inbox"),
);
const aiAdapter = new LocalAiAdapter();
const capturePipeline = new CapturePipeline({ repository, aiAdapter });

app.setName("Canvas Inbox");
app.setAppUserModelId("com.canvasinbox.desktop");

const showNotification = (title, body) => {
  if (!Notification.isSupported()) {
    return;
  }

  new Notification({ title, body, silent: true }).show();
};

const createTrayImage = () =>
  nativeImage.createFromDataURL(trayIconDataUrl).resize({
    width: 16,
    height: 16,
  });

const broadcastSnapshot = (snapshot) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("workspace:updated", snapshot);
};

const showWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.show();
  mainWindow.focus();
};

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#f5efe2",
    title: "Canvas Inbox",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.removeMenu();
  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
};

const refreshTrayMenu = () => {
  if (!tray) {
    return;
  }

  const copy = getDesktopCopy(repository.getSnapshot().ui.language);

  const menu = Menu.buildFromTemplate([
    {
      label: copy.trayShowWorkspace,
      click: () => showWindow(),
    },
    {
      label: copy.trayCaptureClipboard,
      click: () => {
        void captureClipboard({
          notifyStart: true,
          openWindow: false,
        });
      },
    },
    { type: "separator" },
    {
      label: copy.trayQuit,
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
};

const createTray = () => {
  tray = new Tray(createTrayImage());
  tray.setToolTip("Canvas Inbox");
  tray.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isVisible()) {
      mainWindow.hide();
      return;
    }

    showWindow();
  });

  refreshTrayMenu();
};

const captureClipboard = async ({ notifyStart, openWindow }) => {
  const copy = getDesktopCopy(repository.getSnapshot().ui.language);
  const text = clipboard.readText();
  const image = clipboard.readImage();
  const hasImage = image && !image.isEmpty();

  if (!text.trim() && !hasImage) {
    showNotification(copy.appTitle, copy.clipboardEmpty);
    return repository.getSnapshot();
  }

  if (notifyStart) {
    showNotification(copy.appTitle, copy.recordingAndOrganizing);
  }

  const { initialSnapshot, pendingCapture } = capturePipeline.enqueueClipboardPayload({
    text,
    imagePngBuffer: hasImage ? image.toPNG() : null,
  });

  broadcastSnapshot(initialSnapshot);

  void capturePipeline
    .completePendingCapture(pendingCapture)
    .then(({ snapshot, taskItems }) => {
      broadcastSnapshot(snapshot);
      const nextCopy = getDesktopCopy(snapshot.ui.language);
      showNotification(
        nextCopy.appTitle,
        taskItems.length > 0
          ? nextCopy.captureSavedAndProjected(taskItems.length)
          : nextCopy.captureSaved,
      );
    })
    .catch((error) => {
      const failureMessage = copy.captureSavedButFailed(
        error instanceof Error ? error.message : "",
      );
      const snapshot = repository.markCaptureFailed({
        captureId: pendingCapture.captureId,
        sourceCardId: pendingCapture.sourceCardId,
        errorMessage: failureMessage,
      });

      broadcastSnapshot(snapshot);
      showNotification(copy.appTitle, failureMessage);
    });

  if (openWindow) {
    showWindow();
  }

  return initialSnapshot;
};

const createManualTextCapture = async ({ text, position }) => {
  const normalizedText = typeof text === "string" ? text.trim() : "";

  if (!normalizedText) {
    return repository.getSnapshot();
  }

  const { initialSnapshot, pendingCapture } = capturePipeline.enqueueManualTextPayload({
    text: normalizedText,
    position,
  });

  broadcastSnapshot(initialSnapshot);

  try {
    const { snapshot } = await capturePipeline.completePendingCapture(pendingCapture);
    broadcastSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    const copy = getDesktopCopy(initialSnapshot.ui.language);
    const failureMessage = copy.captureSavedButFailed(
      error instanceof Error ? error.message : "",
    );
    const snapshot = repository.markCaptureFailed({
      captureId: pendingCapture.captureId,
      sourceCardId: pendingCapture.sourceCardId,
      errorMessage: failureMessage,
    });

    broadcastSnapshot(snapshot);
    return snapshot;
  }
};

const updateSourceCardText = ({ sourceCardId, text }) => {
  const normalizedText = typeof text === "string" ? text.trim() : "";

  if (!normalizedText) {
    return repository.getSnapshot();
  }

  const snapshot = repository.getSnapshot();
  const sourceCard = snapshot.sourceCards.find((item) => item.id === sourceCardId);
  const capture = sourceCard
    ? snapshot.captures.find((item) => item.id === sourceCard.captureId)
    : null;

  if (!sourceCard || !capture) {
    return snapshot;
  }

  const analysis = aiAdapter.analyzeCapture({
    rawText: normalizedText,
    sourceType: capture.sourceType,
    language: snapshot.ui.language,
  });
  const nextSnapshot = repository.updateAnalyzedSourceCard({
    sourceCardId,
    rawText: normalizedText,
    analysis,
  });

  broadcastSnapshot(nextSnapshot);
  return nextSnapshot;
};

const updateTaskText = ({ taskId, text }) => {
  const normalizedText = typeof text === "string" ? text.trim() : "";

  if (!normalizedText) {
    return repository.getSnapshot();
  }

  const snapshot = repository.getSnapshot();
  const taskItem = snapshot.taskItems.find((item) => item.id === taskId);

  if (!taskItem) {
    return snapshot;
  }

  const nextSnapshot = repository.updateTaskText(taskId, normalizedText);
  broadcastSnapshot(nextSnapshot);
  return nextSnapshot;
};

app.on("before-quit", () => {
  isQuitting = true;
});

app.whenReady().then(async () => {
  createTray();
  await createWindow();

  globalShortcut.register(DEFAULT_SHORTCUT, () => {
    void captureClipboard({
      notifyStart: true,
      openWindow: false,
    });
  });

  ipcMain.handle("workspace:getSnapshot", () => repository.getSnapshot());

  ipcMain.handle("workspace:captureClipboard", async () =>
    captureClipboard({
      notifyStart: true,
      openWindow: false,
    }),
  );

  ipcMain.handle("workspace:createManualTextCapture", async (_event, payload) =>
    createManualTextCapture(payload),
  );

  ipcMain.handle("workspace:getAttachmentDataUrl", (_event, attachmentId) =>
    repository.getAttachmentDataUrl(attachmentId),
  );

  ipcMain.handle("workspace:updateLanguage", (_event, payload) => {
    const snapshot = repository.updateLanguage(normalizeLanguage(payload.language));
    refreshTrayMenu();
    broadcastSnapshot(snapshot);
    return snapshot;
  });

  ipcMain.handle("workspace:updateSourceCardText", (_event, payload) =>
    updateSourceCardText(payload),
  );

  ipcMain.handle("workspace:updateSourceCardPosition", (_event, payload) => {
    const snapshot = repository.updateSourceCardPosition(
      payload.sourceCardId,
      payload.position,
    );

    broadcastSnapshot(snapshot);
    return snapshot;
  });

  ipcMain.handle("workspace:updateTaskStatus", (_event, payload) => {
    const snapshot = repository.updateTaskStatus(payload.taskId, payload.status);

    broadcastSnapshot(snapshot);
    return snapshot;
  });

  ipcMain.handle("workspace:updateTaskText", (_event, payload) =>
    updateTaskText(payload),
  );

  app.on("activate", () => {
    showWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
