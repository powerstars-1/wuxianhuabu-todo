const {
  BOARD_ID,
  SCHEMA_VERSION,
  createId,
} = require("../repositories/localWorkspaceRepository.cjs");
const { getDesktopCopy } = require("../i18n.cjs");

class CapturePipeline {
  constructor({ repository, localAiAdapter, remoteAiAdapter }) {
    this.repository = repository;
    this.localAiAdapter = localAiAdapter;
    this.remoteAiAdapter = remoteAiAdapter;
  }

  enqueueClipboardPayload(payload) {
    return this.enqueuePayload({
      text: payload.text,
      imagePngBuffer: payload.imagePngBuffer,
    });
  }

  enqueueManualTextPayload(payload) {
    return this.enqueuePayload({
      text: payload.text,
      imagePngBuffer: null,
      position: payload.position,
    });
  }

  enqueuePayload(payload) {
    const hasText = Boolean(payload.text && payload.text.trim().length > 0);
    const attachments = [];

    if (payload.imagePngBuffer) {
      attachments.push(this.repository.createAttachmentFromPng(payload.imagePngBuffer));
    }

    if (!hasText && attachments.length === 0) {
      throw new Error("Clipboard is empty.");
    }

    const sourceType = this.resolveSourceType(hasText, attachments.length > 0);
    const snapshot = this.repository.getSnapshot();
    const language = snapshot.ui.language;
    const copy = getDesktopCopy(language);
    const createdAt = new Date().toISOString();
    const captureId = createId("capture");
    const sourceCardId = createId("source");
    const position = payload.position || this.getNextCardPosition(snapshot.sourceCards.length);
    const draftTitle = this.deriveDraftTitle({
      rawText: payload.text || "",
      sourceType,
      language,
    });

    const capture = {
      id: captureId,
      schemaVersion: SCHEMA_VERSION,
      createdAt,
      updatedAt: createdAt,
      sourceType,
      rawText: payload.text || "",
      attachmentIds: attachments.map((item) => item.id),
      aiStatus: "processing",
      aiSummary: copy.analyzingCaptureSummary,
      aiTaskSuggestions: [],
      aiTimeSuggestion: null,
      tags: [],
      ocrText: null,
      processedAt: null,
      errorMessage: null,
    };

    const sourceCard = {
      id: sourceCardId,
      schemaVersion: SCHEMA_VERSION,
      captureId,
      boardId: BOARD_ID,
      title: draftTitle,
      summary: copy.analyzingCardSummary,
      tags: [],
      position,
      sourceType,
      attachmentIds: attachments.map((item) => item.id),
      linkedTaskIds: [],
      createdAt,
      updatedAt: createdAt,
    };

    const nextSnapshot = this.repository.enqueueCapture({
      capture,
      sourceCard,
      attachments,
      message: copy.recordedToCanvasOrganizing,
    });

    return {
      initialSnapshot: nextSnapshot,
      pendingCapture: {
        captureId,
        sourceCardId,
        sourceType,
        rawText: payload.text || "",
        language,
      },
    };
  }

  async completePendingCapture({
    captureId,
    sourceCardId,
    sourceType,
    rawText,
    language,
  }) {
    // Small delay makes the staged pipeline visible and mirrors future async AI/OCR work.
    await new Promise((resolve) => setTimeout(resolve, 280));
    const workspaceSnapshot = this.repository.getSnapshot();
    const aiConfig = workspaceSnapshot.ai;
    const copy = getDesktopCopy(language);

    const adapter =
      aiConfig?.provider === "openai-compatible"
        ? this.remoteAiAdapter
        : this.localAiAdapter;
    const analysis = await adapter.analyzeCapture({
      rawText,
      sourceType,
      language,
      config: aiConfig,
    });
    const createdAt = new Date().toISOString();

    const taskItems = analysis.taskSuggestions.map((suggestion) => ({
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
      checklist: Array.isArray(suggestion.checklist) ? suggestion.checklist.slice(0, 6) : [],
      createdAt,
      updatedAt: createdAt,
    }));

    const message =
      taskItems.length > 0
        ? copy.captureSavedAndProjected(taskItems.length)
        : copy.captureSaved;

    const snapshot = this.repository.completeCaptureProcessing({
      captureId,
      sourceCardId,
      analysis,
      taskItems,
      message,
    });

    return {
      snapshot,
      taskItems,
    };
  }

  resolveSourceType(hasText, hasImage) {
    if (hasText && hasImage) {
      return "mixed";
    }

    if (hasImage) {
      return "image";
    }

    return "text";
  }

  getNextCardPosition(index) {
    const column = index % 3;
    const row = Math.floor(index / 3);

    return {
      x: 120 + column * 360,
      y: 120 + row * 240,
    };
  }

  deriveDraftTitle({ rawText, sourceType, language }) {
    const copy = getDesktopCopy(language);
    const firstLine = (rawText || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find(Boolean);

    if (firstLine) {
      return firstLine.slice(0, 42);
    }

    if (sourceType === "image") {
      return copy.fallbackImageTitle;
    }

    if (sourceType === "mixed") {
      return copy.fallbackMixedTitle;
    }

    return copy.fallbackQuickTitle;
  }
}

module.exports = {
  CapturePipeline,
};
