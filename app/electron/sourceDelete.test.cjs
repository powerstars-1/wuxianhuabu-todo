const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { LocalWorkspaceRepository } = require("./repositories/localWorkspaceRepository.cjs");
const { CapturePipeline } = require("./services/capturePipeline.cjs");

const createHarness = (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-inbox-source-delete-"));
  const repository = new LocalWorkspaceRepository(baseDir);
  const pipeline = new CapturePipeline({
    repository,
    localAiAdapter: {
      analyzeCapture: async () => ({
        sourceTitle: "Delete source",
        sourceSummary: "Delete the entire source card from the canvas.",
        timeHint: null,
        tags: [],
        taskSuggestions: [
          {
            title: "Confirm the source can be deleted",
            summary: "The linked task should disappear with the source.",
            confidence: 0.8,
            timeHint: null,
            checklist: [],
          },
        ],
      }),
    },
    remoteAiAdapter: {
      analyzeCapture: async () => ({
        sourceTitle: "Delete source",
        sourceSummary: "Delete the entire source card from the canvas.",
        timeHint: null,
        tags: [],
        taskSuggestions: [
          {
            title: "Confirm the source can be deleted",
            summary: "The linked task should disappear with the source.",
            confidence: 0.8,
            timeHint: null,
            checklist: [],
          },
        ],
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

test("deleteSourceCard removes the source, its capture, and linked tasks", async (t) => {
  const { repository, pipeline } = createHarness(t);
  const queuedCapture = pipeline.enqueueManualTextPayload({
    text: "Delete this source from the inspector",
  });

  await pipeline.completePendingCapture(queuedCapture.pendingCapture);

  const deletedSnapshot = repository.deleteSourceCard(
    queuedCapture.pendingCapture.sourceCardId,
  );

  assert.equal(deletedSnapshot.sourceCards.length, 0);
  assert.equal(deletedSnapshot.captures.length, 0);
  assert.equal(deletedSnapshot.taskItems.length, 0);
});
