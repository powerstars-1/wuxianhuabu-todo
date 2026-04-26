const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { LocalWorkspaceRepository } = require("./repositories/localWorkspaceRepository.cjs");
const { CapturePipeline } = require("./services/capturePipeline.cjs");

const createHarness = (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-inbox-task-delete-"));
  const repository = new LocalWorkspaceRepository(baseDir);
  const pipeline = new CapturePipeline({
    repository,
    localAiAdapter: {
      analyzeCapture: async () => ({
        sourceTitle: "Delete task source",
        sourceSummary: "A single accepted source with one linked task.",
        timeHint: null,
        tags: [],
        taskSuggestions: [
          {
            title: "Delete the only linked task",
            summary: "The accepted source should no longer stay visible on the canvas.",
            confidence: 0.8,
            timeHint: null,
            checklist: [],
          },
        ],
      }),
    },
    remoteAiAdapter: {
      analyzeCapture: async () => ({
        sourceTitle: "Delete task source",
        sourceSummary: "A single accepted source with one linked task.",
        timeHint: null,
        tags: [],
        taskSuggestions: [
          {
            title: "Delete the only linked task",
            summary: "The accepted source should no longer stay visible on the canvas.",
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

test("deleteTask archives an accepted source when its only linked task is removed", async (t) => {
  const { repository, pipeline } = createHarness(t);
  const queuedCapture = pipeline.enqueueManualTextPayload({
    text: "Delete the only task and close out the source.",
  });

  await pipeline.completePendingCapture(queuedCapture.pendingCapture);

  const sourceCardId = queuedCapture.pendingCapture.sourceCardId;
  const acceptedSnapshot = repository.updateSourceCardReviewStatus(sourceCardId, "accepted");
  const sourceCard = acceptedSnapshot.sourceCards.find((item) => item.id === sourceCardId);
  const taskId = sourceCard?.linkedTaskIds[0] || null;

  assert.ok(taskId, "expected the accepted source to have a linked task before deletion");

  const deletedSnapshot = repository.deleteTask(taskId);
  const nextSourceCard = deletedSnapshot.sourceCards.find((item) => item.id === sourceCardId);

  assert.equal(deletedSnapshot.taskItems.length, 0);
  assert.equal(nextSourceCard?.linkedTaskIds.length, 0);
  assert.equal(nextSourceCard?.reviewStatus, "archived");
});
