import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import type {
  AppLanguage,
  CaptureStatus,
  SourceCard,
  TaskItem,
  TaskStatus,
} from "../types";

export const SOURCE_CARD_WIDTH = 260;
export const SOURCE_CARD_HEIGHT = 164;
export const TASK_CARD_WIDTH = 214;
export const TASK_CARD_HEIGHT = 78;

const IMAGE_CARD_PADDING = 14;
const IMAGE_CARD_CAPTION_HEIGHT = 28;
const TASK_CARD_GAP = 14;
const TASK_CARD_LANE_GAP = 34;

export type ImageAttachmentMetaById = Record<
  string,
  {
    width: number;
    height: number;
  }
>;

export type TaskCardLayout = {
  taskId: string;
  sourceCardId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  timeHint: string | null;
  checklistCount: number;
  status: TaskStatus;
  isActive: boolean;
};

const palettes: Record<
  SourceCard["sourceType"],
  { backgroundColor: string; strokeColor: string }
> = {
  text: {
    backgroundColor: "#f7fbff",
    strokeColor: "#3d63b8",
  },
  image: {
    backgroundColor: "#f2fbf6",
    strokeColor: "#17724d",
  },
  mixed: {
    backgroundColor: "#fff6ec",
    strokeColor: "#d16b14",
  },
};

const taskPalettes: Record<
  TaskStatus,
  { backgroundColor: string; strokeColor: string }
> = {
  inbox: {
    backgroundColor: "#fff7ea",
    strokeColor: "#d27c18",
  },
  doing: {
    backgroundColor: "#eef6ff",
    strokeColor: "#3f72c8",
  },
  done: {
    backgroundColor: "#eef7f1",
    strokeColor: "#2f8b5d",
  },
};

const shrinkCaption = (value: string) => {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 17)}...`;
};

const shrinkTaskTitle = (value: string) => {
  if (value.length <= 42) {
    return value;
  }

  return `${value.slice(0, 41)}...`;
};

const shrinkTaskMeta = (value: string) => {
  if (value.length <= 28) {
    return value;
  }

  return `${value.slice(0, 27)}...`;
};

const formatChecklistCount = (count: number, language: AppLanguage) => {
  if (count <= 0) {
    return "";
  }

  return language === "zh-CN" ? `${count} 项清单` : `${count} items`;
};

const fitImageIntoBox = (
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
) => {
  if (width <= 0 || height <= 0) {
    return {
      width: maxWidth,
      height: maxHeight,
    };
  }

  const scale = Math.min(maxWidth / width, maxHeight / height);

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const getOverlapArea = (
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
) => {
  const overlapWidth =
    Math.min(first.x + first.width, second.x + second.width) -
    Math.max(first.x, second.x);
  const overlapHeight =
    Math.min(first.y + first.height, second.y + second.height) -
    Math.max(first.y, second.y);

  if (overlapWidth <= 0 || overlapHeight <= 0) {
    return 0;
  }

  return overlapWidth * overlapHeight;
};

export const getTaskCardLayouts = (
  sourceCards: SourceCard[],
  taskItems: TaskItem[],
  focusedSourceCardId: string | null,
  activeTaskId: string | null,
  positionByTaskId: Record<string, { x: number; y: number }> = {},
): TaskCardLayout[] => {
  if (!focusedSourceCardId) {
    return [];
  }

  const focusedSourceCard =
    sourceCards.find((sourceCard) => sourceCard.id === focusedSourceCardId) || null;

  if (!focusedSourceCard || focusedSourceCard.linkedTaskIds.length === 0) {
    return [];
  }

  const relatedTasks = focusedSourceCard.linkedTaskIds
    .map((taskId) => taskItems.find((taskItem) => taskItem.id === taskId))
    .filter((taskItem): taskItem is TaskItem => Boolean(taskItem));

  if (relatedTasks.length === 0) {
    return [];
  }

  // A single projected task is already represented in the right pane and inspector.
  // Only render canvas task cards when there is an actual split to show.
  if (relatedTasks.length === 1) {
    return [];
  }

  const floatingTasks = relatedTasks.filter((taskItem) => !positionByTaskId[taskItem.id]);
  const positionedTasks = relatedTasks.filter((taskItem) => Boolean(positionByTaskId[taskItem.id]));

  if (floatingTasks.length === 0) {
    return positionedTasks.map((taskItem) => {
      const position = positionByTaskId[taskItem.id];

      return {
        taskId: taskItem.id,
        sourceCardId: focusedSourceCard.id,
        x: position.x,
        y: position.y,
        width: TASK_CARD_WIDTH,
        height: TASK_CARD_HEIGHT,
        title: shrinkTaskTitle(taskItem.title),
        timeHint: taskItem.timeHint,
        checklistCount: taskItem.checklist.length,
        status: taskItem.status,
        isActive: taskItem.id === activeTaskId,
      };
    });
  }

  const totalHeight =
    floatingTasks.length * TASK_CARD_HEIGHT +
    Math.max(0, floatingTasks.length - 1) * TASK_CARD_GAP;
  const centeredY = Math.round(
    focusedSourceCard.position.y + (SOURCE_CARD_HEIGHT - totalHeight) / 2,
  );
  const centeredX = Math.round(
    focusedSourceCard.position.x + (SOURCE_CARD_WIDTH - TASK_CARD_WIDTH) / 2,
  );
  const candidates = [
    {
      x: focusedSourceCard.position.x + SOURCE_CARD_WIDTH + TASK_CARD_LANE_GAP,
      y: centeredY,
    },
    {
      x: focusedSourceCard.position.x - TASK_CARD_WIDTH - TASK_CARD_LANE_GAP,
      y: centeredY,
    },
    {
      x: centeredX,
      y: focusedSourceCard.position.y + SOURCE_CARD_HEIGHT + TASK_CARD_LANE_GAP,
    },
    {
      x: centeredX,
      y: focusedSourceCard.position.y - totalHeight - TASK_CARD_LANE_GAP,
    },
  ];
  const otherSourceRects = sourceCards
    .filter((sourceCard) => sourceCard.id !== focusedSourceCard.id)
    .map((sourceCard) => ({
      x: sourceCard.position.x,
      y: sourceCard.position.y,
      width: SOURCE_CARD_WIDTH,
      height: SOURCE_CARD_HEIGHT,
    }));
  const laneOrigin = candidates
    .map((candidate, index) => {
      const laneRect = {
        x: candidate.x,
        y: candidate.y,
        width: TASK_CARD_WIDTH,
        height: totalHeight,
      };
      const overlapScore = otherSourceRects.reduce(
        (total, rect) => total + getOverlapArea(laneRect, rect),
        0,
      );
      const edgePenalty =
        (candidate.x < 40 ? 120000 : 0) + (candidate.y < 40 ? 80000 : 0);

      return {
        candidate,
        score: overlapScore + edgePenalty + index,
      };
    })
    .sort((left, right) => left.score - right.score)[0]?.candidate;

  if (!laneOrigin) {
    return [];
  }

  let floatingIndex = 0;

  return relatedTasks.map((taskItem) => {
    const manualPosition = positionByTaskId[taskItem.id];

    if (manualPosition) {
      return {
        taskId: taskItem.id,
        sourceCardId: focusedSourceCard.id,
        x: manualPosition.x,
        y: manualPosition.y,
        width: TASK_CARD_WIDTH,
        height: TASK_CARD_HEIGHT,
        title: shrinkTaskTitle(taskItem.title),
        timeHint: taskItem.timeHint,
        checklistCount: taskItem.checklist.length,
        status: taskItem.status,
        isActive: taskItem.id === activeTaskId,
      };
    }

    const layout = {
      taskId: taskItem.id,
      sourceCardId: focusedSourceCard.id,
      x: laneOrigin.x,
      y: laneOrigin.y + floatingIndex * (TASK_CARD_HEIGHT + TASK_CARD_GAP),
      width: TASK_CARD_WIDTH,
      height: TASK_CARD_HEIGHT,
      title: shrinkTaskTitle(taskItem.title),
      timeHint: taskItem.timeHint,
      checklistCount: taskItem.checklist.length,
      status: taskItem.status,
      isActive: taskItem.id === activeTaskId,
    };

    floatingIndex += 1;
    return layout;
  });
};

export const buildScene = (
  sourceCards: SourceCard[],
  taskCardLayouts: TaskCardLayout[],
  activeSourceIds: string[],
  captureStatusById: Record<string, CaptureStatus>,
  imageAttachmentMetaById: ImageAttachmentMetaById,
  _language: AppLanguage,
) => {
  const activeSet = new Set(activeSourceIds);
  const sceneElements =
    [] as NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>;

  sourceCards.forEach((card) => {
    const palette = palettes[card.sourceType];
    const isActive = activeSet.has(card.id);
    const captureStatus = captureStatusById[card.captureId];
    const isProcessing =
      captureStatus === "queued" || captureStatus === "processing";
    const isFailed = captureStatus === "failed";
    const backgroundColor = isActive
      ? "#fff0dd"
      : isFailed
        ? "#fee8e8"
        : isProcessing
          ? "#eef4ff"
          : palette.backgroundColor;
    const strokeColor = isActive
      ? "#ff7a1a"
      : isFailed
        ? "#c23a3a"
        : isProcessing
          ? "#5d76ca"
          : palette.strokeColor;
    const sharedCardProps = {
      x: card.position.x,
      y: card.position.y,
      width: SOURCE_CARD_WIDTH,
      height: SOURCE_CARD_HEIGHT,
      backgroundColor,
      strokeColor,
      strokeWidth: isActive ? 3 : 2,
      roughness: 0,
      fillStyle: "solid" as const,
      strokeStyle: isProcessing ? ("dashed" as const) : ("solid" as const),
      roundness: {
        type: 3 as const,
      },
      customData: {
        kind: "source-card",
        sourceCardId: card.id,
      },
    };
    const imageAttachmentId = card.attachmentIds[0];
    const imageMeta = imageAttachmentId
      ? imageAttachmentMetaById[imageAttachmentId]
      : null;

    if (imageAttachmentId && imageMeta) {
      const groupId = `${card.id}__group`;
      const maxImageWidth = SOURCE_CARD_WIDTH - IMAGE_CARD_PADDING * 2;
      const maxImageHeight =
        SOURCE_CARD_HEIGHT - IMAGE_CARD_PADDING * 2 - IMAGE_CARD_CAPTION_HEIGHT;
      const fittedImage = fitImageIntoBox(
        imageMeta.width,
        imageMeta.height,
        maxImageWidth,
        maxImageHeight,
      );
      const imageX =
        card.position.x + (SOURCE_CARD_WIDTH - fittedImage.width) / 2;
      const imageY =
        card.position.y +
        IMAGE_CARD_PADDING +
        (maxImageHeight - fittedImage.height) / 2;

      sceneElements.push(
        {
          id: card.id,
          type: "rectangle" as const,
          ...sharedCardProps,
          groupIds: [groupId],
        },
        {
          id: `${card.id}__image`,
          type: "image" as const,
          x: imageX,
          y: imageY,
          width: fittedImage.width,
          height: fittedImage.height,
          fileId: imageAttachmentId as BinaryFileData["id"],
          status: "saved" as const,
          scale: [1, 1] as [number, number],
          crop: null,
          strokeColor,
          backgroundColor: "#ffffff",
          strokeWidth: 1,
          roughness: 0,
          fillStyle: "solid" as const,
          strokeStyle: "solid" as const,
          roundness: null,
          groupIds: [groupId],
          customData: {
            kind: "source-card-image",
            sourceCardId: card.id,
          },
        },
        {
          id: `${card.id}__title`,
          type: "text" as const,
          x: card.position.x + IMAGE_CARD_PADDING,
          y: card.position.y + SOURCE_CARD_HEIGHT - IMAGE_CARD_CAPTION_HEIGHT - 6,
          text: shrinkCaption(card.title),
          fontSize: 15,
          groupIds: [groupId],
          customData: {
            kind: "source-card-title",
            sourceCardId: card.id,
          },
        },
      );
      return;
    }

    sceneElements.push({
      id: card.id,
      type: "rectangle" as const,
      ...sharedCardProps,
      label: {
        text: card.title,
        fontSize: 18,
      },
    });
  });

  taskCardLayouts.forEach((taskCardLayout) => {
    const palette = taskPalettes[taskCardLayout.status];
    const backgroundColor = taskCardLayout.isActive
      ? "#fff0dd"
      : palette.backgroundColor;
    const strokeColor = taskCardLayout.isActive ? "#ff7a1a" : palette.strokeColor;
    const taskMeta = [
      taskCardLayout.timeHint,
      formatChecklistCount(taskCardLayout.checklistCount, _language),
    ]
      .filter(Boolean)
      .join(" · ");

    sceneElements.push({
      id: taskCardLayout.taskId,
      type: "rectangle" as const,
      x: taskCardLayout.x,
      y: taskCardLayout.y,
      width: taskCardLayout.width,
      height: taskCardLayout.height,
      backgroundColor,
      strokeColor,
      strokeWidth: taskCardLayout.isActive ? 3 : 2,
      roughness: 0,
      fillStyle: "solid" as const,
      strokeStyle:
        taskCardLayout.status === "done" ? ("dashed" as const) : ("solid" as const),
      roundness: {
        type: 3 as const,
      },
      label: {
        text: taskMeta
          ? `${taskCardLayout.title}\n${shrinkTaskMeta(taskMeta)}`
          : taskCardLayout.title,
        fontSize: 16,
      },
      customData: {
        kind: "task-card",
        taskId: taskCardLayout.taskId,
        sourceCardId: taskCardLayout.sourceCardId,
      },
    });
  });

  return convertToExcalidrawElements(sceneElements, {
    regenerateIds: false,
  });
};
