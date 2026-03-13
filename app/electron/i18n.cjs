const DEFAULT_LANGUAGE = "zh-CN";
const SUPPORTED_LANGUAGES = new Set(["zh-CN", "en-US"]);

const normalizeLanguage = (language) =>
  SUPPORTED_LANGUAGES.has(language) ? language : DEFAULT_LANGUAGE;

const getDesktopCopy = (language) => {
  const normalizedLanguage = normalizeLanguage(language);

  if (normalizedLanguage === "en-US") {
    return {
      idleCaptureMessage: "Copy content and press the shortcut to stash it here.",
      trayShowWorkspace: "Show workspace",
      trayCaptureClipboard: "Capture clipboard",
      trayQuit: "Quit",
      clipboardEmpty: "Clipboard is empty.",
      recordingAndOrganizing: "Recording and organizing your capture...",
      recordedToCanvasOrganizing: "Recorded to canvas. Organizing it now...",
      captureSaved: "Saved to canvas.",
      captureSavedAndProjected: (count) =>
        `Saved to canvas and projected ${count} task${count > 1 ? "s" : ""}.`,
      captureSavedButFailed: (errorMessage) =>
        errorMessage
          ? `Capture saved, but organizing failed: ${errorMessage}`
          : "Capture saved, but organizing failed.",
      analyzingCaptureSummary: "Analyzing the captured content...",
      analyzingCardSummary: "Analyzing captured content...",
      fallbackImageTitle: "Image capture",
      fallbackMixedTitle: "Mixed capture",
      fallbackQuickTitle: "Quick capture",
      imageCaptureStored: "Image capture stored on the canvas.",
      capturedForLaterReview: "Captured for later review.",
      sourceLinkedToast: (count) =>
        `Linked to ${count} source card${count > 1 ? "s" : ""}.`,
      appTitle: "Canvas Inbox",
    };
  }

  return {
    idleCaptureMessage: "复制内容后按快捷键，系统会自动收录到画布。",
    trayShowWorkspace: "显示工作区",
    trayCaptureClipboard: "立即收录剪贴板",
    trayQuit: "退出",
    clipboardEmpty: "剪贴板里还没有可收录的内容。",
    recordingAndOrganizing: "正在记录并整理这条内容...",
    recordedToCanvasOrganizing: "已记录到画布，正在整理...",
    captureSaved: "已收纳到画布。",
    captureSavedAndProjected: (count) => `已收纳到画布，并整理出 ${count} 条待办。`,
    captureSavedButFailed: (errorMessage) =>
      errorMessage
        ? `内容已收录，但整理失败：${errorMessage}`
        : "内容已收录，但整理失败。",
    analyzingCaptureSummary: "正在分析刚收录的内容...",
    analyzingCardSummary: "正在整理这条记录...",
    fallbackImageTitle: "图片收录",
    fallbackMixedTitle: "混合收录",
    fallbackQuickTitle: "快速收录",
    imageCaptureStored: "图片已收纳到画布。",
    capturedForLaterReview: "已收纳，稍后再处理。",
    sourceLinkedToast: (count) => `已关联 ${count} 个来源卡片。`,
    appTitle: "Canvas Inbox",
  };
};

module.exports = {
  DEFAULT_LANGUAGE,
  getDesktopCopy,
  normalizeLanguage,
};
