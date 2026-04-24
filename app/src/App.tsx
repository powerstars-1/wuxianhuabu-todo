import {
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  sceneCoordsToViewportCoords,
} from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFileData,
  ExcalidrawImperativeAPI,
  Zoom,
} from "@excalidraw/excalidraw/types";
import { DEFAULT_LANGUAGE, getMessages } from "./i18n";
import {
  buildScene,
  getTaskCardLayouts,
  SOURCE_CARD_HEIGHT,
  SOURCE_CARD_WIDTH,
  TASK_CARD_HEIGHT,
  TASK_CARD_WIDTH,
} from "./lib/buildScene";
import { formatAcceleratorForDisplay } from "./lib/shortcutDisplay";
import type {
  AppRuntimeState,
  AiProvider,
  AppLanguage,
  Capture,
  CaptureStatus,
  DesktopPlatform,
  ScrollState,
  SourceCard,
  TaskItem,
  TaskStatus,
  WorkspaceSnapshot,
} from "./types";

const inferDesktopPlatformFromNavigator = (): DesktopPlatform => {
  if (typeof navigator === "undefined") {
    return "linux";
  }

  const platformInfo = `${navigator.platform} ${navigator.userAgent}`;

  if (/mac/i.test(platformInfo)) {
    return "mac";
  }

  if (/win/i.test(platformInfo)) {
    return "windows";
  }

  return "linux";
};

const INITIAL_DESKTOP_PLATFORM = inferDesktopPlatformFromNavigator();

type SceneElementLike = {
  id: string;
  type?: string;
  isDeleted: boolean;
  x: number;
  y: number;
  text?: string | null;
  containerId?: string | null;
  customData?: Record<string, unknown> | null;
};

type PositionUpdate = {
  sourceCardId: string;
  position: {
    x: number;
    y: number;
  };
};

type LoadedImageAttachment = {
  file: BinaryFileData;
  width: number;
  height: number;
};

type RectLike = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type ConnectorPath = {
  id: string;
  d: string;
  kind: "task-row" | "task-branch";
  isActive: boolean;
};

const EMPTY_SCROLL_STATE: ScrollState = {
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
};

const LANGUAGE_OPTIONS: AppLanguage[] = ["zh-CN", "en-US"];
const TASK_STATUS_ORDER: TaskStatus[] = ["inbox", "doing", "done"];

const formatDateTime = (value: string, language: AppLanguage) =>
  new Intl.DateTimeFormat(language, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const formatTimeHint = (value: string | null | undefined, fallback: string) =>
  value?.trim() || fallback;

const getSourceCardsForTask = (
  workspace: WorkspaceSnapshot,
  task: TaskItem | null,
) => {
  if (!task) {
    return [];
  }

  return workspace.sourceCards.filter((card) => task.sourceCardIds.includes(card.id));
};

const getPrimaryCapture = (
  workspace: WorkspaceSnapshot,
  sourceCards: SourceCard[],
): Capture | null => {
  if (sourceCards.length === 0) {
    return null;
  }

  return (
    workspace.captures.find((capture) => capture.id === sourceCards[0].captureId) ||
    null
  );
};

const getCanvasSourceCards = (workspace: WorkspaceSnapshot) =>
  workspace.sourceCards.map((sourceCard) => {
    if (sourceCard.linkedTaskIds.length !== 1) {
      return sourceCard;
    }

    const linkedTask =
      workspace.taskItems.find((taskItem) => taskItem.id === sourceCard.linkedTaskIds[0]) ||
      null;

    if (!linkedTask || linkedTask.title === sourceCard.title) {
      return sourceCard;
    }

    return {
      ...sourceCard,
      title: linkedTask.title,
    };
  });

const getSelectedSourceCardIdFromSelection = (
  workspace: WorkspaceSnapshot,
  elements: readonly SceneElementLike[],
  selectedElementIds: Readonly<Record<string, true>>,
) => {
  return Object.keys(selectedElementIds)
    .map((selectedElementId) => {
      if (workspace.sourceCards.some((card) => card.id === selectedElementId)) {
        return selectedElementId;
      }

      const selectedElement = elements.find(
        (candidate) =>
          candidate.id === selectedElementId && !candidate.isDeleted,
      );
      const sourceCardIdFromCustomData =
        typeof selectedElement?.customData?.sourceCardId === "string"
          ? selectedElement.customData.sourceCardId
          : null;
      const candidateSourceCardId =
        sourceCardIdFromCustomData ||
        selectedElement?.containerId ||
        null;

      if (
        candidateSourceCardId &&
        workspace.sourceCards.some((card) => card.id === candidateSourceCardId)
      ) {
        return candidateSourceCardId;
      }

      return null;
    })
    .find((value): value is string => Boolean(value));
};

const getSelectedTaskIdFromSelection = (
  workspace: WorkspaceSnapshot,
  elements: readonly SceneElementLike[],
  selectedElementIds: Readonly<Record<string, true>>,
) => {
  return Object.keys(selectedElementIds)
    .map((selectedElementId) => {
      if (workspace.taskItems.some((taskItem) => taskItem.id === selectedElementId)) {
        return selectedElementId;
      }

      const selectedElement = elements.find(
        (candidate) =>
          candidate.id === selectedElementId && !candidate.isDeleted,
      );
      const taskIdFromCustomData =
        typeof selectedElement?.customData?.taskId === "string"
          ? selectedElement.customData.taskId
          : null;
      const candidateTaskId = taskIdFromCustomData || selectedElement?.containerId || null;

      if (
        candidateTaskId &&
        workspace.taskItems.some((taskItem) => taskItem.id === candidateTaskId)
      ) {
        return candidateTaskId;
      }

      return null;
    })
    .find((value): value is string => Boolean(value));
};

const getStatusTone = (status: string) => {
  if (status === "processing") {
    return "processing";
  }

  if (status === "error") {
    return "error";
  }

  return "ready";
};

const isStandaloneTextElement = (
  workspace: WorkspaceSnapshot,
  element: SceneElementLike,
) => {
  if (element.type !== "text" || element.isDeleted) {
    return false;
  }

  if (typeof element.text !== "string" || !element.text.trim()) {
    return false;
  }

  if (element.containerId) {
    return false;
  }

  if (typeof element.customData?.sourceCardId === "string") {
    return false;
  }

  if (typeof element.customData?.taskId === "string") {
    return false;
  }

  return !workspace.sourceCards.some((card) => card.id === element.id);
};

const readImageDimensions = (dataUrl: string) =>
  new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image();

    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width || SOURCE_CARD_WIDTH,
        height: image.naturalHeight || image.height || SOURCE_CARD_HEIGHT,
      });
    };

    image.onerror = () => {
      resolve({
        width: SOURCE_CARD_WIDTH,
        height: SOURCE_CARD_HEIGHT,
      });
    };

    image.src = dataUrl;
  });

const toRelativeRect = (rect: RectLike, containerRect: RectLike): RectLike => ({
  left: rect.left - containerRect.left,
  top: rect.top - containerRect.top,
  right: rect.right - containerRect.left,
  bottom: rect.bottom - containerRect.top,
  width: rect.width,
  height: rect.height,
});

const getRectCenter = (rect: RectLike) => ({
  x: rect.left + rect.width / 2,
  y: rect.top + rect.height / 2,
});

const getRectBoundaryPoint = (
  rect: RectLike,
  target: {
    x: number;
    y: number;
  },
) => {
  const center = getRectCenter(rect);
  const deltaX = target.x - center.x;
  const deltaY = target.y - center.y;
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;

  if (deltaX === 0 && deltaY === 0) {
    return center;
  }

  const scale =
    1 /
    Math.max(
      Math.abs(deltaX) / Math.max(halfWidth, 1),
      Math.abs(deltaY) / Math.max(halfHeight, 1),
    );

  return {
    x: center.x + deltaX * scale,
    y: center.y + deltaY * scale,
  };
};

const buildConnectorPath = (
  startPoint: { x: number; y: number },
  endPoint: { x: number; y: number },
) => {
  const deltaX = endPoint.x - startPoint.x;
  const controlOffset = Math.max(54, Math.min(180, Math.abs(deltaX) * 0.42));
  const startControlX = startPoint.x + (deltaX >= 0 ? controlOffset : -controlOffset);
  const endControlX = endPoint.x - (deltaX >= 0 ? controlOffset : -controlOffset);

  return `M ${startPoint.x} ${startPoint.y} C ${startControlX} ${startPoint.y}, ${endControlX} ${endPoint.y}, ${endPoint.x} ${endPoint.y}`;
};

const getSceneRectInWorkspace = ({
  x,
  y,
  width,
  height,
  canvasRect,
  workspaceRect,
  scrollState,
  viewportState,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  canvasRect: DOMRect;
  workspaceRect: DOMRect;
  scrollState: ScrollState;
  viewportState:
    | (AppState & {
        zoom: Zoom;
      })
    | null;
}) => {
  const topLeft = sceneCoordsToViewportCoords(
    {
      sceneX: x,
      sceneY: y,
    },
    {
      zoom: viewportState?.zoom || ({ value: scrollState.zoom as Zoom["value"] } satisfies Zoom),
      offsetLeft: canvasRect.left,
      offsetTop: canvasRect.top,
      scrollX: viewportState?.scrollX ?? scrollState.scrollX,
      scrollY: viewportState?.scrollY ?? scrollState.scrollY,
    },
  );
  const bottomRight = sceneCoordsToViewportCoords(
    {
      sceneX: x + width,
      sceneY: y + height,
    },
    {
      zoom: viewportState?.zoom || ({ value: scrollState.zoom as Zoom["value"] } satisfies Zoom),
      offsetLeft: canvasRect.left,
      offsetTop: canvasRect.top,
      scrollX: viewportState?.scrollX ?? scrollState.scrollX,
      scrollY: viewportState?.scrollY ?? scrollState.scrollY,
    },
  );

  return {
    left: topLeft.x - workspaceRect.left,
    top: topLeft.y - workspaceRect.top,
    right: bottomRight.x - workspaceRect.left,
    bottom: bottomRight.y - workspaceRect.top,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
};

const isRectVisibleInCanvas = (rect: RectLike, canvasRect: RectLike) =>
  !(
    rect.right < canvasRect.left ||
    rect.left > canvasRect.right ||
    rect.bottom < canvasRect.top ||
    rect.top > canvasRect.bottom
  );

const TrashIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.45"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3.5 4.5h9" />
    <path d="M6.5 2.75h3" />
    <path d="M5 4.5v7.25a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4.5" />
    <path d="M6.75 6.75v3.25" />
    <path d="M9.25 6.75v3.25" />
  </svg>
);

const CloseIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 4l8 8" />
    <path d="M12 4l-8 8" />
  </svg>
);

const MinimizeIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 8.75h8" />
  </svg>
);

const MaximizeIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.45"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3.75" y="3.75" width="8.5" height="8.5" rx="1.2" />
  </svg>
);

const RestoreIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.35"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5.25 5.25h5.5a1 1 0 0 1 1 1v5.5" />
    <path d="M10.75 7.25v3.5a1 1 0 0 1-1 1h-4.5a1 1 0 0 1-1-1v-4.5a1 1 0 0 1 1-1h3.5" />
  </svg>
);

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedSourceCardId, setSelectedSourceCardId] = useState<string | null>(null);
  const [scrollState, setScrollState] = useState<ScrollState>(EMPTY_SCROLL_STATE);
  const [canvasApi, setCanvasApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [viewportTick, setViewportTick] = useState(0);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [isManualComposerOpen, setIsManualComposerOpen] = useState(false);
  const [manualCaptureDraft, setManualCaptureDraft] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [draftAiProvider, setDraftAiProvider] = useState<AiProvider>("local");
  const [draftAiBaseUrl, setDraftAiBaseUrl] = useState("");
  const [draftAiApiKey, setDraftAiApiKey] = useState("");
  const [draftAiModel, setDraftAiModel] = useState("");
  const [aiSaveState, setAiSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [aiSaveError, setAiSaveError] = useState<string | null>(null);
  const [appRuntime, setAppRuntime] = useState<AppRuntimeState | null>(null);
  const [isRetryingShortcut, setIsRetryingShortcut] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [draftTaskTitle, setDraftTaskTitle] = useState("");
  const [draftTaskSummary, setDraftTaskSummary] = useState("");
  const [taskCardPositionsById, setTaskCardPositionsById] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [editingTaskField, setEditingTaskField] = useState<"title" | "summary" | null>(
    null,
  );
  const [draftSourceText, setDraftSourceText] = useState("");
  const [imageAttachmentsById, setImageAttachmentsById] = useState<
    Record<string, LoadedImageAttachment>
  >({});

  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const canvasPaneRef = useRef<HTMLDivElement | null>(null);
  const taskRowRefs = useRef(new Map<string, HTMLDivElement | null>());
  const pendingPositionUpdatesRef = useRef(new Map<string, PositionUpdate>());
  const processedManualTextIdsRef = useRef(new Set<string>());
  const creatingManualTextIdsRef = useRef(new Set<string>());
  const lastAutoFocusKeyRef = useRef<string | null>(null);
  const previousLastCaptureIdRef = useRef<string | null>(null);
  const registeredCanvasApiIdRef = useRef<string | null>(null);
  const registeredAttachmentIdsRef = useRef(new Set<string>());
  const pendingSourceCardDeletesRef = useRef(new Set<string>());

  const language = workspace?.ui.language ?? DEFAULT_LANGUAGE;
  const t = getMessages(language);

  useEffect(() => {
    let disposed = false;

    const hydrate = async () => {
      const [snapshot, windowState, runtimeState] = await Promise.all([
        window.desktopApi.getWorkspaceSnapshot(),
        window.desktopApi.getWindowState(),
        window.desktopApi.getAppRuntimeState(),
      ]);

      if (disposed) {
        return;
      }

      startTransition(() => {
        setWorkspace(snapshot);
        setIsWindowMaximized(windowState.isMaximized);
        setAppRuntime(runtimeState);
      });
    };

    void hydrate();

    const unsubscribeWorkspace = window.desktopApi.onWorkspaceUpdated((snapshot) => {
      startTransition(() => {
        setWorkspace(snapshot);
      });
    });
    const unsubscribeWindowState = window.desktopApi.onWindowStateChanged((state) => {
      startTransition(() => {
        setIsWindowMaximized(state.isMaximized);
      });
    });
    const unsubscribeAppRuntime = window.desktopApi.onAppRuntimeUpdated((state) => {
      startTransition(() => {
        setAppRuntime(state);
      });
    });

    return () => {
      disposed = true;
      unsubscribeWorkspace();
      unsubscribeWindowState();
      unsubscribeAppRuntime();
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    setAiSaveState("idle");
    setAiSaveError(null);
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    setDraftAiProvider(workspace.ai.provider);
    setDraftAiBaseUrl(workspace.ai.baseUrl);
    setDraftAiApiKey("");
    setDraftAiModel(workspace.ai.model);
  }, [workspace?.ai]);

  useEffect(() => {
    const handleResize = () => {
      setViewportTick((value) => value + 1);
      canvasApi?.refresh();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [canvasApi]);

  useEffect(() => {
    if (
      !isSettingsOpen &&
      !isInspectorOpen &&
      !lightboxImageUrl &&
      !isManualComposerOpen
    ) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (lightboxImageUrl) {
        setLightboxImageUrl(null);
        return;
      }

      if (isManualComposerOpen) {
        setIsManualComposerOpen(false);
        return;
      }

      if (isSettingsOpen) {
        setIsSettingsOpen(false);
        return;
      }

      if (isInspectorOpen) {
        setIsInspectorOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isInspectorOpen, isSettingsOpen, lightboxImageUrl, isManualComposerOpen]);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    const latestCaptureId = workspace.ui.lastCaptureId ?? null;

    if (!latestCaptureId || latestCaptureId === previousLastCaptureIdRef.current) {
      return;
    }

    previousLastCaptureIdRef.current = latestCaptureId;
    const relatedSourceCard =
      workspace.sourceCards.find((card) => card.captureId === latestCaptureId) || null;

    if (!relatedSourceCard) {
      return;
    }

    setSelectedSourceCardId(relatedSourceCard.id);

    if (relatedSourceCard.linkedTaskIds[0]) {
      setSelectedTaskId(relatedSourceCard.linkedTaskIds[0]);
    }
  }, [workspace]);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    if (
      selectedTaskId &&
      workspace.taskItems.some((taskItem) => taskItem.id === selectedTaskId)
    ) {
      return;
    }

    if (!selectedTaskId && selectedSourceCardId) {
      const linkedTaskId =
        workspace.sourceCards.find((sourceCard) => sourceCard.id === selectedSourceCardId)
          ?.linkedTaskIds[0] || null;

      setSelectedTaskId(linkedTaskId);
      return;
    }

    setSelectedTaskId(workspace.taskItems[0]?.id ?? null);
  }, [workspace, selectedSourceCardId, selectedTaskId]);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    const selectedSourceCardStillExists = Boolean(
      selectedSourceCardId &&
        workspace.sourceCards.some((sourceCard) => sourceCard.id === selectedSourceCardId),
    );

    if (selectedSourceCardStillExists) {
      return;
    }

    const sourceCardIdFromSelectedTask = selectedTaskId
      ? workspace.taskItems.find((taskItem) => taskItem.id === selectedTaskId)
          ?.sourceCardIds[0] || null
      : null;
    const latestSourceCardId = workspace.ui.lastCaptureId
      ? workspace.sourceCards.find(
          (sourceCard) => sourceCard.captureId === workspace.ui.lastCaptureId,
        )?.id || null
      : null;

    setSelectedSourceCardId(
      sourceCardIdFromSelectedTask ||
        latestSourceCardId ||
        workspace.sourceCards[0]?.id ||
        null,
    );
  }, [workspace, selectedSourceCardId, selectedTaskId]);

  const captureStatusById =
    workspace?.captures.reduce<Record<string, CaptureStatus>>((acc, capture) => {
      acc[capture.id] = capture.aiStatus;
      return acc;
    }, {}) || {};

  useEffect(() => {
    if (!workspace || !canvasApi) {
      return;
    }

    const canvasSourceCards = getCanvasSourceCards(workspace);
    const imageAttachmentMetaById = Object.fromEntries(
      Object.entries(imageAttachmentsById).map(([attachmentId, attachment]) => [
        attachmentId,
        {
          width: attachment.width,
          height: attachment.height,
        },
      ]),
    );
    const previewTaskId = hoveredTaskId || selectedTaskId;
    const previewTask =
      workspace.taskItems.find((taskItem) => taskItem.id === previewTaskId) || null;
    const activeSourceIds =
      previewTask?.sourceCardIds ||
      (selectedSourceCardId ? [selectedSourceCardId] : []);
    const focusedSourceCardId =
      selectedSourceCardId ||
      (selectedTaskId
        ? workspace.taskItems.find((taskItem) => taskItem.id === selectedTaskId)
            ?.sourceCardIds[0] || null
        : null) ||
      (workspace.ui.lastCaptureId
        ? workspace.sourceCards.find(
            (sourceCard) => sourceCard.captureId === workspace.ui.lastCaptureId,
          )?.id || null
        : null);
    const taskCardLayouts = getTaskCardLayouts(
      workspace.sourceCards,
      workspace.taskItems,
      focusedSourceCardId,
      previewTaskId,
      taskCardPositionsById,
    );

    canvasApi.updateScene({
      elements: buildScene(
        canvasSourceCards,
        taskCardLayouts,
        activeSourceIds,
        captureStatusById,
        imageAttachmentMetaById,
        language,
      ),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [
    canvasApi,
    captureStatusById,
    hoveredTaskId,
    imageAttachmentsById,
    language,
    selectedTaskId,
    selectedSourceCardId,
    taskCardPositionsById,
    workspace,
  ]);

  useEffect(() => {
    if (!workspace || !canvasApi) {
      return;
    }

    if (registeredCanvasApiIdRef.current !== canvasApi.id) {
      registeredCanvasApiIdRef.current = canvasApi.id;
      registeredAttachmentIdsRef.current.clear();
    }

    const attachmentById = new Map(
      workspace.attachments.map((attachment) => [attachment.id, attachment]),
    );
    const imageAttachmentIds = Array.from(
      new Set(
        workspace.sourceCards
          .flatMap((card) => card.attachmentIds)
          .filter((attachmentId) =>
            attachmentById.get(attachmentId)?.mimeType.startsWith("image/"),
          ),
      ),
    );

    const registerKnownFiles = () => {
      const pendingFiles = imageAttachmentIds
        .map((attachmentId) => imageAttachmentsById[attachmentId]?.file)
        .filter((file): file is BinaryFileData => Boolean(file))
        .filter((file) => !registeredAttachmentIdsRef.current.has(file.id));

      if (pendingFiles.length === 0) {
        return;
      }

      canvasApi.addFiles(pendingFiles);
      pendingFiles.forEach((file) => {
        registeredAttachmentIdsRef.current.add(file.id);
      });
    };

    registerKnownFiles();

    const missingAttachmentIds = imageAttachmentIds.filter(
      (attachmentId) => !imageAttachmentsById[attachmentId],
    );

    if (missingAttachmentIds.length === 0) {
      return;
    }

    let disposed = false;

    const loadImageAttachments = async () => {
      const loadedAttachments = await Promise.all(
        missingAttachmentIds.map(async (attachmentId) => {
          const attachment = attachmentById.get(attachmentId);

          if (!attachment) {
            return null;
          }

          const dataUrl = await window.desktopApi.getAttachmentDataUrl(attachmentId);

          if (!dataUrl) {
            return null;
          }

          const dimensions = await readImageDimensions(dataUrl);
          const createdTimestamp = Date.parse(attachment.createdAt);

          return {
            attachmentId,
            width: dimensions.width,
            height: dimensions.height,
            file: {
              id: attachmentId as BinaryFileData["id"],
              mimeType: attachment.mimeType as BinaryFileData["mimeType"],
              dataURL: dataUrl as BinaryFileData["dataURL"],
              created: Number.isNaN(createdTimestamp)
                ? Date.now()
                : createdTimestamp,
            } satisfies BinaryFileData,
          };
        }),
      );

      if (disposed) {
        return;
      }

      const nextImageAttachments: Record<string, LoadedImageAttachment> = {};
      const nextFiles: BinaryFileData[] = [];

      loadedAttachments.forEach((attachment) => {
        if (!attachment) {
          return;
        }

        nextImageAttachments[attachment.attachmentId] = {
          file: attachment.file,
          width: attachment.width,
          height: attachment.height,
        };

        if (!registeredAttachmentIdsRef.current.has(attachment.file.id)) {
          nextFiles.push(attachment.file);
        }
      });

      if (nextFiles.length > 0) {
        canvasApi.addFiles(nextFiles);
        nextFiles.forEach((file) => {
          registeredAttachmentIdsRef.current.add(file.id);
        });
      }

      if (Object.keys(nextImageAttachments).length === 0) {
        return;
      }

      setImageAttachmentsById((current) => ({
        ...current,
        ...nextImageAttachments,
      }));
    };

    void loadImageAttachments();

    return () => {
      disposed = true;
    };
  }, [canvasApi, imageAttachmentsById, workspace]);

  useEffect(() => {
    if (!workspace || !canvasApi || !selectedTaskId) {
      return;
    }

    const selectedTask = workspace.taskItems.find(
      (taskItem) => taskItem.id === selectedTaskId,
    );

    if (!selectedTask) {
      return;
    }

    const focusKey = `${selectedTaskId}:${workspace.ui.lastCaptureId ?? "none"}`;

    if (lastAutoFocusKeyRef.current === focusKey) {
      return;
    }

    lastAutoFocusKeyRef.current = focusKey;

    requestAnimationFrame(() => {
      const targetElements = canvasApi
        .getSceneElements()
        .filter(
          (element) =>
            selectedTask.sourceCardIds.includes(element.id) ||
            element.id === selectedTask.id,
        );

      if (targetElements.length === 0) {
        return;
      }

      canvasApi.scrollToContent(targetElements, {
        animate: false,
      });
    });
  }, [canvasApi, selectedTaskId, workspace]);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    setTaskCardPositionsById((current) => {
      const liveTaskIds = new Set(workspace.taskItems.map((taskItem) => taskItem.id));
      const nextEntries = Object.entries(current).filter(([taskId]) => liveTaskIds.has(taskId));

      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }

      return Object.fromEntries(nextEntries);
    });

    pendingSourceCardDeletesRef.current.forEach((sourceCardId) => {
      if (!workspace.sourceCards.some((sourceCard) => sourceCard.id === sourceCardId)) {
        pendingSourceCardDeletesRef.current.delete(sourceCardId);
      }
    });
  }, [workspace]);

  const previewTaskId = hoveredTaskId || selectedTaskId;
  const selectedTask =
    workspace?.taskItems.find((taskItem) => taskItem.id === selectedTaskId) || null;
  const taskSections = TASK_STATUS_ORDER.map((status) => ({
    status,
    title: t.taskSections[status].title,
    items: workspace?.taskItems.filter((taskItem) => taskItem.status === status) || [],
  }));
  const taskSectionCountByStatus = taskSections.reduce<Record<TaskStatus, number>>(
    (accumulator, section) => {
      accumulator[section.status] = section.items.length;
      return accumulator;
    },
    {
      inbox: 0,
      doing: 0,
      done: 0,
    },
  );
  const totalTaskCount = workspace?.taskItems.length || 0;
  const sourceCount = workspace?.sourceCards.length || 0;
  const isEmptyCanvas = Boolean(workspace && workspace.sourceCards.length === 0);
  const selectedSourceCard =
    workspace && selectedSourceCardId
      ? workspace.sourceCards.find((sourceCard) => sourceCard.id === selectedSourceCardId) ||
        null
      : null;
  const focusedSourceCardId =
    selectedSourceCardId ||
    selectedTask?.sourceCardIds[0] ||
    (workspace?.ui.lastCaptureId
      ? workspace.sourceCards.find(
          (sourceCard) => sourceCard.captureId === workspace.ui.lastCaptureId,
        )?.id || null
      : null);
  const activeSourceCards =
    workspace && selectedTask
      ? getSourceCardsForTask(workspace, selectedTask)
      : selectedSourceCard
        ? [selectedSourceCard]
        : [];
  const taskCardLayouts = workspace
    ? getTaskCardLayouts(
        workspace.sourceCards,
        workspace.taskItems,
        focusedSourceCardId,
        previewTaskId,
        taskCardPositionsById,
      )
    : [];
  const primaryCapture =
    workspace && activeSourceCards.length > 0
      ? getPrimaryCapture(workspace, activeSourceCards)
      : null;
  const lastCapturedSourceCard = workspace?.ui.lastCaptureId
    ? workspace.sourceCards.find((card) => card.captureId === workspace.ui.lastCaptureId) ||
      null
    : null;
  const inspectedCapture =
    primaryCapture ||
    (workspace?.ui.lastCaptureId
      ? workspace.captures.find((capture) => capture.id === workspace.ui.lastCaptureId) ||
        null
      : null);
  const inspectedSourceCards = selectedTask
    ? activeSourceCards
    : selectedSourceCard
      ? [selectedSourceCard]
    : lastCapturedSourceCard
      ? [lastCapturedSourceCard]
      : [];
  const primarySourceCard = inspectedSourceCards[0] || null;

  useEffect(() => {
    setDraftTaskTitle(selectedTask?.title || "");
  }, [selectedTask?.id, selectedTask?.title]);

  useEffect(() => {
    setDraftTaskSummary(selectedTask?.summary || "");
  }, [selectedTask?.id, selectedTask?.summary]);

  useEffect(() => {
    setDraftSourceText(inspectedCapture?.rawText || "");
  }, [inspectedCapture?.id, inspectedCapture?.rawText]);

  useEffect(() => {
    if (isInspectorOpen && selectedTask) {
      return;
    }

    setEditingTaskField(null);
  }, [selectedTask, isInspectorOpen]);

  useEffect(() => {
    let disposed = false;

    const loadAttachmentPreview = async () => {
      const attachmentId = inspectedCapture?.attachmentIds?.[0];

      if (!attachmentId) {
        setAttachmentPreviewUrl(null);
        return;
      }

      const dataUrl = await window.desktopApi.getAttachmentDataUrl(attachmentId);

      if (!disposed) {
        setAttachmentPreviewUrl(dataUrl);
      }
    };

    void loadAttachmentPreview();

    return () => {
      disposed = true;
    };
  }, [inspectedCapture?.attachmentIds, inspectedCapture?.id]);

  useEffect(() => {
    if (attachmentPreviewUrl) {
      return;
    }

    setLightboxImageUrl(null);
  }, [attachmentPreviewUrl]);

  useEffect(() => {
    if (!canvasApi || !workspace) {
      return;
    }

    return canvasApi.onPointerUp(() => {
      const positionUpdates = Array.from(pendingPositionUpdatesRef.current.values());
      pendingPositionUpdatesRef.current.clear();
      const elements = canvasApi.getSceneElements();
      const selectedElementIds = canvasApi.getAppState().selectedElementIds;

      if (positionUpdates.length > 0) {
        void Promise.all(
          positionUpdates.map((payload) =>
            window.desktopApi.updateSourceCardPosition(payload),
          ),
        );
      }

      const canvasSelectedTaskId = getSelectedTaskIdFromSelection(
        workspace,
        elements,
        selectedElementIds,
      );

      if (canvasSelectedTaskId) {
        const selectedTask =
          workspace.taskItems.find((taskItem) => taskItem.id === canvasSelectedTaskId) || null;

        if (!selectedTask) {
          return;
        }

        setHoveredTaskId(null);
        setSelectedTaskId(selectedTask.id);
        setSelectedSourceCardId(selectedTask.sourceCardIds[0] || null);
        setIsInspectorOpen(true);
        return;
      }

      const selectedSourceCardId = getSelectedSourceCardIdFromSelection(
        workspace,
        elements,
        selectedElementIds,
      );

      if (!selectedSourceCardId) {
        return;
      }

      const currentTaskBelongsToSource = Boolean(
        selectedTaskId &&
        workspace.sourceCards
          .find((card) => card.id === selectedSourceCardId)
            ?.linkedTaskIds.includes(selectedTaskId),
      );
      const linkedTaskId =
        currentTaskBelongsToSource
          ? selectedTaskId
          : workspace.sourceCards.find((card) => card.id === selectedSourceCardId)
              ?.linkedTaskIds[0] || null;

      setHoveredTaskId(null);
      setSelectedSourceCardId(selectedSourceCardId);
      setSelectedTaskId(linkedTaskId);
      setIsInspectorOpen(true);
    });
  }, [canvasApi, workspace]);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }

    requestAnimationFrame(() => {
      taskRowRefs.current.get(selectedTaskId)?.scrollIntoView({
        block: "nearest",
      });
    });
  }, [selectedTaskId]);

  const handleCaptureClick = async () => {
    await window.desktopApi.captureClipboard();
  };

  const handleWindowMinimize = async () => {
    const state = await window.desktopApi.minimizeWindow();
    setIsWindowMaximized(state.isMaximized);
  };

  const handleWindowMaximizeToggle = async () => {
    const state = await window.desktopApi.toggleMaximizeWindow();
    setIsWindowMaximized(state.isMaximized);
  };

  const handleWindowClose = async () => {
    const state = await window.desktopApi.closeWindow();
    setIsWindowMaximized(state.isMaximized);
  };

  const handleManualCaptureSubmit = async () => {
    const normalizedText = manualCaptureDraft.trim();

    if (!normalizedText) {
      return;
    }

    setIsManualComposerOpen(false);
    setManualCaptureDraft("");
    await window.desktopApi.createManualTextCapture({
      text: normalizedText,
    });
  };

  const handleTaskClick = (taskItem: TaskItem) => {
    setHoveredTaskId(null);
    setSelectedTaskId(taskItem.id);
    setSelectedSourceCardId(taskItem.sourceCardIds[0] || null);

    if (!canvasApi) {
      return;
    }

    const targetElements = canvasApi
      .getSceneElements()
      .filter(
        (element) =>
          taskItem.sourceCardIds.includes(element.id) || element.id === taskItem.id,
      );

    if (targetElements.length > 0) {
      canvasApi.scrollToContent(targetElements, {
        animate: true,
      });
      canvasApi.setToast({
        message: t.linkedSourcesToast(taskItem.sourceCardIds.length),
        duration: 1200,
      });
    }
  };

  const handleTaskStatusChange = async (
    taskId: string,
    status: "inbox" | "doing" | "done",
  ) => {
    await window.desktopApi.updateTaskStatus({
      taskId,
      status,
    });
  };

  const handleTaskCompletionToggle = async (taskItem: TaskItem) => {
    setHoveredTaskId(null);
    await handleTaskStatusChange(
      taskItem.id,
      taskItem.status === "done" ? "inbox" : "done",
    );
  };

  const handleTaskDelete = async (taskItem: TaskItem) => {
    const confirmed = window.confirm(t.deleteTaskConfirm(taskItem.title));

    if (!confirmed) {
      return;
    }

    setHoveredTaskId((current) => (current === taskItem.id ? null : current));
    setSelectedTaskId((current) => (current === taskItem.id ? null : current));
    await window.desktopApi.deleteTask({
      taskId: taskItem.id,
    });
  };

  const handleLanguageChange = async (nextLanguage: AppLanguage) => {
    await window.desktopApi.updateLanguage({
      language: nextLanguage,
    });
    setIsSettingsOpen(false);
  };

  const handleAiConfigSave = async () => {
    setAiSaveState("saving");
    setAiSaveError(null);

    try {
      await window.desktopApi.updateAiConfig({
        provider: draftAiProvider,
        baseUrl: draftAiBaseUrl,
        apiKey: draftAiApiKey,
        model: draftAiModel,
      });
      setAiSaveState("saved");
      setDraftAiApiKey("");
    } catch (error) {
      setAiSaveState("idle");
      setAiSaveError(error instanceof Error ? error.message : t.aiConfigSaveError);
    }
  };

  const handleShortcutRetry = async () => {
    setIsRetryingShortcut(true);

    try {
      const nextState = await window.desktopApi.retryShortcutRegistration();
      setAppRuntime(nextState);
    } catch (error) {
      // The main process already translates retry failures into runtime status.
    } finally {
      setIsRetryingShortcut(false);
    }
  };

  const handleTaskTitleCommit = async () => {
    if (!selectedTask) {
      return;
    }

    const normalizedText = draftTaskTitle.trim();

    if (!normalizedText) {
      setDraftTaskTitle(selectedTask.title);
      setEditingTaskField(null);
      return;
    }

    if (normalizedText === selectedTask.title) {
      setEditingTaskField(null);
      return;
    }

    await window.desktopApi.updateTaskText({
      taskId: selectedTask.id,
      text: normalizedText,
    });
    setEditingTaskField(null);
  };

  const handleTaskSummaryCommit = async () => {
    if (!selectedTask) {
      return;
    }

    const normalizedSummary = draftTaskSummary.trim();

    if (!normalizedSummary) {
      setDraftTaskSummary(selectedTask.summary);
      setEditingTaskField(null);
      return;
    }

    if (normalizedSummary === selectedTask.summary) {
      setEditingTaskField(null);
      return;
    }

    await window.desktopApi.updateTaskSummary({
      taskId: selectedTask.id,
      summary: normalizedSummary,
    });
    setEditingTaskField(null);
  };

  const handleSourceTextCommit = async () => {
    if (!primarySourceCard || !inspectedCapture) {
      return;
    }

    const normalizedText = draftSourceText.trim();

    if (!normalizedText) {
      setDraftSourceText(inspectedCapture.rawText || "");
      return;
    }

    if (normalizedText === (inspectedCapture.rawText || "").trim()) {
      return;
    }

    await window.desktopApi.updateSourceCardText({
      sourceCardId: primarySourceCard.id,
      text: normalizedText,
    });
  };

  const handleScrollChange = (
    scrollX: number,
    scrollY: number,
    zoom: { value: number },
  ) => {
    setScrollState((current) => {
      if (
        current.scrollX === scrollX &&
        current.scrollY === scrollY &&
        current.zoom === zoom.value
      ) {
        return current;
      }

      return {
        scrollX,
        scrollY,
        zoom: zoom.value,
      };
    });
    setViewportTick((value) => value + 1);
  };

  const handleSceneChange = (
    elements: readonly SceneElementLike[],
    appState: AppState,
  ) => {
    setScrollState((current) => {
      if (
        current.scrollX === appState.scrollX &&
        current.scrollY === appState.scrollY &&
        current.zoom === appState.zoom.value
      ) {
        return current;
      }

      return {
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom.value,
      };
    });

    if (!workspace) {
      return;
    }

    const workspaceSourceCardIds = new Set(
      workspace.sourceCards.map((sourceCard) => sourceCard.id),
    );
    const deletedSourceCardIds = Array.from(
      new Set(
        elements
          .filter((element) => element.isDeleted)
          .map((element) => {
            if (workspaceSourceCardIds.has(element.id)) {
              return element.id;
            }

            const sourceCardIdFromCustomData =
              typeof element.customData?.sourceCardId === "string"
                ? element.customData.sourceCardId
                : null;

            if (
              sourceCardIdFromCustomData &&
              workspaceSourceCardIds.has(sourceCardIdFromCustomData)
            ) {
              return sourceCardIdFromCustomData;
            }

            return null;
          })
          .filter((sourceCardId): sourceCardId is string => Boolean(sourceCardId)),
      ),
    ).filter((sourceCardId) => !pendingSourceCardDeletesRef.current.has(sourceCardId));

    if (deletedSourceCardIds.length > 0) {
      deletedSourceCardIds.forEach((sourceCardId) => {
        pendingSourceCardDeletesRef.current.add(sourceCardId);
        void window.desktopApi
          .deleteSourceCard({
            sourceCardId,
          })
          .finally(() => {
            pendingSourceCardDeletesRef.current.delete(sourceCardId);
          });
      });

      return;
    }

    const changedPositions = workspace.sourceCards
      .map((sourceCard) => {
        const element = elements.find(
          (candidate) => candidate.id === sourceCard.id && !candidate.isDeleted,
        );

        if (!element) {
          return null;
        }

        if (
          element.x === sourceCard.position.x &&
          element.y === sourceCard.position.y
        ) {
          return null;
        }

        return {
          sourceCardId: sourceCard.id,
          position: {
            x: element.x,
            y: element.y,
          },
        };
      })
      .filter((item): item is PositionUpdate => Boolean(item));

    const changedTaskCardPositions = taskCardLayouts
      .map((taskCardLayout) => {
        const element = elements.find(
          (candidate) =>
            candidate.id === taskCardLayout.taskId &&
            !candidate.isDeleted &&
            typeof candidate.customData?.taskId === "string",
        );

        if (!element) {
          return null;
        }

        if (element.x === taskCardLayout.x && element.y === taskCardLayout.y) {
          return null;
        }

        return {
          taskId: taskCardLayout.taskId,
          position: {
            x: Math.round(element.x),
            y: Math.round(element.y),
          },
        };
      })
      .filter(
        (
          item,
        ): item is {
          taskId: string;
          position: {
            x: number;
            y: number;
          };
        } => Boolean(item),
      );

    pendingPositionUpdatesRef.current.clear();
    changedPositions.forEach((item) => {
      pendingPositionUpdatesRef.current.set(item.sourceCardId, item);
    });

    if (changedTaskCardPositions.length > 0) {
      setTaskCardPositionsById((current) => {
        let didChange = false;
        const next = { ...current };

        changedTaskCardPositions.forEach((item) => {
          const currentPosition = next[item.taskId];

          if (
            currentPosition?.x === item.position.x &&
            currentPosition?.y === item.position.y
          ) {
            return;
          }

          next[item.taskId] = item.position;
          didChange = true;
        });

        return didChange ? next : current;
      });
    }

    const editingElementId =
      typeof (appState as AppState & { editingElement?: { id?: string | null } | null })
        .editingElement?.id === "string"
        ? (appState as AppState & { editingElement?: { id?: string | null } | null })
            .editingElement?.id ?? null
        : null;

    if (editingElementId) {
      return;
    }

    const manualTextElements = elements.filter((element) => {
      if (!isStandaloneTextElement(workspace, element)) {
        return false;
      }

      return (
        !processedManualTextIdsRef.current.has(element.id) &&
        !creatingManualTextIdsRef.current.has(element.id)
      );
    });

    manualTextElements.forEach((element) => {
      processedManualTextIdsRef.current.add(element.id);
      creatingManualTextIdsRef.current.add(element.id);

      void window.desktopApi
        .createManualTextCapture({
          text: element.text?.trim() || "",
          position: {
            x: element.x,
            y: element.y,
          },
        })
        .finally(() => {
          creatingManualTextIdsRef.current.delete(element.id);
        });
    });
  };

  const taskCardLayoutById = new Map(
    taskCardLayouts.map((taskCardLayout) => [taskCardLayout.taskId, taskCardLayout]),
  );
  const connectorPaths: ConnectorPath[] =
    workspace && workspaceRef.current && canvasPaneRef.current
      ? (() => {
          const workspaceRect = workspaceRef.current.getBoundingClientRect();
          const canvasRect = canvasPaneRef.current.getBoundingClientRect();
          const canvasRectRelative = toRelativeRect(canvasRect, workspaceRect);
          const viewportState = canvasApi?.getAppState() || null;
          const branchPaths = taskCardLayouts.reduce<ConnectorPath[]>(
            (paths, taskCardLayout) => {
              const sourceCard =
                workspace.sourceCards.find(
                  (candidate) => candidate.id === taskCardLayout.sourceCardId,
                ) || null;

              if (!sourceCard) {
                return paths;
              }

              const sourceRect = getSceneRectInWorkspace({
                x: sourceCard.position.x,
                y: sourceCard.position.y,
                width: SOURCE_CARD_WIDTH,
                height: SOURCE_CARD_HEIGHT,
                canvasRect,
                workspaceRect,
                scrollState,
                viewportState,
              });
              const taskRect = getSceneRectInWorkspace({
                x: taskCardLayout.x,
                y: taskCardLayout.y,
                width: TASK_CARD_WIDTH,
                height: TASK_CARD_HEIGHT,
                canvasRect,
                workspaceRect,
                scrollState,
                viewportState,
              });

              if (
                !isRectVisibleInCanvas(sourceRect, canvasRectRelative) ||
                !isRectVisibleInCanvas(taskRect, canvasRectRelative)
              ) {
                return paths;
              }

              const sourceCenter = getRectCenter(sourceRect);
              const taskCenter = getRectCenter(taskRect);
              const startPoint = getRectBoundaryPoint(sourceRect, taskCenter);
              const endPoint = getRectBoundaryPoint(taskRect, sourceCenter);

              paths.push({
                id: `branch:${sourceCard.id}:${taskCardLayout.taskId}`,
                d: buildConnectorPath(startPoint, endPoint),
                kind: "task-branch" as const,
                isActive: taskCardLayout.isActive,
              });

              return paths;
            },
            [],
          );
          const taskRowPaths =
            selectedTask && taskCardLayoutById.has(selectedTask.id)
              ? (() => {
                  const taskRowNode = taskRowRefs.current.get(selectedTask.id);

                  if (!taskRowNode) {
                    return [];
                  }

                  const taskCardLayout = taskCardLayoutById.get(selectedTask.id);

                  if (!taskCardLayout) {
                    return [];
                  }

                  const taskRect = getSceneRectInWorkspace({
                    x: taskCardLayout.x,
                    y: taskCardLayout.y,
                    width: TASK_CARD_WIDTH,
                    height: TASK_CARD_HEIGHT,
                    canvasRect,
                    workspaceRect,
                    scrollState,
                    viewportState,
                  });

                  if (!isRectVisibleInCanvas(taskRect, canvasRectRelative)) {
                    return [];
                  }

                  const taskRowRect = toRelativeRect(
                    taskRowNode.getBoundingClientRect(),
                    workspaceRect,
                  );
                  const taskCenter = getRectCenter(taskRect);
                  const taskRowCenter = getRectCenter(taskRowRect);
                  const startPoint = getRectBoundaryPoint(taskRowRect, taskCenter);
                  const endPoint = getRectBoundaryPoint(taskRect, taskRowCenter);

                  return [
                      {
                      id: `row:${selectedTask.id}`,
                      d: buildConnectorPath(startPoint, endPoint),
                      kind: "task-row" as const,
                      isActive: true,
                    },
                  ];
                })()
              : [];

          return [...branchPaths, ...taskRowPaths];
        })()
      : [];

  const detailTitle =
    selectedTask?.title ||
    inspectedSourceCards[0]?.title ||
    t.pickTask;
  const selectedTaskChecklist = selectedTask?.checklist || [];
  const isRemoteAiSelected = draftAiProvider === "openai-compatible";
  const hasStoredAiApiKey = Boolean(workspace?.ai.hasApiKey);
  const isAiConfigValid =
    draftAiProvider === "local" ||
    Boolean(
      draftAiBaseUrl.trim() &&
        (draftAiApiKey.trim() || hasStoredAiApiKey) &&
        draftAiModel.trim(),
    );
  const shortcutRuntime = appRuntime?.shortcut || null;
  const storageRuntime = appRuntime?.storage || null;
  const desktopPlatform = appRuntime?.platform || INITIAL_DESKTOP_PLATFORM;
  const showCustomWindowControls = desktopPlatform !== "mac";
  const shortcutLabel =
    shortcutRuntime?.displayAccelerator ||
    formatAcceleratorForDisplay(
      workspace?.ui.shortcut || "CommandOrControl+Shift+V",
      desktopPlatform,
    ) ||
    (desktopPlatform === "mac" ? "Cmd+Shift+V" : "Ctrl+Shift+V");
  const detailCaptureStatus = inspectedCapture?.aiStatus || null;
  const hasInspectorContent = Boolean(selectedTask || inspectedCapture);
  const inspectorSummary =
    selectedTask?.summary ||
    inspectedCapture?.aiSummary ||
    t.hoverToInspect;
  const inspectorCreatedAt =
    selectedTask?.createdAt || inspectedCapture?.createdAt || null;
  const handleTaskTitleKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Escape") {
      setDraftTaskTitle(selectedTask?.title || "");
      setEditingTaskField(null);
      event.currentTarget.blur();
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    void handleTaskTitleCommit();
    event.currentTarget.blur();
  };
  const handleTaskSummaryKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Escape") {
      setDraftTaskSummary(selectedTask?.summary || "");
      setEditingTaskField(null);
      event.currentTarget.blur();
      return;
    }

    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
      return;
    }

    event.preventDefault();
    void handleTaskSummaryCommit();
    event.currentTarget.blur();
  };
  const handleSourceTextKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
      return;
    }

    event.preventDefault();
    void handleSourceTextCommit();
    event.currentTarget.blur();
  };

  void viewportTick;

  return (
    <div className={`app-shell app-shell--${desktopPlatform}`}>
      <div
        className={`workspace-body${isInspectorOpen && hasInspectorContent ? " has-inspector" : ""}`}
        ref={workspaceRef}
      >
        {showCustomWindowControls ? (
          <div className="window-drag-strip" aria-hidden="true" />
        ) : null}
        <div className="workspace-backdrop" aria-hidden="true" />
        {showCustomWindowControls ? (
          <div className="window-controls" aria-label="Window controls">
            <button
              type="button"
              className="window-control window-control--minimize"
              onClick={() => void handleWindowMinimize()}
              aria-label={t.minimizeWindow}
              title={t.minimizeWindow}
            >
              <MinimizeIcon />
            </button>
            <button
              type="button"
              className="window-control window-control--maximize"
              onClick={() => void handleWindowMaximizeToggle()}
              aria-label={isWindowMaximized ? t.restoreWindow : t.maximizeWindow}
              title={isWindowMaximized ? t.restoreWindow : t.maximizeWindow}
            >
              {isWindowMaximized ? <RestoreIcon /> : <MaximizeIcon />}
            </button>
            <button
              type="button"
              className="window-control window-control--close"
              onClick={() => void handleWindowClose()}
              aria-label={t.closeWindow}
              title={t.closeWindow}
            >
              <CloseIcon />
            </button>
          </div>
        ) : null}
        <header className="topbar">
          <div className="topbar__header">
            <div className="topbar__brand">
              <p className="eyebrow">{t.productEyebrow}</p>
              <div className="topbar__title-row">
                <h1>{workspace?.board.name || t.appTitle}</h1>
                <div
                  className={`shortcut-pill${
                    shortcutRuntime && !shortcutRuntime.registered ? " is-error" : ""
                  }`}
                  title={shortcutRuntime?.errorMessage || shortcutLabel}
                >
                  {shortcutLabel}
                </div>
              </div>
            </div>

            <div className="topbar__actions">
              <button
                className="secondary-button"
                onClick={() => setIsSettingsOpen(true)}
              >
                {t.settings}
              </button>
              <button className="capture-button" onClick={handleCaptureClick}>
                {t.captureClipboard}
              </button>
            </div>
          </div>

          <div className="topbar__status-row">
            <div
              className="status-chip"
              data-state={getStatusTone(workspace?.ui.captureStatus || "ready")}
            >
              <span className="status-dot" />
              <span>{workspace?.ui.captureMessage || t.loadingWorkspace}</span>
            </div>
          </div>

          <div className="topbar__metrics">
            <div className="status-metric">
              <strong>{sourceCount}</strong>
              <span>{t.sourcesLabel}</span>
            </div>
            <div className="status-metric">
              <strong>{taskSectionCountByStatus.inbox}</strong>
              <span>{t.taskSections.inbox.title}</span>
            </div>
            <div className="status-metric">
              <strong>{taskSectionCountByStatus.doing}</strong>
              <span>{t.taskSections.doing.title}</span>
            </div>
            <div className="status-metric">
              <strong>{taskSectionCountByStatus.done}</strong>
              <span>{t.taskSections.done.title}</span>
            </div>
          </div>
        </header>

        <svg className="link-layer" aria-hidden="true">
          {connectorPaths.map((pathItem) => (
            <path
              key={pathItem.id}
              className={`link-layer__path link-layer__path--${pathItem.kind}${
                pathItem.isActive ? " is-active" : ""
              }`}
              d={pathItem.d}
            />
          ))}
        </svg>

        <section className="canvas-pane">
          <div className="canvas-stage" ref={canvasPaneRef}>
            <Excalidraw
              langCode={language === "zh-CN" ? "zh-CN" : "en"}
              excalidrawAPI={setCanvasApi}
              onChange={handleSceneChange}
              onScrollChange={handleScrollChange}
              initialData={{
                elements: [],
                appState: {
                  viewBackgroundColor: "#eef3f7",
                },
              }}
              zenModeEnabled
              UIOptions={{
                canvasActions: {
                  export: false,
                  loadScene: false,
                  saveAsImage: false,
                  saveToActiveFile: false,
                  clearCanvas: false,
                  toggleTheme: false,
                  changeViewBackgroundColor: false,
                },
              }}
            />
          </div>
          <div className={`canvas-pane__badge${isEmptyCanvas ? " is-empty" : ""}`}>
            <div className="canvas-pane__badge-copy">
              <p className="eyebrow">
                {isEmptyCanvas ? t.emptyCanvasEyebrow : t.sourceCanvasLabel}
              </p>
              <p className="canvas-pane__badge-title">
                {isEmptyCanvas ? t.emptyCanvasTitle : t.sourceCanvasLegend}
              </p>
              {isEmptyCanvas ? (
                <p className="canvas-pane__badge-note">{t.emptyCanvasBody}</p>
              ) : null}
            </div>
            <div className="canvas-pane__badge-actions">
              <button
                className="secondary-button secondary-button--compact"
                onClick={() => setIsManualComposerOpen(true)}
              >
                {t.manualAdd}
              </button>
            </div>
          </div>
        </section>

        <aside className="task-pane">
          <div className="task-pane__header">
            <div className="task-pane__heading">
              <p className="pane-label">{t.taskProjectionLabel}</p>
              <div className="task-pane__title-row">
                <h2>{t.tasksLabel}</h2>
                <span className="task-pane__count">{totalTaskCount}</span>
              </div>
            </div>
            {hasInspectorContent ? (
              <button
                className="secondary-button secondary-button--compact"
                onClick={() => setIsInspectorOpen(true)}
              >
                {t.openInspector}
              </button>
            ) : null}
          </div>

          <div className="task-pane__sections">
            {totalTaskCount === 0 ? (
              <div className="task-empty">{t.noItems}</div>
            ) : (
              taskSections.map((section) =>
                section.items.length > 0 ? (
                  <section
                    className={`task-section${section.status === "done" ? " is-done" : ""}`}
                    key={section.status}
                  >
                    <div className="task-section__header">
                      <h3>{section.title}</h3>
                      <span>{section.items.length}</span>
                    </div>

                    <div className="task-section__list">
                      {section.items.map((taskItem) => {
                        const isHovered = hoveredTaskId === taskItem.id;
                        const isSelected = selectedTaskId === taskItem.id;
                        const isDone = taskItem.status === "done";
                        const checklistCount = taskItem.checklist.length;

                        return (
                          <div
                            key={taskItem.id}
                            ref={(node) => {
                              taskRowRefs.current.set(taskItem.id, node);
                            }}
                            className={`task-row${isHovered ? " is-hovered" : ""}${
                              isSelected ? " is-selected" : ""
                            }${isDone ? " is-done" : ""}`}
                            onMouseEnter={() => setHoveredTaskId(taskItem.id)}
                            onMouseLeave={() => setHoveredTaskId((current) =>
                              current === taskItem.id ? null : current,
                            )}
                          >
                            <button
                              className="task-row__select"
                              onClick={() => handleTaskClick(taskItem)}
                            >
                              <div className="task-row__copy">
                                <span className="task-row__title">{taskItem.title}</span>
                                <div className="task-row__meta">
                                  {taskItem.timeHint ? <span>{taskItem.timeHint}</span> : null}
                                  <span>{t.sourceCount(taskItem.sourceCardIds.length)}</span>
                                  {checklistCount > 0 ? (
                                    <span className="task-row__meta-badge">
                                      {t.checklistCount(checklistCount)}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </button>
                            <div className="task-row__actions">
                              <button
                                className={`task-row__toggle${isDone ? " is-active" : ""}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleTaskCompletionToggle(taskItem);
                                }}
                                aria-label={isDone ? t.markTaskUndone : t.markTaskDone}
                                title={isDone ? t.markTaskUndone : t.markTaskDone}
                              >
                                <span className="task-row__toggle-dot" />
                              </button>
                              <button
                                className="task-row__delete"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleTaskDelete(taskItem);
                                }}
                                aria-label={t.deleteTask}
                                title={t.deleteTask}
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null,
              )
            )}
          </div>
        </aside>

        <aside
          className={`inspector-drawer${
            isInspectorOpen && hasInspectorContent ? " is-open" : ""
          }`}
          aria-hidden={!isInspectorOpen || !hasInspectorContent}
        >
          <div className="inspector-drawer__surface">
            <div className="inspector-drawer__header">
              <div>
                <p className="pane-label">{t.inspectorLabel}</p>
                <h3>{detailTitle}</h3>
                <p>{inspectorSummary}</p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setIsInspectorOpen(false)}
                aria-label={t.closeInspector}
                title={t.closeInspector}
              >
                <CloseIcon />
              </button>
            </div>

            {hasInspectorContent ? (
              <div className="inspector-drawer__body">
                {selectedTask ? (
                  <div className="status-switcher" role="tablist" aria-label={t.taskStatusAria}>
                    {TASK_STATUS_ORDER.map((status) => (
                      <button
                        key={status}
                        className={status === selectedTask.status ? "is-active" : ""}
                        onClick={() => void handleTaskStatusChange(selectedTask.id, status)}
                      >
                        {t.taskSections[status].title}
                      </button>
                    ))}
                  </div>
                ) : null}

                <section className="inspector-card inspector-card--meta">
                  <span className="detail-label">{t.created}</span>
                  <p className="inspector-meta-value">
                    {inspectorCreatedAt
                      ? formatDateTime(inspectorCreatedAt, language)
                      : "--"}
                  </p>
                </section>

                {selectedTask ? (
                  <section className="inspector-card">
                    <span className="detail-label">{t.taskTitleLabel}</span>
                    {editingTaskField === "title" ? (
                      <input
                        id="task-title-input"
                        className="detail-input"
                        value={draftTaskTitle}
                        onChange={(event) => setDraftTaskTitle(event.target.value)}
                        onBlur={() => void handleTaskTitleCommit()}
                        onKeyDown={handleTaskTitleKeyDown}
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        className="detail-display detail-display--title"
                        onClick={() => setEditingTaskField("title")}
                        aria-label={t.taskTitleLabel}
                        title={t.taskTitleLabel}
                      >
                        <span>{selectedTask.title}</span>
                      </button>
                    )}
                  </section>
                ) : null}

                {detailCaptureStatus && detailCaptureStatus !== "done" ? (
                  <section className="inspector-card">
                    <span className="detail-label">{t.pipeline}</span>
                    <div className="pipeline-banner" data-state={detailCaptureStatus}>
                      {detailCaptureStatus === "failed"
                        ? inspectedCapture?.errorMessage || t.pipelineReviewFallback
                        : t.pipelineProcessing}
                    </div>
                  </section>
                ) : null}

                {selectedTask ? (
                  <section className="inspector-card">
                    <span className="detail-label">{t.aiSummary}</span>
                    {editingTaskField === "summary" ? (
                      <textarea
                        id="task-summary-input"
                        className="detail-textarea detail-textarea--summary"
                        value={draftTaskSummary}
                        onChange={(event) => setDraftTaskSummary(event.target.value)}
                        onBlur={() => void handleTaskSummaryCommit()}
                        onKeyDown={handleTaskSummaryKeyDown}
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        className="detail-display detail-display--summary"
                        onClick={() => setEditingTaskField("summary")}
                        aria-label={t.aiSummary}
                        title={t.aiSummary}
                      >
                        <span>{selectedTask.summary}</span>
                      </button>
                    )}
                  </section>
                ) : inspectedCapture?.aiSummary ? (
                  <section className="inspector-card">
                    <span className="detail-label">{t.aiSummary}</span>
                    <p className="inspector-summary">{inspectedCapture.aiSummary}</p>
                  </section>
                ) : null}

                {selectedTaskChecklist.length > 0 ? (
                  <section className="inspector-card">
                    <div className="inspector-card__heading">
                      <span className="detail-label">{t.taskChecklist}</span>
                      <span className="inspector-pill">
                        {t.checklistCount(selectedTaskChecklist.length)}
                      </span>
                    </div>
                    <ol className="task-checklist">
                      {selectedTaskChecklist.map((item, index) => (
                        <li
                          className="task-checklist__item"
                          key={`${selectedTask?.id || "task"}:${index}:${item}`}
                        >
                          <span className="task-checklist__index">{index + 1}</span>
                          <span className="task-checklist__text">{item}</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}

                {attachmentPreviewUrl ? (
                  <section className="inspector-card">
                    <div className="attachment-preview__header">
                      <span className="detail-label">{t.attachmentPreview}</span>
                      <button
                        className="secondary-button secondary-button--compact"
                        onClick={() => setLightboxImageUrl(attachmentPreviewUrl)}
                      >
                        {t.openImagePreview}
                      </button>
                    </div>
                    <button
                      className="attachment-preview"
                      onClick={() => setLightboxImageUrl(attachmentPreviewUrl)}
                    >
                      <img src={attachmentPreviewUrl} alt={detailTitle} />
                    </button>
                  </section>
                ) : null}

                {inspectedCapture ? (
                  <section className="inspector-card inspector-card--stretch">
                    <label className="detail-label" htmlFor="source-text-input">
                      {t.capturedText}
                    </label>
                    <textarea
                      id="source-text-input"
                      className="detail-textarea"
                      value={draftSourceText}
                      onChange={(event) => setDraftSourceText(event.target.value)}
                      onBlur={() => void handleSourceTextCommit()}
                      onKeyDown={handleSourceTextKeyDown}
                    />
                  </section>
                ) : null}

                {inspectedSourceCards.length ? (
                  <section className="inspector-card">
                    <span className="detail-label">{t.sourceCards}</span>
                    <div className="detail-tags">
                      {inspectedSourceCards.map((sourceCard) => (
                        <span className="detail-tag" key={sourceCard.id}>
                          {sourceCard.title}
                        </span>
                      ))}
                    </div>
                  </section>
                ) : null}

                {inspectedCapture?.tags?.length ? (
                  <section className="inspector-card">
                    <span className="detail-label">{t.tags}</span>
                    <div className="detail-tags">
                      {inspectedCapture.tags.map((tag) => (
                        <span className="detail-tag" key={tag}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="inspector-empty">
                <h3>{t.pickTask}</h3>
                <p>{t.hoverToInspect}</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {isSettingsOpen ? (
        <div
          className="settings-overlay"
          onClick={() => setIsSettingsOpen(false)}
          role="presentation"
        >
          <section
            className="settings-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t.settingsTitle}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="settings-panel__header">
              <div>
                <p className="pane-label">{t.settings}</p>
                <h3>{t.settingsTitle}</h3>
                <p>{t.settingsDescription}</p>
              </div>
              <button
                className="secondary-button"
                onClick={() => setIsSettingsOpen(false)}
              >
                {t.settingsClose}
              </button>
            </div>

            <div className="settings-section">
              <div className="settings-section__heading">
                <span className="detail-label">{t.appStatusSection}</span>
                <p className="settings-section__hint">{t.appStatusDescription}</p>
              </div>

              <div className="settings-runtime-grid">
                <section
                  className={`runtime-status-card${
                    shortcutRuntime
                      ? shortcutRuntime.registered
                        ? " is-healthy"
                        : " is-warning"
                      : ""
                  }`}
                >
                  <span className="detail-label">{t.shortcutStatus}</span>
                  <strong>{shortcutLabel}</strong>
                  <p>
                    {!shortcutRuntime
                      ? t.loadingWorkspace
                      : shortcutRuntime.registered
                      ? t.shortcutStatusReady
                      : shortcutRuntime?.errorMessage || t.shortcutStatusUnavailable}
                  </p>
                  {shortcutRuntime && !shortcutRuntime.registered ? (
                    <button
                      className="secondary-button secondary-button--compact"
                      onClick={() => void handleShortcutRetry()}
                      disabled={isRetryingShortcut}
                    >
                      {isRetryingShortcut ? t.shortcutRetrying : t.shortcutRetry}
                    </button>
                  ) : null}
                </section>

                <section
                  className={`runtime-status-card${
                    storageRuntime
                      ? storageRuntime.status === "ready"
                        ? " is-healthy"
                        : " is-warning"
                      : ""
                  }`}
                >
                  <span className="detail-label">{t.storageStatus}</span>
                  <strong>
                    {!storageRuntime
                      ? t.loadingWorkspace
                      : storageRuntime.status === "recovered-from-backup"
                      ? t.storageStatusRecovered
                      : storageRuntime.status === "reset-to-empty"
                        ? t.storageStatusReset
                        : t.storageStatusReady}
                  </strong>
                  <p>{storageRuntime?.message || t.storageStatusHealthyHint}</p>
                </section>
              </div>
            </div>

            <div className="settings-section">
              <span className="detail-label">{t.languageSection}</span>
              <div className="language-options">
                {LANGUAGE_OPTIONS.map((option) => {
                  const optionLabel =
                    option === "zh-CN" ? t.languageChinese : t.languageEnglish;
                  const isCurrent = option === language;

                  return (
                    <button
                      key={option}
                      className={`language-option${isCurrent ? " is-active" : ""}`}
                      onClick={() => handleLanguageChange(option)}
                    >
                      <div>
                        <strong>{optionLabel}</strong>
                        <span>{option}</span>
                      </div>
                      {isCurrent ? <em>{t.languageCurrent}</em> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section__heading">
                <span className="detail-label">{t.aiSection}</span>
                <p className="settings-section__hint">{t.aiSectionDescription}</p>
              </div>

              <div className="language-options">
                <button
                  className={`language-option${draftAiProvider === "local" ? " is-active" : ""}`}
                  onClick={() => {
                    setDraftAiProvider("local");
                    setAiSaveState("idle");
                    setAiSaveError(null);
                  }}
                >
                  <div>
                    <strong>{t.aiProviderLocal}</strong>
                    <span>{t.aiProviderLocalHint}</span>
                  </div>
                  {draftAiProvider === "local" ? <em>{t.languageCurrent}</em> : null}
                </button>

                <button
                  className={`language-option${
                    draftAiProvider === "openai-compatible" ? " is-active" : ""
                  }`}
                  onClick={() => {
                    setDraftAiProvider("openai-compatible");
                    setAiSaveState("idle");
                    setAiSaveError(null);
                  }}
                >
                  <div>
                    <strong>{t.aiProviderOpenAiCompatible}</strong>
                    <span>{t.aiProviderOpenAiCompatibleHint}</span>
                  </div>
                  {draftAiProvider === "openai-compatible" ? (
                    <em>{t.languageCurrent}</em>
                  ) : null}
                </button>
              </div>

              <div className="settings-form">
                <div className="settings-form__field">
                  <label className="detail-label" htmlFor="ai-base-url">
                    {t.aiBaseUrl}
                  </label>
                  <input
                    id="ai-base-url"
                    className="detail-input"
                    value={draftAiBaseUrl}
                    onChange={(event) => {
                      setDraftAiBaseUrl(event.target.value);
                      setAiSaveState("idle");
                      setAiSaveError(null);
                    }}
                    placeholder={t.aiBaseUrlPlaceholder}
                    disabled={!isRemoteAiSelected}
                  />
                </div>

                <div className="settings-form__field">
                  <label className="detail-label" htmlFor="ai-model">
                    {t.aiModel}
                  </label>
                  <input
                    id="ai-model"
                    className="detail-input"
                    value={draftAiModel}
                    onChange={(event) => {
                      setDraftAiModel(event.target.value);
                      setAiSaveState("idle");
                      setAiSaveError(null);
                    }}
                    placeholder={t.aiModelPlaceholder}
                    disabled={!isRemoteAiSelected}
                  />
                </div>

                <div className="settings-form__field">
                  <label className="detail-label" htmlFor="ai-api-key">
                    {t.aiApiKey}
                  </label>
                  <input
                    id="ai-api-key"
                    className="detail-input"
                    type="password"
                    value={draftAiApiKey}
                    autoComplete="new-password"
                    onChange={(event) => {
                      setDraftAiApiKey(event.target.value);
                      setAiSaveState("idle");
                      setAiSaveError(null);
                    }}
                    placeholder={
                      hasStoredAiApiKey && !draftAiApiKey.trim()
                        ? t.aiApiKeyPlaceholderSaved
                        : t.aiApiKeyPlaceholder
                    }
                    disabled={!isRemoteAiSelected}
                  />
                  {isRemoteAiSelected || hasStoredAiApiKey || draftAiApiKey.trim() ? (
                    <p
                      className={`settings-field-note${
                        hasStoredAiApiKey && !draftAiApiKey.trim() ? " is-success" : ""
                      }`}
                    >
                      {hasStoredAiApiKey && !draftAiApiKey.trim()
                        ? t.aiApiKeyStored
                        : t.aiApiKeyMissing}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="settings-section__footer">
                <p
                  className={`settings-status${
                    aiSaveError ? " is-error" : aiSaveState === "saved" ? " is-success" : ""
                  }`}
                >
                  {aiSaveError
                    ? aiSaveError
                    : aiSaveState === "saved"
                      ? t.aiConfigSaved
                      : isRemoteAiSelected
                        ? t.aiConfigHelperRemote
                        : t.aiConfigHelperLocal}
                </p>

                <button
                  className="capture-button"
                  onClick={() => void handleAiConfigSave()}
                  disabled={aiSaveState === "saving" || !isAiConfigValid}
                >
                  {aiSaveState === "saving" ? t.aiConfigSaving : t.aiConfigSave}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isManualComposerOpen ? (
        <div
          className="composer-overlay"
          onClick={() => setIsManualComposerOpen(false)}
          role="presentation"
        >
          <section
            className="composer-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t.manualAddTitle}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="composer-panel__header">
              <div>
                <p className="pane-label">{t.manualAdd}</p>
                <h3>{t.manualAddTitle}</h3>
                <p>{t.manualAddDescription}</p>
              </div>
              <button
                className="secondary-button"
                onClick={() => setIsManualComposerOpen(false)}
              >
                {t.manualAddCancel}
              </button>
            </div>

            <div className="composer-panel__body">
              <label className="detail-label" htmlFor="manual-capture-input">
                {t.sourceCanvasLabel}
              </label>
              <textarea
                id="manual-capture-input"
                className="detail-textarea composer-textarea"
                value={manualCaptureDraft}
                placeholder={t.manualAddPlaceholder}
                onChange={(event) => setManualCaptureDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
                    return;
                  }

                  event.preventDefault();
                  void handleManualCaptureSubmit();
                }}
                autoFocus
              />
              <p className="composer-panel__hint">{t.manualAddHint}</p>
            </div>

            <div className="composer-panel__actions">
              <button
                className="secondary-button"
                onClick={() => setIsManualComposerOpen(false)}
              >
                {t.manualAddCancel}
              </button>
              <button
                className="capture-button"
                onClick={() => void handleManualCaptureSubmit()}
                disabled={!manualCaptureDraft.trim()}
              >
                {t.manualAddSubmit}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {lightboxImageUrl ? (
        <div
          className="image-lightbox"
          onClick={() => setLightboxImageUrl(null)}
          role="presentation"
        >
          <section
            className="image-lightbox__panel"
            role="dialog"
            aria-modal="true"
            aria-label={t.attachmentPreview}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="image-lightbox__header">
              <div>
                <p className="pane-label">{t.attachmentPreview}</p>
                <h3>{detailTitle}</h3>
              </div>
              <button
                className="secondary-button"
                onClick={() => setLightboxImageUrl(null)}
              >
                {t.closeImagePreview}
              </button>
            </div>
            <div className="image-lightbox__body">
              <img src={lightboxImageUrl} alt={detailTitle} />
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
