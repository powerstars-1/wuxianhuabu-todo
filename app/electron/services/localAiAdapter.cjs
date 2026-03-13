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
    .replace(/^\s*[-*•\d.\]()\[]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

class LocalAiAdapter {
  analyzeCapture({ rawText, sourceType, language }) {
    const copy = getDesktopCopy(language);
    const normalizedText = (rawText || "").replace(/\s+/g, " ").trim();
    const lines = (rawText || "")
      .split(/\r?\n/)
      .map(cleanupLine)
      .filter(Boolean);

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
      lines,
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

  extractTaskSuggestions(lines, timeHint, fallbackTitle, copy) {
    const actionable = lines.filter((line) => {
      const lowerLine = line.toLowerCase();

      return ACTION_KEYWORDS.some((keyword) => lowerLine.includes(keyword.toLowerCase()));
    });

    const seeds = actionable.length > 0 ? actionable : lines.slice(0, 2);

    if (seeds.length === 0) {
      return [
        {
          title: fallbackTitle,
          summary: copy.capturedForLaterReview,
          confidence: 0.42,
          timeHint,
        },
      ];
    }

    return seeds.slice(0, 3).map((line, index) => ({
      title: shorten(line, 52),
      summary: line,
      confidence: actionable.length > 0 ? 0.78 - index * 0.06 : 0.58 - index * 0.05,
      timeHint: this.extractTimeHint(line) || timeHint,
    }));
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
