import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { getCanvasLabels } from "../i18n.js";
export const SOURCE_CARD_WIDTH = 260;
export const SOURCE_CARD_HEIGHT = 164;
const palettes = {
    text: {
        backgroundColor: "#fff8eb",
        strokeColor: "#8a5f16",
    },
    image: {
        backgroundColor: "#eef7f3",
        strokeColor: "#196754",
    },
    mixed: {
        backgroundColor: "#eef4ff",
        strokeColor: "#2f5db3",
    },
};
export const buildScene = (sourceCards, activeSourceIds, captureStatusById, language) => {
    const activeSet = new Set(activeSourceIds);
    const labels = getCanvasLabels(language);
    return convertToExcalidrawElements(sourceCards.map((card) => {
        const palette = palettes[card.sourceType];
        const isActive = activeSet.has(card.id);
        const captureStatus = captureStatusById[card.captureId];
        const isProcessing = captureStatus === "queued" || captureStatus === "processing";
        const isFailed = captureStatus === "failed";
        const label = [
            isProcessing ? labels.analyzing : isFailed ? labels.needsReview : null,
            labels[card.sourceType],
            card.title,
            "",
            card.summary,
            card.tags.length > 0 ? "" : null,
            card.tags.length > 0 ? `#${card.tags.join("  #")}` : null,
        ]
            .filter(Boolean)
            .join("\n");
        return {
            id: card.id,
            type: "rectangle",
            x: card.position.x,
            y: card.position.y,
            width: SOURCE_CARD_WIDTH,
            height: SOURCE_CARD_HEIGHT,
            backgroundColor: isActive
                ? "#ffe3bd"
                : isFailed
                    ? "#fde8e8"
                    : isProcessing
                        ? "#fff6d6"
                        : palette.backgroundColor,
            strokeColor: isActive
                ? "#d97706"
                : isFailed
                    ? "#c92a2a"
                    : isProcessing
                        ? "#b7791f"
                        : palette.strokeColor,
            strokeWidth: isActive ? 3 : 2,
            roughness: 0,
            fillStyle: "solid",
            strokeStyle: isProcessing ? "dashed" : "solid",
            roundness: {
                type: 3,
            },
            label: {
                text: label,
                fontSize: 18,
            },
            customData: {
                kind: "source-card",
                sourceCardId: card.id,
            },
        };
    }), {
        regenerateIds: false,
    });
};

