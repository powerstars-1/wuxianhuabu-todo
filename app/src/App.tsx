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
  SOURCE_CARD_HEIGHT,
  SOURCE_CARD_WIDTH,
} from "./lib/buildScene";
import type {
  AppLanguage,
  Capture,
  CaptureStatus,
  ScrollState,
  SourceCard,
  TaskItem,
  TaskStatus,
  WorkspaceSnapshot,
} from "./types";

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

  return !workspace.sourceCards.some((card) => card.id === element.id);
};

const getBoundTextElement = (
  elements: readonly SceneElementLike[],
  sourceCardId: string,
) =>
  elements.find(
    (candidate) =>
      candidate.type === "text" &&
      candidate.containerId === sourceCardId &&
      !candidate.isDeleted,
  );

const getEditableSourceTextElement = (
  elements: readonly SceneElementLike[],
  sourceCardId: string,
) =>
  getBoundTextElement(elements, sourceCardId) ||
  elements.find(
    (candidate) =>
      candidate.type === "text" &&
      candidate.customData?.sourceCardId === sourceCardId &&
      !candidate.isDeleted,
  );

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
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [draftTaskTitle, setDraftTaskTitle] = useState("");
  const [draftTaskSummary, setDraftTaskSummary] = useState("");
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
  const pendingSourceTextUpdatesRef = useRef(new Set<string>());
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
      const snapshot = await window.desktopApi.getWorkspaceSnapshot();

      if (disposed) {
        return;
      }

      startTransition(() => {
        setWorkspace(snapshot);
      });
    };

    void hydrate();

    const unsubscribe = window.desktopApi.onWorkspaceUpdated((snapshot) => {
      startTransition(() => {
        setWorkspace(snapshot);
      });
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

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

    const imageAttachmentMetaById = Object.fromEntries(
      Object.entries(imageAttachmentsById).map(([attachmentId, attachment]) => [
        attachmentId,
        {
          width: attachment.width,
          height: attachment.height,
        },
      ]),
    );
    const activeTaskId = hoveredTaskId || selectedTaskId;
    const activeTask =
      workspace.taskItems.find((taskItem) => taskItem.id === activeTaskId) || null;
    const activeSourceIds =
      activeTask?.sourceCardIds ||
      (selectedSourceCardId ? [selectedSourceCardId] : []);

    canvasApi.updateScene({
      elements: buildScene(
        workspace.sourceCards,
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
        .filter((element) => selectedTask.sourceCardIds.includes(element.id));

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

    pendingSourceCardDeletesRef.current.forEach((sourceCardId) => {
      if (!workspace.sourceCards.some((sourceCard) => sourceCard.id === sourceCardId)) {
        pendingSourceCardDeletesRef.current.delete(sourceCardId);
      }
    });
  }, [workspace]);

  const activeTaskId = hoveredTaskId || selectedTaskId;
  const activeTask =
    workspace?.taskItems.find((taskItem) => taskItem.id === activeTaskId) || null;
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
  const activeSourceCards =
    workspace && activeTask
      ? getSourceCardsForTask(workspace, activeTask)
      : selectedSourceCard
        ? [selectedSourceCard]
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
  const inspectedSourceCards = activeTask
    ? activeSourceCards
    : selectedSourceCard
      ? [selectedSourceCard]
    : lastCapturedSourceCard
      ? [lastCapturedSourceCard]
      : [];
  const primarySourceCard = inspectedSourceCards[0] || null;

  useEffect(() => {
    setDraftTaskTitle(activeTask?.title || "");
  }, [activeTask?.id, activeTask?.title]);

  useEffect(() => {
    setDraftTaskSummary(activeTask?.summary || "");
  }, [activeTask?.id, activeTask?.summary]);

  useEffect(() => {
    setDraftSourceText(inspectedCapture?.rawText || "");
  }, [inspectedCapture?.id, inspectedCapture?.rawText]);

  useEffect(() => {
    if (isInspectorOpen && activeTask) {
      return;
    }

    setEditingTaskField(null);
  }, [activeTask, isInspectorOpen]);

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

      if (positionUpdates.length > 0) {
        void Promise.all(
          positionUpdates.map((payload) =>
            window.desktopApi.updateSourceCardPosition(payload),
          ),
        );
      }

      const selectedSourceCardId = getSelectedSourceCardIdFromSelection(
        workspace,
        canvasApi.getSceneElements(),
        canvasApi.getAppState().selectedElementIds,
      );

      if (!selectedSourceCardId) {
        return;
      }

      const linkedTaskId =
        workspace.sourceCards.find((card) => card.id === selectedSourceCardId)
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
      .filter((element) => taskItem.sourceCardIds.includes(element.id));

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
    setSelectedSourceCardId((current) =>
      taskItem.sourceCardIds.includes(current || "") ? null : current,
    );
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

  const handleTaskTitleCommit = async () => {
    if (!activeTask) {
      return;
    }

    const normalizedText = draftTaskTitle.trim();

    if (!normalizedText) {
      setDraftTaskTitle(activeTask.title);
      setEditingTaskField(null);
      return;
    }

    if (normalizedText === activeTask.title) {
      setEditingTaskField(null);
      return;
    }

    await window.desktopApi.updateTaskText({
      taskId: activeTask.id,
      text: normalizedText,
    });
    setEditingTaskField(null);
  };

  const handleTaskSummaryCommit = async () => {
    if (!activeTask) {
      return;
    }

    const normalizedSummary = draftTaskSummary.trim();

    if (!normalizedSummary) {
      setDraftTaskSummary(activeTask.summary);
      setEditingTaskField(null);
      return;
    }

    if (normalizedSummary === activeTask.summary) {
      setEditingTaskField(null);
      return;
    }

    await window.desktopApi.updateTaskSummary({
      taskId: activeTask.id,
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

    pendingPositionUpdatesRef.current.clear();
    changedPositions.forEach((item) => {
      pendingPositionUpdatesRef.current.set(item.sourceCardId, item);
    });

    const editingElementId =
      typeof (appState as AppState & { editingElement?: { id?: string | null } | null })
        .editingElement?.id === "string"
        ? (appState as AppState & { editingElement?: { id?: string | null } | null })
            .editingElement?.id ?? null
        : null;

    if (editingElementId) {
      return;
    }

    workspace.sourceCards.forEach((sourceCard) => {
      const editableTextElement = getEditableSourceTextElement(
        elements,
        sourceCard.id,
      );
      const normalizedText = editableTextElement?.text?.trim();

      if (!normalizedText || normalizedText === sourceCard.title) {
        return;
      }

      if (pendingSourceTextUpdatesRef.current.has(sourceCard.id)) {
        return;
      }

      pendingSourceTextUpdatesRef.current.add(sourceCard.id);

      void window.desktopApi
        .updateSourceCardText({
          sourceCardId: sourceCard.id,
          text: normalizedText,
        })
        .finally(() => {
          pendingSourceTextUpdatesRef.current.delete(sourceCard.id);
        });
    });

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

  const connectorPaths =
    workspace && activeTask && workspaceRef.current && canvasPaneRef.current
      ? activeSourceCards
          .map((sourceCard) => {
            const taskRowRect = taskRowRefs.current
              .get(activeTask.id)
              ?.getBoundingClientRect();
            const workspaceRect = workspaceRef.current?.getBoundingClientRect();
            const canvasRect = canvasPaneRef.current?.getBoundingClientRect();

            if (!taskRowRect || !workspaceRect || !canvasRect) {
              return null;
            }

            const viewportState = canvasApi?.getAppState();
            const sourceCenter = sceneCoordsToViewportCoords(
              {
                sceneX: sourceCard.position.x + SOURCE_CARD_WIDTH / 2,
                sceneY: sourceCard.position.y + SOURCE_CARD_HEIGHT / 2,
              },
              {
                zoom:
                  viewportState?.zoom ||
                  ({ value: scrollState.zoom as Zoom["value"] } satisfies Zoom),
                offsetLeft: canvasRect.left,
                offsetTop: canvasRect.top,
                scrollX: viewportState?.scrollX ?? scrollState.scrollX,
                scrollY: viewportState?.scrollY ?? scrollState.scrollY,
              },
            );

            const startX = taskRowRect.left - workspaceRect.left;
            const startY = taskRowRect.top + taskRowRect.height / 2 - workspaceRect.top;
            const endX = sourceCenter.x - workspaceRect.left;
            const endY = sourceCenter.y - workspaceRect.top;

            if (
              sourceCenter.x < canvasRect.left ||
              sourceCenter.x > canvasRect.right ||
              sourceCenter.y < canvasRect.top ||
              sourceCenter.y > canvasRect.bottom
            ) {
              return null;
            }

            const curveStrength = Math.max(80, Math.abs(startX - endX) * 0.28);

            return {
              id: sourceCard.id,
              d: `M ${startX} ${startY} C ${startX - curveStrength} ${startY}, ${
                endX + curveStrength
              } ${endY}, ${endX} ${endY}`,
            };
          })
          .filter((item): item is { id: string; d: string } => Boolean(item))
      : [];

  const detailTitle =
    activeTask?.title ||
    inspectedSourceCards[0]?.title ||
    t.pickTask;
  const detailCaptureStatus = inspectedCapture?.aiStatus || null;
  const hasInspectorContent = Boolean(activeTask || inspectedCapture);
  const inspectorSummary =
    activeTask?.summary ||
    inspectedCapture?.aiSummary ||
    t.hoverToInspect;
  const inspectorCreatedAt =
    activeTask?.createdAt || inspectedCapture?.createdAt || null;
  const handleTaskTitleKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Escape") {
      setDraftTaskTitle(activeTask?.title || "");
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
      setDraftTaskSummary(activeTask?.summary || "");
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
    <div className="app-shell">
      <div
        className={`workspace-body${isInspectorOpen && hasInspectorContent ? " has-inspector" : ""}`}
        ref={workspaceRef}
      >
        <div className="workspace-backdrop" aria-hidden="true" />
        <header className="topbar">
          <div className="topbar__header">
            <div className="topbar__brand">
              <p className="eyebrow">{t.productEyebrow}</p>
              <div className="topbar__title-row">
                <h1>{workspace?.board.name || t.appTitle}</h1>
                <div className="shortcut-pill">
                  {workspace?.ui.shortcut || "Ctrl+Shift+V"}
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
            <path key={pathItem.id} d={pathItem.d} />
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
                        const confidence = Math.round(taskItem.confidence * 100);
                        const confidenceLevel =
                          confidence >= 78 ? "high" : confidence >= 60 ? "medium" : "low";

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
                                  <span
                                    className="task-row__confidence"
                                    data-level={confidenceLevel}
                                  >
                                    {confidence}%
                                  </span>
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
                {activeTask ? (
                  <div className="status-switcher" role="tablist" aria-label={t.taskStatusAria}>
                    {TASK_STATUS_ORDER.map((status) => (
                      <button
                        key={status}
                        className={status === activeTask.status ? "is-active" : ""}
                        onClick={() => void handleTaskStatusChange(activeTask.id, status)}
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

                {activeTask ? (
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
                        <span>{activeTask.title}</span>
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

                {activeTask ? (
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
                        <span>{activeTask.summary}</span>
                      </button>
                    )}
                  </section>
                ) : inspectedCapture?.aiSummary ? (
                  <section className="inspector-card">
                    <span className="detail-label">{t.aiSummary}</span>
                    <p className="inspector-summary">{inspectedCapture.aiSummary}</p>
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
