import test from "node:test";
import assert from "node:assert/strict";

import { buildCaptureEventKey } from "./captureFocus.ts";

test("buildCaptureEventKey changes when the same capture id is reused later", () => {
  const firstEventKey = buildCaptureEventKey(
    "capture_existing",
    "2026-04-26T02:00:00.000Z",
  );
  const secondEventKey = buildCaptureEventKey(
    "capture_existing",
    "2026-04-26T02:05:00.000Z",
  );

  assert.notEqual(firstEventKey, secondEventKey);
});

test("buildCaptureEventKey falls back to the capture id when no timestamp is available", () => {
  assert.equal(buildCaptureEventKey("capture_existing", null), "capture_existing");
});

test("buildCaptureEventKey returns null when no capture id is available", () => {
  assert.equal(buildCaptureEventKey(null, "2026-04-26T02:00:00.000Z"), null);
});
