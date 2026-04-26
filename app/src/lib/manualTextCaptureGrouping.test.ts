import test from "node:test";
import assert from "node:assert/strict";

import { groupManualTextCaptureCandidates } from "./manualTextCaptureGrouping.ts";

test("groups vertically stacked pasted text elements into one capture", () => {
  const result = groupManualTextCaptureCandidates([
    {
      id: "text-1",
      text: "第一段：调研海外付费下载应用",
      x: 120,
      y: 120,
    },
    {
      id: "text-2",
      text: "第二段：补充产品矩阵和定价约束",
      x: 122,
      y: 186,
    },
    {
      id: "text-3",
      text: "第三段：说明希望优先做单功能工具",
      x: 121,
      y: 252,
    },
  ]);

  assert.deepEqual(result, [
    {
      elementIds: ["text-1", "text-2", "text-3"],
      text: [
        "第一段：调研海外付费下载应用",
        "第二段：补充产品矩阵和定价约束",
        "第三段：说明希望优先做单功能工具",
      ].join("\n\n"),
      position: {
        x: 120,
        y: 120,
      },
    },
  ]);
});

test("keeps distant standalone notes as separate captures", () => {
  const result = groupManualTextCaptureCandidates([
    {
      id: "text-1",
      text: "整理周会纪要",
      x: 120,
      y: 120,
    },
    {
      id: "text-2",
      text: "联系设计确认海报",
      x: 420,
      y: 420,
    },
  ]);

  assert.deepEqual(result, [
    {
      elementIds: ["text-1"],
      text: "整理周会纪要",
      position: {
        x: 120,
        y: 120,
      },
    },
    {
      elementIds: ["text-2"],
      text: "联系设计确认海报",
      position: {
        x: 420,
        y: 420,
      },
    },
  ]);
});

test("keeps pasted trailing lines grouped even when Excalidraw shifts x noticeably", () => {
  const result = groupManualTextCaptureCandidates([
    {
      id: "text-1",
      text: "我现在需要你做一个产品调研。产品是ios产品，要做一个付费下载或者永久付费类\n型的app，一般单价在10美元以内，主做海外市场\n\n。我想做产品矩阵，单个产品只做一个功能，这个功能是人们在生活和工作中遇到问\n题急需且刚需的工具，以此变现。这样开发成本也",
      x: -204.37,
      y: 6.75,
    },
    {
      id: "text-2",
      text: "低，速度也快。",
      x: 89.5,
      y: 139.25,
    },
  ]);

  assert.deepEqual(result, [
    {
      elementIds: ["text-1", "text-2"],
      text: [
        "我现在需要你做一个产品调研。产品是ios产品，要做一个付费下载或者永久付费类\n型的app，一般单价在10美元以内，主做海外市场\n\n。我想做产品矩阵，单个产品只做一个功能，这个功能是人们在生活和工作中遇到问\n题急需且刚需的工具，以此变现。这样开发成本也",
        "低，速度也快。",
      ].join("\n\n"),
      position: {
        x: -204.37,
        y: 6.75,
      },
    },
  ]);
});
