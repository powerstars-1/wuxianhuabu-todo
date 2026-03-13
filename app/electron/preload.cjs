const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  getWorkspaceSnapshot: () => ipcRenderer.invoke("workspace:getSnapshot"),
  captureClipboard: () => ipcRenderer.invoke("workspace:captureClipboard"),
  createManualTextCapture: (payload) =>
    ipcRenderer.invoke("workspace:createManualTextCapture", payload),
  getAttachmentDataUrl: (attachmentId) =>
    ipcRenderer.invoke("workspace:getAttachmentDataUrl", attachmentId),
  updateLanguage: (payload) => ipcRenderer.invoke("workspace:updateLanguage", payload),
  updateSourceCardText: (payload) =>
    ipcRenderer.invoke("workspace:updateSourceCardText", payload),
  updateSourceCardPosition: (payload) =>
    ipcRenderer.invoke("workspace:updateSourceCardPosition", payload),
  updateTaskStatus: (payload) =>
    ipcRenderer.invoke("workspace:updateTaskStatus", payload),
  updateTaskText: (payload) => ipcRenderer.invoke("workspace:updateTaskText", payload),
  onWorkspaceUpdated: (listener) => {
    const handler = (_event, snapshot) => listener(snapshot);
    ipcRenderer.on("workspace:updated", handler);

    return () => {
      ipcRenderer.removeListener("workspace:updated", handler);
    };
  },
});
