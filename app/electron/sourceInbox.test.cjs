const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { LocalWorkspaceRepository } = require("./repositories/localWorkspaceRepository.cjs");
const { CapturePipeline } = require("./services/capturePipeline.cjs");

const createHarness = (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-inbox-source-inbox-"));
  const repository = new LocalWorkspaceRepository(baseDir);
  const pipeline = new CapturePipeline({
    repository,
    localAiAdapter: {
      analyzeCapture: async () => ({
        sourceTitle: "Stub title",
        sourceSummary: "Stub summary",
        timeHint: null,
        tags: [],
        taskSuggestions: [],
      }),
    },
    remoteAiAdapter: {
      analyzeCapture: async () => ({
        sourceTitle: "Stub title",
        sourceSummary: "Stub summary",
        timeHint: null,
        tags: [],
        taskSuggestions: [],
      }),
    },
    prepareVisionAttachmentDataUrls: () => [],
  });

  t.after(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  return {
    baseDir,
    repository,
    pipeline,
  };
};

test("new captures enter the source inbox by default", (t) => {
  const { pipeline } = createHarness(t);
  const queuedCapture = pipeline.enqueueManualTextPayload({
    text: "Review the next capture",
  });

  assert.equal(queuedCapture.initialSnapshot.sourceCards[0].reviewStatus, "inbox");
});

test("legacy workspaces treat sources without review status as accepted", (t) => {
  const { baseDir } = createHarness(t);
  const legacyWorkspace = {
    schemaVersion: 1,
    updatedAt: "2026-04-26T00:00:00.000Z",
    board: {
      id: "board_local_main",
      schemaVersion: 1,
      name: "Canvas Inbox",
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    },
    ai: {
      provider: "local",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      hasApiKey: false,
    },
    captures: [
      {
        id: "capture_legacy",
        schemaVersion: 1,
        createdAt: "2026-04-26T00:00:00.000Z",
        updatedAt: "2026-04-26T00:00:00.000Z",
        sourceType: "text",
        rawText: "legacy source",
        attachmentIds: [],
        aiStatus: "done",
        aiSummary: "legacy summary",
        aiTaskSuggestions: [],
        aiTimeSuggestion: null,
        tags: [],
      },
    ],
    sourceCards: [
      {
        id: "source_legacy",
        schemaVersion: 1,
        captureId: "capture_legacy",
        boardId: "board_local_main",
        title: "legacy title",
        summary: "legacy summary",
        position: { x: 120, y: 120 },
        sourceType: "text",
        attachmentIds: [],
        linkedTaskIds: [],
        tags: [],
        createdAt: "2026-04-26T00:00:00.000Z",
        updatedAt: "2026-04-26T00:00:00.000Z",
      },
    ],
    taskItems: [],
    attachments: [],
    ui: {
      language: "zh-CN",
      shortcut: "CommandOrControl+Shift+V",
      captureStatus: "ready",
      captureMessage: "legacy",
      lastCaptureId: "capture_legacy",
      lastCaptureAt: "2026-04-26T00:00:00.000Z",
      activeCaptureCount: 0,
      captureFeed: [],
    },
  };

  fs.writeFileSync(
    path.join(baseDir, "workspace.json"),
    JSON.stringify(legacyWorkspace, null, 2),
    "utf8",
  );

  const repository = new LocalWorkspaceRepository(baseDir);
  const snapshot = repository.getSnapshot();

  assert.equal(snapshot.sourceCards[0].reviewStatus, "accepted");
});

test("legacy orphaned accepted sources with AI task suggestions are archived on load", (t) => {
  const { baseDir } = createHarness(t);
  const legacyWorkspace = {
    schemaVersion: 1,
    updatedAt: "2026-04-26T00:00:00.000Z",
    board: {
      id: "board_local_main",
      schemaVersion: 1,
      name: "Canvas Inbox",
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    },
    ai: {
      provider: "local",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      hasApiKey: false,
    },
    captures: [
      {
        id: "capture_orphaned",
        schemaVersion: 1,
        createdAt: "2026-04-26T00:00:00.000Z",
        updatedAt: "2026-04-26T00:00:00.000Z",
        sourceType: "text",
        rawText: "orphaned source",
        attachmentIds: [],
        aiStatus: "done",
        aiSummary: "legacy summary",
        aiTaskSuggestions: [
          {
            title: "Legacy orphaned task",
            summary: "This source used to have a generated task.",
            confidence: 0.6,
            timeHint: null,
            checklist: [],
          },
        ],
        aiTimeSuggestion: null,
        tags: [],
      },
    ],
    sourceCards: [
      {
        id: "source_orphaned",
        schemaVersion: 1,
        captureId: "capture_orphaned",
        boardId: "board_local_main",
        title: "orphaned title",
        summary: "legacy summary",
        reviewStatus: "accepted",
        position: { x: 120, y: 120 },
        sourceType: "text",
        attachmentIds: [],
        linkedTaskIds: [],
        tags: [],
        createdAt: "2026-04-26T00:00:00.000Z",
        updatedAt: "2026-04-26T00:00:00.000Z",
      },
    ],
    taskItems: [],
    attachments: [],
    ui: {
      language: "zh-CN",
      shortcut: "CommandOrControl+Shift+V",
      captureStatus: "ready",
      captureMessage: "legacy",
      lastCaptureId: "capture_orphaned",
      lastCaptureAt: "2026-04-26T00:00:00.000Z",
      activeCaptureCount: 0,
      captureFeed: [],
    },
  };

  fs.writeFileSync(
    path.join(baseDir, "workspace.json"),
    JSON.stringify(legacyWorkspace, null, 2),
    "utf8",
  );

  const repository = new LocalWorkspaceRepository(baseDir);
  const snapshot = repository.getSnapshot();

  assert.equal(snapshot.sourceCards[0].reviewStatus, "archived");
});

test("source inbox actions persist accepted and archived states", async (t) => {
  const { repository, pipeline } = createHarness(t);
  const queuedCapture = pipeline.enqueueManualTextPayload({
    text: "Accept this source",
  });

  await pipeline.completePendingCapture(queuedCapture.pendingCapture);

  const acceptedSnapshot = repository.updateSourceCardReviewStatus(
    queuedCapture.pendingCapture.sourceCardId,
    "accepted",
  );
  const archivedSnapshot = repository.updateSourceCardReviewStatus(
    queuedCapture.pendingCapture.sourceCardId,
    "archived",
  );

  assert.equal(acceptedSnapshot.sourceCards[0].reviewStatus, "accepted");
  assert.equal(archivedSnapshot.sourceCards[0].reviewStatus, "archived");
});
