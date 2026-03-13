import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import type { AppLanguage, CaptureStatus, SourceCard } from "../types";

export const SOURCE_CARD_WIDTH = 260;
export const SOURCE_CARD_HEIGHT = 164;
const IMAGE_CARD_PADDING = 14;
const IMAGE_CARD_CAPTION_HEIGHT = 28;

export type ImageAttachmentMetaById = Record<
  string,
  {
    width: number;
    height: number;
  }
>;

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

const shrinkCaption = (value: string) => {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 17)}...`;
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

export const buildScene = (
  sourceCards: SourceCard[],
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

      sceneElements.push(
        {
          id: card.id,
          type: "rectangle" as const,
          ...sharedCardProps,
          label: {
            text: card.title,
            fontSize: 18,
          },
        },
      );
    });

  return convertToExcalidrawElements(sceneElements, {
    regenerateIds: false,
  });
};
