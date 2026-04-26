const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  getAppRuntimeState: () => ipcRenderer.invoke("app:getRuntimeState"),
  retryShortcutRegistration: () => ipcRenderer.invoke("app:retryShortcutRegistration"),
  getWindowState: () => ipcRenderer.invoke("window:getState"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggleMaximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  getWorkspaceSnapshot: () => ipcRenderer.invoke("workspace:getSnapshot"),
  captureClipboard: () => ipcRenderer.invoke("workspace:captureClipboard"),
  createManualTextCapture: (payload) =>
    ipcRenderer.invoke("workspace:createManualTextCapture", payload),
  updateAiConfig: (payload) => ipcRenderer.invoke("workspace:updateAiConfig", payload),
  getAttachmentDataUrl: (attachmentId) =>
    ipcRenderer.invoke("workspace:getAttachmentDataUrl", attachmentId),
  updateLanguage: (payload) => ipcRenderer.invoke("workspace:updateLanguage", payload),
  updateSourceCardText: (payload) =>
    ipcRenderer.invoke("workspace:updateSourceCardText", payload),
  updateSourceCardDetails: (payload) =>
    ipcRenderer.invoke("workspace:updateSourceCardDetails", payload),
  reanalyzeSourceCard: (payload) =>
    ipcRenderer.invoke("workspace:reanalyzeSourceCard", payload),
  updateSourceCardReviewStatus: (payload) =>
    ipcRenderer.invoke("workspace:updateSourceCardReviewStatus", payload),
  updateSourceCardPosition: (payload) =>
    ipcRenderer.invoke("workspace:updateSourceCardPosition", payload),
  updateTaskStatus: (payload) =>
    ipcRenderer.invoke("workspace:updateTaskStatus", payload),
  updateTaskText: (payload) => ipcRenderer.invoke("workspace:updateTaskText", payload),
  updateTaskSummary: (payload) =>
    ipcRenderer.invoke("workspace:updateTaskSummary", payload),
  deleteTask: (payload) => ipcRenderer.invoke("workspace:deleteTask", payload),
  deleteSourceCard: (payload) =>
    ipcRenderer.invoke("workspace:deleteSourceCard", payload),
  onWorkspaceUpdated: (listener) => {
    const handler = (_event, snapshot) => listener(snapshot);
    ipcRenderer.on("workspace:updated", handler);

    return () => {
      ipcRenderer.removeListener("workspace:updated", handler);
    };
  },
  onWindowStateChanged: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("window:stateChanged", handler);

    return () => {
      ipcRenderer.removeListener("window:stateChanged", handler);
    };
  },
  onAppRuntimeUpdated: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("app:runtimeUpdated", handler);

    return () => {
      ipcRenderer.removeListener("app:runtimeUpdated", handler);
    };
  },
});
