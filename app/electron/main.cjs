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
const MAX_VISION_EDGE = 1568;
const MAX_VISION_IMAGE_BYTES = 7 * 1024 * 1024;

let mainWindow = null;
let tray = null;
let isQuitting = false;
let shortcutState = {
  accelerator: DEFAULT_SHORTCUT,
  registered: false,
  errorMessage: null,
};

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
  prepareVisionAttachmentDataUrls,
});

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

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

function encodeVisionImage(image) {
  let currentImage = image;
  let { width, height } = currentImage.getSize();

  if (Math.max(width, height) > MAX_VISION_EDGE) {
    const scale = MAX_VISION_EDGE / Math.max(width, height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    currentImage = currentImage.resize({ width, height });
  }

  let pngBuffer = currentImage.toPNG();

  if (pngBuffer.length <= MAX_VISION_IMAGE_BYTES) {
    return `data:image/png;base64,${pngBuffer.toString("base64")}`;
  }

  let jpegQuality = 82;
  let jpegBuffer = currentImage.toJPEG(jpegQuality);

  while (
    jpegBuffer.length > MAX_VISION_IMAGE_BYTES &&
    Math.max(width, height) > 512
  ) {
    width = Math.max(512, Math.round(width * 0.82));
    height = Math.max(512, Math.round(height * 0.82));
    currentImage = currentImage.resize({ width, height });
    jpegQuality = Math.max(60, jpegQuality - 8);
    jpegBuffer = currentImage.toJPEG(jpegQuality);
  }

  if (jpegBuffer.length > MAX_VISION_IMAGE_BYTES) {
    throw new Error("VISION_IMAGE_TOO_LARGE");
  }

  return `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;
}

function prepareVisionAttachmentDataUrls(attachmentIds) {
  return (attachmentIds || [])
    .map((attachmentId) => repository.getAttachmentDataUrl(attachmentId))
    .filter((dataUrl) => typeof dataUrl === "string" && dataUrl.trim())
    .map((dataUrl) => {
      const image = nativeImage.createFromDataURL(dataUrl);

      if (image.isEmpty()) {
        return null;
      }

      return encodeVisionImage(image);
    })
    .filter((dataUrl) => typeof dataUrl === "string");
}

const getAppRuntimeState = () => ({
  shortcut: { ...shortcutState },
  storage: repository.getStorageHealth(),
});

const broadcastAppRuntimeState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("app:runtimeUpdated", getAppRuntimeState());
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

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
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
  broadcastAppRuntimeState();
};

const refreshTrayMenu = () => {
  if (!tray) {
    return;
  }

  const copy = getDesktopCopy(repository.getSnapshot().ui.language);
  const shortcutMenuItems = shortcutState.registered
    ? [
        {
          label: copy.trayShortcutHealthy(shortcutState.accelerator),
          enabled: false,
        },
      ]
    : [
        {
          label: copy.trayShortcutUnavailable(shortcutState.accelerator),
          enabled: false,
        },
        {
          label: copy.trayRetryShortcut,
          click: () => {
            retryShortcutRegistration({
              notifyFailure: true,
              notifySuccess: true,
            });
          },
        },
      ];

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
    ...shortcutMenuItems,
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

const registerCaptureShortcut = ({ notifyFailure, notifySuccess } = {}) => {
  const copy = getDesktopCopy(repository.getSnapshot().ui.language);
  let registered = false;

  globalShortcut.unregister(DEFAULT_SHORTCUT);

  try {
    registered = globalShortcut.register(DEFAULT_SHORTCUT, () => {
      void captureClipboard({
        notifyStart: true,
        openWindow: false,
      });
    });
  } catch (error) {
    registered = false;
  }

  shortcutState = registered
    ? {
        accelerator: DEFAULT_SHORTCUT,
        registered: true,
        errorMessage: null,
      }
    : {
        accelerator: DEFAULT_SHORTCUT,
        registered: false,
        errorMessage: copy.shortcutRegistrationFailed(DEFAULT_SHORTCUT),
      };

  refreshTrayMenu();
  broadcastAppRuntimeState();

  if (!registered && notifyFailure) {
    showNotification(copy.appTitle, shortcutState.errorMessage);
  }

  if (registered && notifySuccess) {
    showNotification(copy.appTitle, copy.shortcutRegistrationRecovered(DEFAULT_SHORTCUT));
  }

  return getAppRuntimeState();
};

const retryShortcutRegistration = (options) => registerCaptureShortcut(options);

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
  attachmentIds,
}) => {
  const copy = getDesktopCopy(language);
  const runtimeAiConfig = repository.getAiRuntimeConfig();
  const adapter =
    runtimeAiConfig?.provider === "openai-compatible"
      ? remoteAiAdapter
      : localAiAdapter;
  let imageDataUrls = [];

  try {
    imageDataUrls =
      sourceType === "image" || sourceType === "mixed"
        ? prepareVisionAttachmentDataUrls(attachmentIds)
        : [];
  } catch (error) {
    if (error instanceof Error && error.message === "VISION_IMAGE_TOO_LARGE") {
      throw new Error(copy.visionImageTooLarge);
    }

    throw error;
  }

  return adapter.analyzeCapture({
    rawText,
    sourceType,
    language,
    imageDataUrls,
    config: runtimeAiConfig,
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
    attachmentIds: sourceCard.attachmentIds,
  });
  const nextSnapshot = repository.updateAnalyzedSourceCard({
    sourceCardId,
    rawText: normalizedText,
    analysis,
  });

  broadcastSnapshot(nextSnapshot);
  return nextSnapshot;
};

const updateAiConfig = ({ provider, baseUrl, apiKey, model, clearApiKey }) => {
  const copy = getDesktopCopy(repository.getSnapshot().ui.language);
  const normalizedProvider =
    provider === "openai-compatible" ? "openai-compatible" : "local";
  const normalizedBaseUrl = typeof baseUrl === "string" ? baseUrl.trim() : "";
  const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  const nextHasApiKey =
    clearApiKey === true
      ? false
      : Boolean(normalizedApiKey) || repository.getSnapshot().ai.hasApiKey;

  if (
    normalizedProvider === "openai-compatible" &&
    !(normalizedBaseUrl && normalizedModel && nextHasApiKey)
  ) {
    throw new Error(copy.aiConfigIncomplete);
  }

  try {
    const nextSnapshot = repository.updateAiConfig({
      provider: normalizedProvider,
      baseUrl: normalizedBaseUrl,
      apiKey: normalizedApiKey,
      model: normalizedModel,
      clearApiKey,
    });
    broadcastSnapshot(nextSnapshot);
    return nextSnapshot;
  } catch (error) {
    if (error instanceof Error && error.message === "SAFE_STORAGE_UNAVAILABLE") {
      throw new Error(copy.secureStorageUnavailable);
    }

    throw error;
  }
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

app.on("second-instance", () => {
  showWindow();
});

app.whenReady().then(async () => {
  repository.migrateLegacyAiConfig();
  createTray();
  await createWindow();
  registerCaptureShortcut({
    notifyFailure: true,
  });

  const storageHealth = repository.getStorageHealth();
  if (storageHealth.status !== "ready" && storageHealth.message) {
    showNotification(getDesktopCopy(repository.getSnapshot().ui.language).appTitle, storageHealth.message);
  }

  ipcMain.handle("workspace:getSnapshot", () => repository.getSnapshot());
  ipcMain.handle("app:getRuntimeState", () => getAppRuntimeState());
  ipcMain.handle("app:retryShortcutRegistration", () =>
    retryShortcutRegistration({
      notifyFailure: true,
      notifySuccess: true,
    }),
  );
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

    if (!shortcutState.registered) {
      shortcutState = {
        ...shortcutState,
        errorMessage: getDesktopCopy(snapshot.ui.language).shortcutRegistrationFailed(
          shortcutState.accelerator,
        ),
      };
    }

    refreshTrayMenu();
    broadcastSnapshot(snapshot);
    broadcastAppRuntimeState();
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
