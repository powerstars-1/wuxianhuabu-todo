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
const { OpenAiCompatibleAdapter } = require("./services/openAiCompatibleAdapter.cjs");
const { CapturePipeline } = require("./services/capturePipeline.cjs");
const { getDesktopCopy, normalizeLanguage } = require("./i18n.cjs");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const APP_NAME = "Canvas Inbox";
const APP_ID = "com.canvasinbox.desktop";

let mainWindow = null;
let tray = null;
let isQuitting = false;

const repository = new LocalWorkspaceRepository(
  path.join(app.getPath("userData"), "canvas-inbox"),
);
const localAiAdapter = new LocalAiAdapter();
const remoteAiAdapter = new OpenAiCompatibleAdapter({
  fallbackAdapter: localAiAdapter,
});
const capturePipeline = new CapturePipeline({
  repository,
  localAiAdapter,
  remoteAiAdapter,
});

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

const resolveAssetPath = (fileName) =>
  path.join(__dirname, "..", isDev ? "public" : "dist", fileName);

const getWindowIconPath = () =>
  resolveAssetPath(process.platform === "win32" ? "app-icon.ico" : "app-icon.png");

const loadWindowIcon = () => {
  const image = nativeImage.createFromPath(getWindowIconPath());

  if (image.isEmpty()) {
    return null;
  }

  return image;
};

const loadTrayImage = () => {
  const image = nativeImage.createFromPath(resolveAssetPath("app-icon.png"));

  if (image.isEmpty()) {
    return nativeImage.createEmpty();
  }

  return image.resize({
    width: 16,
    height: 16,
  });
};

const buildRelaunchCommand = () => {
  const execPath = process.execPath;
  const appRoot = path.join(__dirname, "..");

  if (app.isPackaged) {
    return `"${execPath}"`;
  }

  return `"${execPath}" "${appRoot}"`;
};

const applyWindowsTaskbarDetails = () => {
  if (
    process.platform !== "win32" ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    typeof mainWindow.setAppDetails !== "function"
  ) {
    return;
  }

  mainWindow.setAppDetails({
    appId: APP_ID,
    appIconPath: getWindowIconPath(),
    appIconIndex: 0,
    relaunchCommand: buildRelaunchCommand(),
    relaunchDisplayName: APP_NAME,
  });
};

const showNotification = (title, body) => {
  if (!Notification.isSupported()) {
    return;
  }

  new Notification({ title, body, silent: true }).show();
};

const broadcastSnapshot = (snapshot) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("workspace:updated", snapshot);
};

const getWindowState = () => ({
  isMaximized: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()),
});

const broadcastWindowState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("window:stateChanged", getWindowState());
};

const showWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.show();
  mainWindow.focus();
};

const createWindow = async () => {
  const windowIcon = loadWindowIcon();
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#f5efe2",
    title: APP_NAME,
    icon: windowIcon || getWindowIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (windowIcon && typeof mainWindow.setIcon === "function") {
    mainWindow.setIcon(windowIcon);
  }
  applyWindowsTaskbarDetails();

  mainWindow.removeMenu();
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${sourceId}:${line} ${message}`);
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[did-fail-load] ${errorCode} ${errorDescription} ${validatedURL}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[render-process-gone] ${details.reason}`);
  });
  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on("maximize", () => {
    broadcastWindowState();
  });
  mainWindow.on("unmaximize", () => {
    broadcastWindowState();
  });
  mainWindow.on("show", () => {
    broadcastWindowState();
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

  broadcastWindowState();
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
  tray = new Tray(loadTrayImage());
  tray.setToolTip(APP_NAME);
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

const analyzeCaptureWithCurrentConfig = async ({
  rawText,
  sourceType,
  language,
}) => {
  const snapshot = repository.getSnapshot();
  const adapter =
    snapshot.ai?.provider === "openai-compatible"
      ? remoteAiAdapter
      : localAiAdapter;

  return adapter.analyzeCapture({
    rawText,
    sourceType,
    language,
    config: snapshot.ai,
  });
};

const updateSourceCardText = async ({ sourceCardId, text }) => {
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

  const analysis = await analyzeCaptureWithCurrentConfig({
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

const updateAiConfig = ({ provider, baseUrl, apiKey, model }) => {
  const nextSnapshot = repository.updateAiConfig({
    provider,
    baseUrl,
    apiKey,
    model,
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

const updateTaskSummary = ({ taskId, summary }) => {
  const normalizedSummary = typeof summary === "string" ? summary.trim() : "";

  if (!normalizedSummary) {
    return repository.getSnapshot();
  }

  const snapshot = repository.getSnapshot();
  const taskItem = snapshot.taskItems.find((item) => item.id === taskId);

  if (!taskItem) {
    return snapshot;
  }

  const nextSnapshot = repository.updateTaskSummary(taskId, normalizedSummary);
  broadcastSnapshot(nextSnapshot);
  return nextSnapshot;
};

const deleteTask = ({ taskId }) => {
  const snapshot = repository.deleteTask(taskId);
  broadcastSnapshot(snapshot);
  return snapshot;
};

const deleteSourceCard = ({ sourceCardId }) => {
  const snapshot = repository.deleteSourceCard(sourceCardId);
  broadcastSnapshot(snapshot);
  return snapshot;
};

const minimizeWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return getWindowState();
  }

  mainWindow.minimize();
  return getWindowState();
};

const toggleMaximizeWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return getWindowState();
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }

  return getWindowState();
};

const closeWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return getWindowState();
  }

  mainWindow.close();
  return getWindowState();
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
  ipcMain.handle("window:getState", () => getWindowState());
  ipcMain.handle("window:minimize", () => minimizeWindow());
  ipcMain.handle("window:toggleMaximize", () => toggleMaximizeWindow());
  ipcMain.handle("window:close", () => closeWindow());

  ipcMain.handle("workspace:captureClipboard", async () =>
    captureClipboard({
      notifyStart: true,
      openWindow: false,
    }),
  );

  ipcMain.handle("workspace:createManualTextCapture", async (_event, payload) =>
    createManualTextCapture(payload),
  );

  ipcMain.handle("workspace:updateAiConfig", (_event, payload) =>
    updateAiConfig(payload),
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

  ipcMain.handle("workspace:updateTaskSummary", (_event, payload) =>
    updateTaskSummary(payload),
  );

  ipcMain.handle("workspace:deleteTask", (_event, payload) => deleteTask(payload));
  ipcMain.handle("workspace:deleteSourceCard", (_event, payload) =>
    deleteSourceCard(payload),
  );

  app.on("activate", () => {
    showWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
