const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { LocalWorkspaceRepository } = require("./repositories/localWorkspaceRepository.cjs");
const { CapturePipeline } = require("./services/capturePipeline.cjs");

const createHarness = (t, analysis) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-inbox-source-card-"));
  const repository = new LocalWorkspaceRepository(baseDir);
  const pipeline = new CapturePipeline({
    repository,
    localAiAdapter: {
      analyzeCapture: async () => analysis,
    },
    remoteAiAdapter: {
      analyzeCapture: async () => analysis,
    },
    prepareVisionAttachmentDataUrls: () => [],
  });

  t.after(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  return {
    repository,
    pipeline,
  };
};

test("stores AI source title and summary on the source card after analysis", async (t) => {
  const analysis = {
    sourceTitle: "Prepare overseas utility app shortlist",
    sourceSummary: "Review candidate paid utility ideas and narrow them to three options.",
    timeHint: "this week",
    tags: ["research"],
    taskSuggestions: [],
  };
  const { repository, pipeline } = createHarness(t, analysis);
  const queuedCapture = pipeline.enqueueManualTextPayload({
    text: "做一个海外付费工具 app 的方向筛选",
  });

  await pipeline.completePendingCapture(queuedCapture.pendingCapture);

  const snapshot = repository.getSnapshot();
  const sourceCard = snapshot.sourceCards[0];

  assert.equal(sourceCard.title, analysis.sourceTitle);
  assert.equal(sourceCard.summary, analysis.sourceSummary);
});

test("updates source card title and summary without re-running analysis", async (t) => {
  const analysis = {
    sourceTitle: "Initial AI title",
    sourceSummary: "Initial AI summary",
    timeHint: null,
    tags: [],
    taskSuggestions: [],
  };
  const { repository, pipeline } = createHarness(t, analysis);
  const queuedCapture = pipeline.enqueueManualTextPayload({
    text: "整理这条收录",
  });

  await pipeline.completePendingCapture(queuedCapture.pendingCapture);

  const updatedSnapshot = repository.updateSourceCardDetails(queuedCapture.pendingCapture.sourceCardId, {
    title: "Edited source title",
    summary: "Edited source summary",
  });
  const sourceCard = updatedSnapshot.sourceCards[0];
  const capture = updatedSnapshot.captures[0];

  assert.equal(sourceCard.title, "Edited source title");
  assert.equal(sourceCard.summary, "Edited source summary");
  assert.equal(capture.aiSummary, "Edited source summary");
});

test("preserves edited source title and summary after reloading the workspace", async (t) => {
  const analysis = {
    sourceTitle: "Initial AI title",
    sourceSummary: "Initial AI summary",
    timeHint: null,
    tags: [],
    taskSuggestions: [],
  };
  const { repository, pipeline } = createHarness(t, analysis);
  const queuedCapture = pipeline.enqueueManualTextPayload({
    text: "把来源信息持久化",
  });

  await pipeline.completePendingCapture(queuedCapture.pendingCapture);
  repository.updateSourceCardDetails(queuedCapture.pendingCapture.sourceCardId, {
    title: "Persistent edited title",
    summary: "Persistent edited summary",
  });

  const reloadedRepository = new LocalWorkspaceRepository(repository.baseDir);
  const reloadedSnapshot = reloadedRepository.getSnapshot();

  assert.equal(reloadedSnapshot.sourceCards[0].title, "Persistent edited title");
  assert.equal(reloadedSnapshot.sourceCards[0].summary, "Persistent edited summary");
});
