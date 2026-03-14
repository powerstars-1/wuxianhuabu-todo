const { getDesktopCopy } = require("../i18n.cjs");

const ACTION_KEYWORDS = [
  "请",
  "需要",
  "记得",
  "确认",
  "安排",
  "提交",
  "跟进",
  "回复",
  "发送",
  "整理",
  "处理",
  "review",
  "follow up",
  "send",
  "prepare",
  "draft",
  "todo",
];

const TAG_RULES = [
  { tag: "work", keywords: ["老板", "客户", "方案", "汇报", "review", "meeting"] },
  { tag: "follow-up", keywords: ["跟进", "回复", "确认", "回头", "follow up"] },
  { tag: "schedule", keywords: ["今天", "明天", "下周", "周", "星期", "deadline"] },
  { tag: "asset", keywords: ["截图", "图片", "海报", "素材", "image"] },
];

const TIME_HINT_PATTERN =
  /(今天|明天|后天|本周|下周|下个月|月底|月初|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}[月/-]\d{1,2}(?:日)?|\d{1,2}:\d{2})/i;
const LIST_ITEM_PATTERN = /^\s*(?:[-*•]|\d+[.)、]|[（(]\d+[）)])\s*/;
const POLITE_PREFIX_PATTERN =
  /^(?:留个言|辛苦你|辛苦|麻烦你|麻烦|请你|请|记得|帮忙|帮我|回头|有空|抽空)[，,、\s]*/i;
const COORDINATION_PATTERN = /(以及|并且|同时|另外|顺便|附带|还有|补充|说明|如下|需求|数据|信息|指标)/i;

const shorten = (value, maxLength) => {
  if (!value) {
    return "";
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
};

const cleanupLine = (line) =>
  line
    .replace(LIST_ITEM_PATTERN, "")
    .replace(/^\s*\[[ xX]?\]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

const includesActionKeyword = (line) => {
  const lowerLine = line.toLowerCase();
  return ACTION_KEYWORDS.some((keyword) => lowerLine.includes(keyword.toLowerCase()));
};

class LocalAiAdapter {
  analyzeCapture({ rawText, sourceType, language }) {
    const copy = getDesktopCopy(language);
    const normalizedText = (rawText || "").replace(/\s+/g, " ").trim();
    const lineDetails = (rawText || "")
      .split(/\r?\n/)
      .map((rawLine) => ({
        rawLine,
        cleanLine: cleanupLine(rawLine),
        isListItem: LIST_ITEM_PATTERN.test(rawLine),
      }))
      .filter((item) => item.cleanLine);
    const lines = lineDetails.map((item) => item.cleanLine);

    const timeHint = this.extractTimeHint(rawText);
    const sourceTitle =
      normalizedText && normalizedText.length > 0
        ? shorten(lines[0] || normalizedText, 42)
        : sourceType === "image"
          ? copy.fallbackImageTitle
          : copy.fallbackQuickTitle;

    const sourceSummary =
      normalizedText && normalizedText.length > 0
        ? shorten(normalizedText, 160)
        : copy.imageCaptureStored;

    const taskSuggestions = this.extractTaskSuggestions(
      lineDetails,
      timeHint,
      sourceTitle,
      copy,
    );
    const tags = this.extractTags(rawText, sourceType);

    return {
      sourceTitle,
      sourceSummary,
      timeHint,
      tags,
      taskSuggestions,
    };
  }

  extractTaskSuggestions(lineDetails, timeHint, fallbackTitle, copy) {
    const lines = lineDetails.map((item) => item.cleanLine);
    const mainTaskWithChecklist = this.extractChecklistTask(
      lineDetails,
      timeHint,
      fallbackTitle,
      copy,
    );

    if (mainTaskWithChecklist) {
      return [mainTaskWithChecklist];
    }

    const actionable = lines.filter((line) => includesActionKeyword(line));
    const independentTaskLines = this.extractIndependentTaskLines(lineDetails);

    if (independentTaskLines.length >= 2) {
      return independentTaskLines.slice(0, 3).map((line, index) => ({
        title: shorten(line, 52),
        summary: line,
        confidence: 0.82 - index * 0.07,
        timeHint: this.extractTimeHint(line) || timeHint,
        checklist: [],
      }));
    }

    const primaryLine = actionable[0] || lines[0] || "";

    if (!primaryLine) {
      return [
        {
          title: fallbackTitle,
          summary: copy.capturedForLaterReview,
          confidence: 0.42,
          timeHint,
          checklist: [],
        },
      ];
    }

    return [
      {
        title: shorten(primaryLine, 52),
        summary:
          lines.length > 1
            ? shorten(lines.join("；"), 120)
            : primaryLine,
        confidence: actionable.length > 0 ? 0.78 : 0.58,
        timeHint: this.extractTimeHint(primaryLine) || timeHint,
        checklist: [],
      },
    ];
  }

  extractChecklistTask(lineDetails, timeHint, fallbackTitle, copy) {
    const listItems = lineDetails
      .filter((item) => item.isListItem)
      .map((item) => item.cleanLine)
      .slice(0, 6);
    const introLine =
      lineDetails.find((item) => !item.isListItem)?.cleanLine ||
      "";

    if (listItems.length < 2 || !introLine) {
      return null;
    }

    const normalizedTitle = this.normalizeChecklistTitle(introLine, fallbackTitle);

    return {
      title: shorten(normalizedTitle || fallbackTitle, 52),
      summary: `包含 ${listItems.length} 个关键信息项，建议作为一条主任务统一整理。`,
      confidence: 0.88,
      timeHint,
      checklist: listItems,
    };
  }

  normalizeChecklistTitle(line, fallbackTitle) {
    const trimmedLine = (line || "").trim().replace(/[~～。！!]+$/g, "");

    if (!trimmedLine) {
      return fallbackTitle;
    }

    let value = trimmedLine;

    while (POLITE_PREFIX_PATTERN.test(value)) {
      value = value.replace(POLITE_PREFIX_PATTERN, "");
    }

    value = value
      .replace(/帮忙看一下/gi, "查看")
      .replace(/帮忙看下/gi, "查看")
      .replace(/帮我看一下/gi, "查看")
      .replace(/帮我看下/gi, "查看")
      .replace(/看一下/gi, "查看")
      .replace(/看下/gi, "查看")
      .replace(/\s+/g, " ")
      .trim();

    return value || fallbackTitle;
  }

  extractIndependentTaskLines(lineDetails) {
    if (lineDetails.length < 2 || lineDetails.length > 4) {
      return [];
    }

    const lines = lineDetails.map((item) => item.cleanLine);
    const allListItems = lineDetails.every((item) => item.isListItem);

    if (allListItems && lines.every((line) => includesActionKeyword(line))) {
      return lines;
    }

    const hasIntroOrCoordination = lines.some((line) => COORDINATION_PATTERN.test(line));
    const allStandaloneActions =
      lineDetails.every((item) => !item.isListItem) &&
      lines.every((line) => includesActionKeyword(line) && line.length <= 52);

    if (allStandaloneActions && !hasIntroOrCoordination) {
      return lines;
    }

    return [];
  }

  extractTimeHint(text) {
    if (!text) {
      return null;
    }

    const match = text.match(TIME_HINT_PATTERN);
    return match ? match[0] : null;
  }

  extractTags(rawText, sourceType) {
    const lowered = (rawText || "").toLowerCase();
    const tags = TAG_RULES.filter((rule) =>
      rule.keywords.some((keyword) => lowered.includes(keyword.toLowerCase())),
    ).map((rule) => rule.tag);

    if (sourceType === "image") {
      tags.push("image");
    }

    return Array.from(new Set(tags)).slice(0, 4);
  }
}

module.exports = {
  LocalAiAdapter,
};
