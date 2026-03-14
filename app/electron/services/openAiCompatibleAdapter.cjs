const { getDesktopCopy } = require("../i18n.cjs");

const shorten = (value, maxLength) => {
  if (!value) {
    return "";
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
};

const extractJsonString = (value) => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBraceIndex = trimmed.indexOf("{");
  const lastBraceIndex = trimmed.lastIndexOf("}");

  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    return trimmed.slice(firstBraceIndex, lastBraceIndex + 1);
  }

  return trimmed;
};

const readMessageContent = (content) => {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item.text === "string") {
          return item.text;
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
};

const ANALYSIS_SYSTEM_PROMPT = [
  "你是桌面画布收录箱的任务分析引擎。",
  "你负责把原始收录内容整理成适合产品使用的结构化结果。",
  "只返回合法 JSON。",
  "不要使用 markdown 代码块。",
  "不要输出解释、前后缀或额外文字。",
  "不要输出下列结构之外的字段：",
  '{"sourceTitle":"string","sourceSummary":"string","timeHint":"string|null","tags":["string"],"taskSuggestions":[{"title":"string","summary":"string","confidence":0.0,"timeHint":"string|null","checklist":["string"]}]}',
  "规则：",
  "sourceTitle 是来源卡片标题，应简洁概括原始内容。",
  "sourceSummary 是对原始内容的简洁分析，不要原样抄写整段原文。",
  "尽量使用与原文相同的语言输出。",
  "保留原文里的关键名称、产品名、日期、指标名和实体信息。",
  "tags 使用简短小写标签，最多 4 个。",
  "taskSuggestions 返回 1 到 3 个可执行任务。",
  "默认应该只返回 1 个主任务。",
  "如果整段内容本质上是在交付同一个目标，默认只返回 1 个主任务。",
  "如果原文包含编号列表、项目列表、分条说明，并且这些条目服务于同一个总目标，不要拆成多个平级任务，而是返回 1 个主任务，并把分条内容放进 checklist。",
  "只有当原文清楚描述多个彼此独立、可以分别完成的事项时，才拆成多个任务。",
  "不要因为并列补充、多个指标、多个时间范围、多个数据口径、多个说明句而拆成多个任务。",
  "不要把一个请求拆成微步骤。",
  "不要把同一份交付里的数据维度、分析口径、指标项错误拆成多个平级任务。",
  "对于聊天式消息，要提炼用户真正需要跟进的动作，而不是机械复述说话语气。",
  "任务 title 必须是简洁明确的动作短语。",
  "任务 summary 用一句话解释背景和目标。",
  "checklist 最多 6 项，每项是这条主任务下的关键子项或信息项；如果没有清单项，返回空数组。",
  "confidence 必须是 0 到 1 之间的数字。",
  "如果内容有歧义，也至少返回 1 个低置信度的复核型任务。",
  "示例：如果原文是“明天看下网易云数据需求，下面有 3 条指标项”，应返回 1 个任务，把 3 条指标项写入 checklist。",
].join(" ");

const buildAnalysisUserPrompt = ({ rawText, sourceType, language }) =>
  [
    `语言：${language}`,
    `来源类型：${sourceType}`,
    "原始收录内容位于 <capture> 标签之间。",
    "<capture>",
    rawText,
    "</capture>",
    "请严格按要求返回 JSON。",
    "sourceTitle 尽量控制在 42 个字符以内。",
    "sourceSummary 尽量控制在 160 个字符以内。",
    "task title 要简洁、直接、可执行。",
    "大多数聊天式短消息应该只生成 1 个主任务。",
    "只有在原文明确是多个独立事项时，才返回多个任务。",
    "如果存在编号列表且它们属于同一个交付目标，请使用 1 个主任务加 checklist 的形式表达。",
  ].join("\n");

const buildAnalysisRequestBody = ({
  model,
  rawText,
  sourceType,
  language,
  useStructuredResponseFormat,
}) => {
  const body = {
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: ANALYSIS_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildAnalysisUserPrompt({
          rawText,
          sourceType,
          language,
        }),
      },
    ],
  };

  if (useStructuredResponseFormat) {
    body.response_format = {
      type: "json_object",
    };
  }

  return body;
};

class OpenAiCompatibleAdapter {
  constructor({ fallbackAdapter }) {
    this.fallbackAdapter = fallbackAdapter;
  }

  async requestAnalysis({
    baseUrl,
    apiKey,
    model,
    rawText,
    sourceType,
    language,
    copy,
  }) {
    const requestBodies = [
      buildAnalysisRequestBody({
        model,
        rawText,
        sourceType,
        language,
        useStructuredResponseFormat: true,
      }),
      buildAnalysisRequestBody({
        model,
        rawText,
        sourceType,
        language,
        useStructuredResponseFormat: false,
      }),
    ];
    let lastError = null;

    for (const body of requestBodies) {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        lastError = new Error(copy.remoteAiRequestFailed(response.status));
        continue;
      }

      const payload = await response.json();
      const content = readMessageContent(payload?.choices?.[0]?.message?.content);
      const jsonString = extractJsonString(content);

      if (!jsonString) {
        lastError = new Error(copy.remoteAiInvalidResponse);
        continue;
      }

      try {
        return JSON.parse(jsonString);
      } catch (error) {
        lastError = new Error(copy.remoteAiInvalidResponse);
      }
    }

    throw lastError || new Error(copy.remoteAiInvalidResponse);
  }

  async analyzeCapture({ rawText, sourceType, language, config }) {
    const fallbackAnalysis = this.fallbackAdapter.analyzeCapture({
      rawText,
      sourceType,
      language,
    });
    const copy = getDesktopCopy(language);

    if (!rawText?.trim()) {
      return fallbackAnalysis;
    }

    const baseUrl = config?.baseUrl?.trim() || "";
    const apiKey = config?.apiKey?.trim() || "";
    const model = config?.model?.trim() || "";

    if (!baseUrl || !apiKey || !model) {
      throw new Error(copy.aiConfigIncomplete);
    }

    const parsed = await this.requestAnalysis({
      baseUrl,
      apiKey,
      model,
      rawText,
      sourceType,
      language,
      copy,
    });

    const taskSuggestions = Array.isArray(parsed?.taskSuggestions)
      ? parsed.taskSuggestions
          .filter((item) => item && typeof item === "object")
          .slice(0, 3)
          .map((item, index) => ({
            title: shorten(
              typeof item.title === "string" && item.title.trim()
                ? item.title.trim()
                : fallbackAnalysis.taskSuggestions[index]?.title ||
                    fallbackAnalysis.sourceTitle,
              52,
            ),
            summary:
              typeof item.summary === "string" && item.summary.trim()
                ? item.summary.trim()
                : fallbackAnalysis.taskSuggestions[index]?.summary ||
                  fallbackAnalysis.sourceSummary,
            confidence:
              typeof item.confidence === "number" &&
              Number.isFinite(item.confidence) &&
              item.confidence >= 0 &&
              item.confidence <= 1
                ? item.confidence
                : fallbackAnalysis.taskSuggestions[index]?.confidence || 0.58,
            timeHint:
              typeof item.timeHint === "string" && item.timeHint.trim()
                ? item.timeHint.trim()
                : fallbackAnalysis.taskSuggestions[index]?.timeHint ||
                  fallbackAnalysis.timeHint,
            checklist: Array.isArray(item.checklist)
              ? item.checklist
                  .filter((entry) => typeof entry === "string" && entry.trim())
                  .map((entry) => entry.trim())
                  .slice(0, 6)
              : fallbackAnalysis.taskSuggestions[index]?.checklist || [],
          }))
      : fallbackAnalysis.taskSuggestions;

    return {
      sourceTitle: shorten(
        typeof parsed?.sourceTitle === "string" && parsed.sourceTitle.trim()
          ? parsed.sourceTitle.trim()
          : fallbackAnalysis.sourceTitle,
        42,
      ),
      sourceSummary: shorten(
        typeof parsed?.sourceSummary === "string" && parsed.sourceSummary.trim()
          ? parsed.sourceSummary.trim()
          : fallbackAnalysis.sourceSummary,
        160,
      ),
      timeHint:
        typeof parsed?.timeHint === "string" && parsed.timeHint.trim()
          ? parsed.timeHint.trim()
          : fallbackAnalysis.timeHint,
      tags: Array.isArray(parsed?.tags)
        ? parsed.tags
            .filter((item) => typeof item === "string" && item.trim())
            .map((item) => item.trim())
            .slice(0, 4)
        : fallbackAnalysis.tags,
      taskSuggestions: taskSuggestions.length > 0 ? taskSuggestions : fallbackAnalysis.taskSuggestions,
    };
  }
}

module.exports = {
  OpenAiCompatibleAdapter,
};
