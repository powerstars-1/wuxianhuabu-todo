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

const createDefaultAiConfig = () => ({
  provider: "local",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
});

const createId = (prefix) =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

const normalizeChecklist = (value) =>
  Array.isArray(value)
    ? value
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim())
        .slice(0, 6)
    : [];

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
    ai: createDefaultAiConfig(),
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
    ai: {
      ...fallback.ai,
      ...(workspace.ai || {}),
      provider:
        workspace.ai?.provider === "openai-compatible"
          ? "openai-compatible"
          : fallback.ai.provider,
      baseUrl:
        typeof workspace.ai?.baseUrl === "string"
          ? workspace.ai.baseUrl
          : fallback.ai.baseUrl,
      apiKey:
        typeof workspace.ai?.apiKey === "string"
          ? workspace.ai.apiKey
          : fallback.ai.apiKey,
      model:
        typeof workspace.ai?.model === "string"
          ? workspace.ai.model
          : fallback.ai.model,
    },
    captures: Array.isArray(workspace.captures)
      ? workspace.captures.map((capture) => ({
          ...capture,
          aiTaskSuggestions: Array.isArray(capture?.aiTaskSuggestions)
            ? capture.aiTaskSuggestions.map((taskSuggestion) => ({
                ...taskSuggestion,
                checklist: normalizeChecklist(taskSuggestion?.checklist),
              }))
            : [],
        }))
      : [],
    sourceCards: Array.isArray(workspace.sourceCards) ? workspace.sourceCards : [],
    taskItems: Array.isArray(workspace.taskItems)
      ? workspace.taskItems.map((taskItem) => ({
          ...taskItem,
          checklist: normalizeChecklist(taskItem?.checklist),
        }))
      : [],
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

const shorten = (value, maxLength) => {
  if (!value) {
    return "";
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
};

const normalizeCapturedText = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const deriveSourceCardTitle = ({ rawText, sourceType, copy }) => {
  const firstLine =
    typeof rawText === "string"
      ? rawText
          .split(/\r?\n/)
          .map((item) => item.trim())
          .find(Boolean)
      : "";

  if (firstLine) {
    return shorten(firstLine, 42);
  }

  if (sourceType === "image") {
    return copy.fallbackImageTitle;
  }

  if (sourceType === "mixed") {
    return copy.fallbackMixedTitle;
  }

  return copy.fallbackQuickTitle;
};

const deriveSourceCardSummary = ({ rawText, sourceType, copy }) => {
  const normalizedText = normalizeCapturedText(rawText);

  if (normalizedText) {
    return shorten(normalizedText, 160);
  }

  if (sourceType === "image") {
    return copy.imageCaptureStored;
  }

  return copy.capturedForLaterReview;
};

const createTaskItemFromSuggestion = ({ suggestion, sourceCardId, createdAt }) => ({
  id: createId("task"),
  schemaVersion: SCHEMA_VERSION,
  boardId: BOARD_ID,
  title: suggestion.title,
  summary: suggestion.summary,
  status: "inbox",
  timeHint: suggestion.timeHint || null,
  priority: suggestion.timeHint ? "soon" : "normal",
  sourceCardIds: [sourceCardId],
  confidence: suggestion.confidence,
  checklist: normalizeChecklist(suggestion.checklist),
  createdAt,
  updatedAt: createdAt,
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

      const workspace = normalizeWorkspace(parsed);
      const copy = getDesktopCopy(workspace.ui.language);
      const captureById = new Map(
        workspace.captures.map((capture) => [capture.id, capture]),
      );

      workspace.sourceCards = workspace.sourceCards.map((sourceCard) => {
        const capture = captureById.get(sourceCard.captureId);

        if (!capture) {
          return sourceCard;
        }

        return {
          ...sourceCard,
          title: deriveSourceCardTitle({
            rawText: capture.rawText,
            sourceType: sourceCard.sourceType,
            copy,
          }),
          summary: deriveSourceCardSummary({
            rawText: capture.rawText,
            sourceType: sourceCard.sourceType,
            copy,
          }),
        };
      });

      return workspace;
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

  deleteAttachmentFiles(attachments) {
    attachments.forEach((attachment) => {
      const absolutePath = path.join(this.attachmentsDir, attachment.storageKey);

      if (!fs.existsSync(absolutePath)) {
        return;
      }

      try {
        fs.unlinkSync(absolutePath);
      } catch (error) {
        // Best-effort cleanup. Workspace consistency is more important than file deletion.
      }
    });
  }

  cleanupWorkspaceRelations(workspace, updatedAt) {
    const sourceCardIds = new Set(workspace.sourceCards.map((item) => item.id));

    workspace.taskItems = workspace.taskItems
      .map((taskItem) => {
        const nextSourceCardIds = taskItem.sourceCardIds.filter((sourceCardId) =>
          sourceCardIds.has(sourceCardId),
        );

        if (nextSourceCardIds.length === taskItem.sourceCardIds.length) {
          return taskItem;
        }

        return {
          ...taskItem,
          sourceCardIds: nextSourceCardIds,
          updatedAt,
        };
      })
      .filter((taskItem) => taskItem.sourceCardIds.length > 0);

    const taskIds = new Set(workspace.taskItems.map((item) => item.id));

    workspace.sourceCards.forEach((sourceCard) => {
      const nextLinkedTaskIds = sourceCard.linkedTaskIds.filter((taskId) =>
        taskIds.has(taskId),
      );

      if (nextLinkedTaskIds.length === sourceCard.linkedTaskIds.length) {
        return;
      }

      sourceCard.linkedTaskIds = nextLinkedTaskIds;
      sourceCard.updatedAt = updatedAt;
    });

    const captureIds = new Set(workspace.sourceCards.map((item) => item.captureId));
    workspace.captures = workspace.captures.filter((capture) => captureIds.has(capture.id));

    const attachmentIds = new Set(
      workspace.sourceCards.flatMap((sourceCard) => sourceCard.attachmentIds),
    );
    const removedAttachments = workspace.attachments.filter(
      (attachment) => !attachmentIds.has(attachment.id),
    );

    if (removedAttachments.length > 0) {
      this.deleteAttachmentFiles(removedAttachments);
    }

    workspace.attachments = workspace.attachments.filter((attachment) =>
      attachmentIds.has(attachment.id),
    );

    if (workspace.ui.lastCaptureId && !captureIds.has(workspace.ui.lastCaptureId)) {
      const fallbackCapture = workspace.captures[0] || null;
      workspace.ui.lastCaptureId = fallbackCapture?.id || null;
      workspace.ui.lastCaptureAt = fallbackCapture?.createdAt || null;
    }

    workspace.ui.activeCaptureCount = workspace.captures.filter(
      (item) => item.aiStatus === "queued" || item.aiStatus === "processing",
    ).length;
  }

  removeSourceCards(workspace, sourceCardIds, updatedAt) {
    const sourceCardIdSet = new Set(sourceCardIds);

    if (sourceCardIdSet.size === 0) {
      return;
    }

    workspace.sourceCards = workspace.sourceCards.filter(
      (sourceCard) => !sourceCardIdSet.has(sourceCard.id),
    );
    workspace.taskItems = workspace.taskItems.filter(
      (taskItem) =>
        !taskItem.sourceCardIds.some((sourceCardId) => sourceCardIdSet.has(sourceCardId)),
    );

    this.cleanupWorkspaceRelations(workspace, updatedAt);
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
      checklist: normalizeChecklist(task.checklist),
    }));
    capture.aiTimeSuggestion = analysis.timeHint;
    capture.tags = analysis.tags;
    capture.processedAt = updatedAt;
    capture.updatedAt = updatedAt;
    capture.errorMessage = null;

    const copy = getDesktopCopy(workspace.ui.language);
    sourceCard.title = deriveSourceCardTitle({
      rawText: capture.rawText,
      sourceType: sourceCard.sourceType,
      copy,
    });
    sourceCard.summary = deriveSourceCardSummary({
      rawText: capture.rawText,
      sourceType: sourceCard.sourceType,
      copy,
    });
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

    const copy = getDesktopCopy(workspace.ui.language);
    sourceCard.title = deriveSourceCardTitle({
      rawText: capture.rawText,
      sourceType: sourceCard.sourceType,
      copy,
    });
    sourceCard.summary = deriveSourceCardSummary({
      rawText: capture.rawText,
      sourceType: sourceCard.sourceType,
      copy,
    });
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

  reconcileSourceCardTasks(workspace, sourceCard, analysis, updatedAt) {
    const desiredSuggestions =
      Array.isArray(analysis?.taskSuggestions) && analysis.taskSuggestions.length > 0
        ? analysis.taskSuggestions
        : [
            {
              title: analysis?.sourceTitle || sourceCard.title,
              summary: analysis?.sourceSummary || sourceCard.summary,
              confidence: 0.58,
              timeHint: analysis?.timeHint || null,
            },
          ];
    const existingTasks = sourceCard.linkedTaskIds
      .map((taskId) => workspace.taskItems.find((item) => item.id === taskId))
      .filter((item) => Boolean(item));
    const nextLinkedTaskIds = [];
    const usedTaskIds = new Set();

    desiredSuggestions.forEach((suggestion, index) => {
      const existingTask = existingTasks[index];

      if (existingTask) {
        existingTask.title = suggestion.title;
        existingTask.summary = suggestion.summary;
        existingTask.timeHint = suggestion.timeHint || null;
        existingTask.priority = suggestion.timeHint ? "soon" : "normal";
        existingTask.confidence = suggestion.confidence;
        existingTask.checklist = normalizeChecklist(suggestion.checklist);
        if (!existingTask.sourceCardIds.includes(sourceCard.id)) {
          existingTask.sourceCardIds = [...existingTask.sourceCardIds, sourceCard.id];
        }
        existingTask.updatedAt = updatedAt;
        nextLinkedTaskIds.push(existingTask.id);
        usedTaskIds.add(existingTask.id);
        return;
      }

      const createdTask = createTaskItemFromSuggestion({
        suggestion,
        sourceCardId: sourceCard.id,
        createdAt: updatedAt,
      });
      workspace.taskItems.unshift(createdTask);
      nextLinkedTaskIds.push(createdTask.id);
      usedTaskIds.add(createdTask.id);
    });

    const removedTaskIds = existingTasks
      .filter((taskItem) => !usedTaskIds.has(taskItem.id))
      .map((taskItem) => taskItem.id);

    if (removedTaskIds.length > 0) {
      const removedTaskIdSet = new Set(removedTaskIds);

      workspace.taskItems = workspace.taskItems
        .map((taskItem) => {
          if (!removedTaskIdSet.has(taskItem.id)) {
            return taskItem;
          }

          const nextSourceCardIds = taskItem.sourceCardIds.filter(
            (sourceCardId) => sourceCardId !== sourceCard.id,
          );

          if (nextSourceCardIds.length === 0) {
            return null;
          }

          return {
            ...taskItem,
            sourceCardIds: nextSourceCardIds,
            updatedAt,
          };
        })
        .filter((taskItem) => Boolean(taskItem));
    }

    sourceCard.linkedTaskIds = nextLinkedTaskIds;
  }

  updateAnalyzedSourceCard({ sourceCardId, rawText, analysis }) {
    const workspace = this.readWorkspace();
    const sourceCard = workspace.sourceCards.find((item) => item.id === sourceCardId);

    if (!sourceCard) {
      return clone(workspace);
    }

    const capture = workspace.captures.find((item) => item.id === sourceCard.captureId);
    const updatedAt = nowIso();
    const copy = getDesktopCopy(workspace.ui.language);

    sourceCard.title = deriveSourceCardTitle({
      rawText,
      sourceType: sourceCard.sourceType,
      copy,
    });
    sourceCard.summary = deriveSourceCardSummary({
      rawText,
      sourceType: sourceCard.sourceType,
      copy,
    });
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
        checklist: normalizeChecklist(task.checklist),
      }));
      capture.aiTimeSuggestion = analysis.timeHint;
      capture.tags = analysis.tags;
      capture.processedAt = updatedAt;
      capture.updatedAt = updatedAt;
      capture.errorMessage = null;
    }

    this.reconcileSourceCardTasks(workspace, sourceCard, analysis, updatedAt);
    this.cleanupWorkspaceRelations(workspace, updatedAt);

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
    taskItem.updatedAt = updatedAt;
    workspace.board.updatedAt = updatedAt;
    workspace.updatedAt = updatedAt;

    this.writeWorkspace(workspace);

    return clone(workspace);
  }

  updateTaskSummary(taskId, summary) {
    const workspace = this.readWorkspace();
    const taskItem = workspace.taskItems.find((item) => item.id === taskId);

    if (!taskItem) {
      return clone(workspace);
    }

    const updatedAt = nowIso();
    taskItem.summary = summary;
    taskItem.updatedAt = updatedAt;
    workspace.board.updatedAt = updatedAt;
    workspace.updatedAt = updatedAt;

    this.writeWorkspace(workspace);

    return clone(workspace);
  }

  deleteTask(taskId) {
    const workspace = this.readWorkspace();
    const taskItem = workspace.taskItems.find((item) => item.id === taskId);

    if (!taskItem) {
      return clone(workspace);
    }

    const updatedAt = nowIso();
    workspace.taskItems = workspace.taskItems.filter((item) => item.id !== taskId);

    workspace.sourceCards.forEach((sourceCard) => {
      if (!sourceCard.linkedTaskIds.includes(taskId)) {
        return;
      }

      sourceCard.linkedTaskIds = sourceCard.linkedTaskIds.filter((id) => id !== taskId);
      sourceCard.updatedAt = updatedAt;
    });

    this.cleanupWorkspaceRelations(workspace, updatedAt);

    if (
      taskItem.sourceCardIds.length > 0 &&
      workspace.sourceCards.some((sourceCard) =>
        taskItem.sourceCardIds.includes(sourceCard.id),
      )
    ) {
      workspace.sourceCards.forEach((sourceCard) => {
        if (!taskItem.sourceCardIds.includes(sourceCard.id)) {
          return;
        }

        sourceCard.updatedAt = updatedAt;
      });
    }

    workspace.board.updatedAt = updatedAt;
    workspace.updatedAt = updatedAt;

    this.writeWorkspace(workspace);

    return clone(workspace);
  }

  deleteSourceCard(sourceCardId) {
    const workspace = this.readWorkspace();

    if (!workspace.sourceCards.some((item) => item.id === sourceCardId)) {
      return clone(workspace);
    }

    const updatedAt = nowIso();
    this.removeSourceCards(workspace, [sourceCardId], updatedAt);
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

  updateAiConfig(config) {
    const workspace = this.readWorkspace();
    const updatedAt = nowIso();

    workspace.ai = {
      provider:
        config?.provider === "openai-compatible" ? "openai-compatible" : "local",
      baseUrl: typeof config?.baseUrl === "string" ? config.baseUrl.trim() : "",
      apiKey: typeof config?.apiKey === "string" ? config.apiKey.trim() : "",
      model: typeof config?.model === "string" ? config.model.trim() : "",
    };
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
