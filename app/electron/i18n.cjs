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
      aiConfigIncomplete:
        "AI configuration is incomplete. Please provide base URL, API key, and model.",
      secureStorageUnavailable:
        "Secure credential storage is unavailable on this device. The API key was not saved.",
      remoteAiInvalidResponse: "The AI response could not be parsed.",
      remoteAiRequestFailed: (status) =>
        status ? `The AI service request failed (${status}).` : "The AI service request failed.",
      remoteAiVisionRequestFailed: (status) =>
        status
          ? `The AI service could not analyze the image input (${status}).`
          : "The AI service could not analyze the image input.",
      visionImageTooLarge:
        "The captured image is too large for the configured AI endpoint after compression.",
      sourceLinkedToast: (count) =>
        `Linked to ${count} source card${count > 1 ? "s" : ""}.`,
      workspaceRecoveredFromBackup:
        "The main workspace file was damaged. The app restored your last valid backup.",
      workspaceResetAfterCorruption:
        "The workspace files were damaged and could not be restored. The app started with a clean workspace.",
      shortcutRegistrationFailed: (shortcut) =>
        `The global shortcut ${shortcut} is unavailable. Another app may already be using it.`,
      shortcutRegistrationRecovered: (shortcut) =>
        `The global shortcut ${shortcut} is working again.`,
      trayShortcutHealthy: (shortcut) => `Shortcut ready: ${shortcut}`,
      trayShortcutUnavailable: (shortcut) => `Shortcut unavailable: ${shortcut}`,
      trayRetryShortcut: "Retry shortcut registration",
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
    aiConfigIncomplete: "AI 配置还不完整，请填写 Base URL、API Key 和模型。",
    secureStorageUnavailable: "当前设备无法安全保存凭据，这次没有保存 API Key。",
    remoteAiInvalidResponse: "AI 返回结果无法解析。",
    remoteAiRequestFailed: (status) =>
      status ? `AI 服务请求失败（${status}）。` : "AI 服务请求失败。",
    remoteAiVisionRequestFailed: (status) =>
      status ? `AI 服务暂时无法分析图片输入（${status}）。` : "AI 服务暂时无法分析图片输入。",
    visionImageTooLarge: "压缩后图片仍然过大，当前 AI 接口暂时无法分析这张图片。",
    sourceLinkedToast: (count) => `已关联 ${count} 个来源卡片。`,
    workspaceRecoveredFromBackup: "主工作区文件已损坏，系统已从最近一次有效备份恢复。",
    workspaceResetAfterCorruption: "工作区文件已损坏且无法恢复，系统已重新初始化一个空工作区。",
    shortcutRegistrationFailed: (shortcut) =>
      `全局快捷键 ${shortcut} 当前不可用，可能已被其他应用占用。`,
    shortcutRegistrationRecovered: (shortcut) => `全局快捷键 ${shortcut} 已恢复可用。`,
    trayShortcutHealthy: (shortcut) => `快捷键可用：${shortcut}`,
    trayShortcutUnavailable: (shortcut) => `快捷键不可用：${shortcut}`,
    trayRetryShortcut: "重试注册快捷键",
    appTitle: "Canvas Inbox",
  };
};

module.exports = {
  DEFAULT_LANGUAGE,
  getDesktopCopy,
  normalizeLanguage,
};
