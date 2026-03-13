const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_LANGUAGE,
  getDesktopCopy,
  normalizeLanguage,
} = require("../i18n.cjs");

const SCHEMA_VERSION = 1;
const BOARD_ID = "board_local_main";
const DEFAULT_SHORTCUT = "CommandOrControl+Shift+V";
const MAX_CAPTURE_FEED_ITEMS = 12;

const nowIso = () => new Date().toISOString();

const clone = (value) => JSON.parse(JSON.stringify(value));

const createId = (prefix) =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

const createEmptyWorkspace = () => {
  const createdAt = nowIso();
  const language = DEFAULT_LANGUAGE;
  const copy = getDesktopCopy(language);

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: createdAt,
    board: {
      id: BOARD_ID,
      schemaVersion: SCHEMA_VERSION,
      name: "Canvas Inbox",
      createdAt,
      updatedAt: createdAt,
    },
    captures: [],
    sourceCards: [],
    taskItems: [],
    attachments: [],
    ui: {
      language,
      shortcut: DEFAULT_SHORTCUT,
      captureStatus: "ready",
      captureMessage: copy.idleCaptureMessage,
      lastCaptureId: null,
      lastCaptureAt: null,
      activeCaptureCount: 0,
      captureFeed: [],
    },
  };
};

const normalizeWorkspace = (workspace) => {
  const fallback = createEmptyWorkspace();

  return {
    ...fallback,
    ...workspace,
    board: {
      ...fallback.board,
      ...(workspace.board || {}),
    },
    captures: Array.isArray(workspace.captures) ? workspace.captures : [],
    sourceCards: Array.isArray(workspace.sourceCards) ? workspace.sourceCards : [],
    taskItems: Array.isArray(workspace.taskItems) ? workspace.taskItems : [],
    attachments: Array.isArray(workspace.attachments) ? workspace.attachments : [],
    ui: {
      ...fallback.ui,
      ...(workspace.ui || {}),
      language: normalizeLanguage(workspace.ui?.language),
      captureFeed: Array.isArray(workspace.ui?.captureFeed)
        ? workspace.ui.captureFeed
        : [],
    },
  };
};

const createCaptureFeedItem = ({ captureId, stage, message }) => ({
  id: createId("feed"),
  captureId,
  stage,
  message,
  createdAt: nowIso(),
});

class LocalWorkspaceRepository {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.workspaceFilePath = path.join(baseDir, "workspace.json");
    this.attachmentsDir = path.join(baseDir, "attachments");
    this.ensureStorage();
  }

  ensureStorage() {
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.mkdirSync(this.attachmentsDir, { recursive: true });

    if (!fs.existsSync(this.workspaceFilePath)) {
      this.writeWorkspace(createEmptyWorkspace());
    }
  }

  readWorkspace() {
    try {
      const raw = fs.readFileSync(this.workspaceFilePath, "utf8");
      const parsed = JSON.parse(raw);

      if (!parsed?.schemaVersion) {
        return createEmptyWorkspace();
      }

      return normalizeWorkspace(parsed);
    } catch (error) {
      return createEmptyWorkspace();
    }
  }

  writeWorkspace(workspace) {
    fs.writeFileSync(
      this.workspaceFilePath,
      JSON.stringify(workspace, null, 2),
      "utf8",
    );
  }

  getSnapshot() {
    return clone(this.readWorkspace());
  }

  createAttachmentFromPng(buffer) {
    const id = createId("attachment");
    const createdAt = nowIso();
    const fileName = `${id}.png`;
    const absolutePath = path.join(this.attachmentsDir, fileName);

    fs.writeFileSync(absolutePath, buffer);

    return {
      id,
      schemaVersion: SCHEMA_VERSION,
      createdAt,
      updatedAt: createdAt,
      mimeType: "image/png",
      storageKey: fileName,
      size: buffer.length,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    };
  }

  prependCaptureFeed(workspace, feedItem) {
    workspace.ui.captureFeed = [feedItem, ...workspace.ui.captureFeed].slice(
      0,
      MAX_CAPTURE_FEED_ITEMS,
    );
  }

  enqueueCapture({ capture, sourceCard, attachments, message }) {
    const workspace = this.readWorkspace();
    const updatedAt = nowIso();

    workspace.captures.unshift(capture);
    workspace.sourceCards.push(sourceCard);
    workspace.attachments.push(...attachments);
    workspace.ui.captureStatus = "processing";
    workspace.ui.captureMessage = message;
    workspace.ui.lastCaptureId = capture.id;
    workspace.ui.lastCaptureAt = capture.createdAt;
    workspace.ui.activeCaptureCount = workspace.captures.filter(
      (item) => item.aiStatus === "queued" || item.aiStatus === "processing",
    ).length;
    this.prependCaptureFeed(
      workspace,
      createCaptureFeedItem({
        captureId: capture.id,
        stage: "captured",
        message,
      }),
    );
    workspace.board.updatedAt = updatedAt;
    workspace.updatedAt = updatedAt;

    this.writeWorkspace(workspace);

    return clone(workspace);
  }

  completeCaptureProcessing({
    captureId,
    sourceCardId,
    analysis,
    taskItems,
    message,
  }) {
    const workspace = this.readWorkspace();
    const updatedAt = nowIso();
    const capture = workspace.captures.find((item) => item.id === captureId);
    const sourceCard = workspace.sourceCards.find((item) => item.id === sourceCardId);

    if (!capture || !sourceCard) {
      return clone(workspace);
    }

    capture.aiStatus = "done";
    capture.aiSummary = analysis.sourceSummary;
    capture.aiTaskSuggestions = taskItems.map((task) => ({
      title: task.title,
      timeHint: task.timeHint,
      confidence: task.confidence,
    }));
    capture.aiTimeSuggestion = analysis.timeHint;
    capture.tags = analysis.tags;
    capture.processedAt = updatedAt;
    capture.updatedAt = updatedAt;
    capture.errorMessage = null;

    sourceCard.title = analysis.sourceTitle;
    sourceCard.summary = analysis.sourceSummary;
    sourceCard.tags = analysis.tags;
    sourceCard.linkedTaskIds = taskItems.map((task) => task.id);
    sourceCard.updatedAt = updatedAt;

    workspace.taskItems.unshift(...taskItems);
    workspace.ui.captureStatus = "ready";
    workspace.ui.captureMessage = message;
    workspace.ui.lastCaptureId = captureId;
    workspace.ui.activeCaptureCount = workspace.captures.filter(
      (item) => item.aiStatus === "queued" || item.aiStatus === "processing",
    ).length;
    this.prependCaptureFeed(
      workspace,
      createCaptureFeedItem({
        captureId,
        stage: "projected",
        message,
      }),
    );
    workspace.board.updatedAt = updatedAt;
    workspace.updatedAt = updatedAt;

    this.writeWorkspace(workspace);

    return clone(workspace);
  }

  markCaptureFailed({ captureId, sourceCardId, errorMessage }) {
    const workspace = this.readWorkspace();
    const updatedAt = nowIso();
    const capture = workspace.captures.find((item) => item.id === captureId);
    const sourceCard = workspace.sourceCards.find((item) => item.id === sourceCardId);

    if (!capture || !sourceCard) {
      return clone(workspace);
    }

    capture.aiStatus = "failed";
    capture.errorMessage = errorMessage;
    capture.processedAt = updatedAt;
    capture.updatedAt = updatedAt;

    sourceCard.summary = errorMessage;
    sourceCard.updatedAt = updatedAt;

    workspace.ui.captureStatus = "error";
    workspace.ui.captureMessage = errorMessage;
    workspace.ui.lastCaptureId = captureId;
    workspace.ui.activeCaptureCount = workspace.captures.filter(
      (item) => item.aiStatus === "queued" || item.aiStatus === "processing",
    ).length;
    this.prependCaptureFeed(
      workspace,
      createCaptureFeedItem({
        captureId,
        stage: "failed",
        message: errorMessage,
      }),
    );
    workspace.board.updatedAt = updatedAt;
    workspace.updatedAt = updatedAt;

    this.writeWorkspace(workspace);

    return clone(workspace);
  }

  updateSourceCardPosition(sourceCardId, position) {
    const workspace = this.readWorkspace();
    const sourceCard = workspace.sourceCards.find((item) => item.id === sourceCardId);

    if (!sourceCard) {
      return clone(workspace);
    }

    const updatedAt = nowIso();
    sourceCard.position = {
      x: Math.round(position.x),
      y: Math.round(position.y),
    };
    sourceCard.updatedAt = updatedAt;
    workspace.board.updatedAt = updatedAt;
    workspace.updatedAt = updatedAt;

    this.writeWorkspace(workspace);

    return clone(workspace);
  }

  updateAnalyzedSourceCard({ sourceCardId, rawText, analysis }) {
    const workspace = this.readWorkspace();
    const sourceCard = workspace.sourceCards.find((item) => item.id === sourceCardId);

    if (!sourceCard) {
      return clone(workspace);
    }

    const capture = workspace.captures.find((item) => item.id === sourceCard.captureId);
    const updatedAt = nowIso();
    const primarySuggestion = analysis.taskSuggestions[0] || {
      title: analysis.sourceTitle,
      summary: analysis.sourceSummary,
      confidence: 0.58,
      timeHint: analysis.timeHint || null,
    };

    sourceCard.title = analysis.sourceTitle;
    sourceCard.summary = analysis.sourceSummary;
    sourceCard.tags = analysis.tags;
    sourceCard.updatedAt = updatedAt;

    if (capture) {
      capture.rawText = rawText;
      capture.aiStatus = "done";
      capture.aiSummary = analysis.sourceSummary;
      capture.aiTaskSuggestions = analysis.taskSuggestions.map((task) => ({
        title: task.title,
        timeHint: task.timeHint,
        confidence: task.confidence,
      }));
      capture.aiTimeSuggestion = analysis.timeHint;
      capture.tags = analysis.tags;
      capture.processedAt = updatedAt;
      capture.updatedAt = updatedAt;
      capture.errorMessage = null;
    }

    if (sourceCard.linkedTaskIds.length === 1) {
      const taskItem = workspace.taskItems.find(
        (item) => item.id === sourceCard.linkedTaskIds[0],
      );

      if (taskItem) {
        taskItem.title = primarySuggestion.title;
        taskItem.summary = primarySuggestion.summary;
        taskItem.timeHint = primarySuggestion.timeHint || null;
        taskItem.confidence = primarySuggestion.confidence;
        taskItem.updatedAt = updatedAt;
      }
    }

    workspace.board.updatedAt = updatedAt;
    workspace.updatedAt = updatedAt;

    this.writeWorkspace(workspace);

    return clone(workspace);
  }

  updateTaskStatus(taskId, status) {
    const workspace = this.readWorkspace();
    const taskItem = workspace.taskItems.find((item) => item.id === taskId);

    if (!taskItem) {
      return clone(workspace);
    }

    const updatedAt = nowIso();
    taskItem.status = status;
    taskItem.updatedAt = updatedAt;
    workspace.board.updatedAt = updatedAt;
    workspace.updatedAt = updatedAt;

    this.writeWorkspace(workspace);

    return clone(workspace);
  }

  updateTaskText(taskId, text) {
    const workspace = this.readWorkspace();
    const taskItem = workspace.taskItems.find((item) => item.id === taskId);

    if (!taskItem) {
      return clone(workspace);
    }

    const updatedAt = nowIso();
    taskItem.title = text;
    taskItem.summary = text;
    taskItem.updatedAt = updatedAt;
    workspace.board.updatedAt = updatedAt;
    workspace.updatedAt = updatedAt;

    this.writeWorkspace(workspace);

    return clone(workspace);
  }

  updateLanguage(language) {
    const workspace = this.readWorkspace();
    const nextLanguage = normalizeLanguage(language);
    const copy = getDesktopCopy(nextLanguage);
    const updatedAt = nowIso();

    workspace.ui.language = nextLanguage;

    if (workspace.ui.captureStatus === "ready" || !workspace.ui.captureMessage) {
      workspace.ui.captureMessage = copy.idleCaptureMessage;
    }

    workspace.board.updatedAt = updatedAt;
    workspace.updatedAt = updatedAt;

    this.writeWorkspace(workspace);

    return clone(workspace);
  }

  getAttachmentDataUrl(attachmentId) {
    const workspace = this.readWorkspace();
    const attachment = workspace.attachments.find((item) => item.id === attachmentId);

    if (!attachment) {
      return null;
    }

    const absolutePath = path.join(this.attachmentsDir, attachment.storageKey);

    if (!fs.existsSync(absolutePath)) {
      return null;
    }

    const buffer = fs.readFileSync(absolutePath);
    return `data:${attachment.mimeType};base64,${buffer.toString("base64")}`;
  }
}

module.exports = {
  BOARD_ID,
  DEFAULT_SHORTCUT,
  LocalWorkspaceRepository,
  SCHEMA_VERSION,
  createId,
};
