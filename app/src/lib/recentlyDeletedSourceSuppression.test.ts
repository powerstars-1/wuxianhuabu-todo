import test from "node:test";
import assert from "node:assert/strict";

import {
  pruneRecentlyDeletedSources,
  rememberRecentlyDeletedSource,
  shouldSuppressRecentlyDeletedSourceText,
} from "./recentlyDeletedSourceSuppression.ts";

test("suppresses text near a just-deleted source card with the same title", () => {
  const now = 1_000;
  const entries = rememberRecentlyDeletedSource(
    [],
    {
      title: "同程旅行权益超时未配置告警",
      position: { x: 600, y: 320 },
    },
    now,
  );

  assert.equal(
    shouldSuppressRecentlyDeletedSourceText(
      {
        text: "同程旅行权益超时未配置告警",
        x: 620,
        y: 360,
      },
      entries,
      now + 200,
    ),
    true,
  );
});

test("does not suppress unrelated manual text", () => {
  const now = 1_000;
  const entries = rememberRecentlyDeletedSource(
    [],
    {
      title: "同程旅行权益超时未配置告警",
      position: { x: 600, y: 320 },
    },
    now,
  );

  assert.equal(
    shouldSuppressRecentlyDeletedSourceText(
      {
        text: "真正新加的一条便签",
        x: 620,
        y: 360,
      },
      entries,
      now + 200,
    ),
    false,
  );
});

test("suppresses wrapped title text that only differs by inserted line breaks", () => {
  const now = 1_000;
  const entries = rememberRecentlyDeletedSource(
    [],
    {
      title: "同程旅行权益超时未配置告警",
      position: { x: 600, y: 320 },
    },
    now,
  );

  assert.equal(
    shouldSuppressRecentlyDeletedSourceText(
      {
        text: "同程旅行权益超时\n未配置告警",
        x: 620,
        y: 360,
      },
      entries,
      now + 200,
    ),
    true,
  );
});

test("expires suppression after the grace window", () => {
  const now = 1_000;
  const entries = rememberRecentlyDeletedSource(
    [],
    {
      title: "同程旅行权益超时未配置告警",
      position: { x: 600, y: 320 },
    },
    now,
  );

  const expiredEntries = pruneRecentlyDeletedSources(entries, now + 5_000);

  assert.equal(expiredEntries.length, 0);
  assert.equal(
    shouldSuppressRecentlyDeletedSourceText(
      {
        text: "同程旅行权益超时未配置告警",
        x: 620,
        y: 360,
      },
      entries,
      now + 5_000,
    ),
    false,
  );
});
