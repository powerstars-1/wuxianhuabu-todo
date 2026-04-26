const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { LocalWorkspaceRepository } = require("./repositories/localWorkspaceRepository.cjs");
const { CapturePipeline } = require("./services/capturePipeline.cjs");

const createPipelineHarness = (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-inbox-capture-pipeline-"));
  const repository = new LocalWorkspaceRepository(baseDir);
  const pipeline = new CapturePipeline({
    repository,
    localAiAdapter: {
      analyzeCapture: async () => ({
        sourceTitle: "stub",
        sourceSummary: "stub",
        timeHint: null,
        tags: [],
        taskSuggestions: [],
      }),
    },
    remoteAiAdapter: {
      analyzeCapture: async () => ({
        sourceTitle: "stub",
        sourceSummary: "stub",
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
    repository,
    pipeline,
  };
};

test("reuses an existing text capture when the same text is captured again", (t) => {
  const { pipeline } = createPipelineHarness(t);
  const firstCapture = pipeline.enqueueManualTextPayload({
    text: "Follow up with the client tomorrow morning",
  });

  const duplicateCapture = pipeline.enqueueClipboardPayload({
    text: " Follow   up with the client tomorrow morning ",
    imagePngBuffer: null,
  });

  assert.ok(firstCapture.pendingCapture);
  assert.equal(duplicateCapture.pendingCapture, null);
  assert.equal(duplicateCapture.duplicateCaptureId, firstCapture.pendingCapture.captureId);
  assert.equal(duplicateCapture.initialSnapshot.captures.length, 1);
  assert.equal(
    duplicateCapture.initialSnapshot.ui.lastCaptureId,
    firstCapture.pendingCapture.captureId,
  );
});

test("allows a retry when the previous capture failed", (t) => {
  const { pipeline, repository } = createPipelineHarness(t);
  const firstCapture = pipeline.enqueueManualTextPayload({
    text: "Summarize the launch plan for next Friday",
  });

  repository.markCaptureFailed({
    captureId: firstCapture.pendingCapture.captureId,
    sourceCardId: firstCapture.pendingCapture.sourceCardId,
    errorMessage: "AI request failed.",
  });

  const retryCapture = pipeline.enqueueClipboardPayload({
    text: "Summarize the launch plan for next Friday",
    imagePngBuffer: null,
  });

  assert.ok(retryCapture.pendingCapture);
  assert.notEqual(retryCapture.pendingCapture.captureId, firstCapture.pendingCapture.captureId);
  assert.equal(retryCapture.initialSnapshot.captures.length, 2);
});
