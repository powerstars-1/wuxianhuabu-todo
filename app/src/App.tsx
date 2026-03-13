import {
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
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

const formatDateTime = (value: string, language: AppLanguage) =>
  new Intl.DateTimeFormat(language, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

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

const getLinkedTaskIdFromSelection = (
  workspace: WorkspaceSnapshot,
  elements: readonly SceneElementLike[],
  selectedElementIds: Readonly<Record<string, true>>,
) => {
  const selectedSourceCardId = Object.keys(selectedElementIds)
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

  if (!selectedSourceCardId) {
    return null;
  }

  return (
    workspace.sourceCards.find((card) => card.id === selectedSourceCardId)
      ?.linkedTaskIds[0] || null
  );
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

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [scrollState, setScrollState] = useState<ScrollState>(EMPTY_SCROLL_STATE);
  const [canvasApi, setCanvasApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [viewportTick, setViewportTick] = useState(0);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [draftTaskTitle, setDraftTaskTitle] = useState("");
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
    if (!isSettingsOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSettingsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    const selectedTaskStillExists = Boolean(
      selectedTaskId &&
        workspace.taskItems.some((taskItem) => taskItem.id === selectedTaskId),
    );
    const latestCaptureId = workspace.ui.lastCaptureId ?? null;

    if (
      latestCaptureId &&
      latestCaptureId !== previousLastCaptureIdRef.current
    ) {
      previousLastCaptureIdRef.current = latestCaptureId;
      const relatedSourceCard = workspace.sourceCards.find(
        (card) => card.captureId === latestCaptureId,
      );

      if (relatedSourceCard?.linkedTaskIds[0]) {
        setSelectedTaskId(relatedSourceCard.linkedTaskIds[0]);
        return;
      }
    }

    previousLastCaptureIdRef.current = latestCaptureId;

    if (selectedTaskStillExists) {
      return;
    }

    setSelectedTaskId(workspace.taskItems[0]?.id ?? null);
  }, [workspace, selectedTaskId]);

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
    const activeSourceIds = activeTask?.sourceCardIds || [];

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

  const activeTaskId = hoveredTaskId || selectedTaskId;
  const activeTask =
    workspace?.taskItems.find((taskItem) => taskItem.id === activeTaskId) || null;
  const orderedTaskItems = workspace
    ? [
        ...workspace.taskItems.filter((taskItem) => taskItem.status !== "done"),
        ...workspace.taskItems.filter((taskItem) => taskItem.status === "done"),
      ]
    : [];
  const activeSourceCards = workspace
    ? getSourceCardsForTask(workspace, activeTask)
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
    : lastCapturedSourceCard
      ? [lastCapturedSourceCard]
      : [];
  const primarySourceCard = inspectedSourceCards[0] || null;

  useEffect(() => {
    setDraftTaskTitle(activeTask?.title || "");
  }, [activeTask?.id, activeTask?.title]);

  useEffect(() => {
    setDraftSourceText(inspectedCapture?.rawText || "");
  }, [inspectedCapture?.id, inspectedCapture?.rawText]);

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

      const linkedTaskId = getLinkedTaskIdFromSelection(
        workspace,
        canvasApi.getSceneElements(),
        canvasApi.getAppState().selectedElementIds,
      );

      if (!linkedTaskId) {
        return;
      }

      setHoveredTaskId(null);
      setSelectedTaskId((current) =>
        current === linkedTaskId ? current : linkedTaskId,
      );
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

  const handleTaskClick = (taskItem: TaskItem) => {
    setHoveredTaskId(null);
    setSelectedTaskId(taskItem.id);

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
      return;
    }

    if (normalizedText === activeTask.title) {
      return;
    }

    await window.desktopApi.updateTaskText({
      taskId: activeTask.id,
      text: normalizedText,
    });
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

  void viewportTick;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{t.productEyebrow}</p>
          <h1>{workspace?.board.name || t.appTitle}</h1>
        </div>

        <div className="topbar__status">
          <div
            className="status-chip"
            data-state={getStatusTone(workspace?.ui.captureStatus || "ready")}
          >
            <span className="status-dot" />
            <span>{workspace?.ui.captureMessage || t.loadingWorkspace}</span>
          </div>
          <div className="status-metric">
            <strong>{workspace?.sourceCards.length || 0}</strong>
            <span>{t.sourcesLabel}</span>
          </div>
          <div className="status-metric">
            <strong>{workspace?.taskItems.length || 0}</strong>
            <span>{t.tasksLabel}</span>
          </div>
          <div className="status-metric">
            <strong>{workspace?.ui.activeCaptureCount || 0}</strong>
            <span>{t.processingLabel}</span>
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
          <div className="shortcut-pill">{workspace?.ui.shortcut || "Ctrl+Shift+V"}</div>
        </div>
      </header>

      <div className="workspace-body" ref={workspaceRef}>
        <svg className="link-layer" aria-hidden="true">
          {connectorPaths.map((pathItem) => (
            <path key={pathItem.id} d={pathItem.d} />
          ))}
        </svg>

        <section className="canvas-pane">
          <div className="canvas-pane__header">
            <div>
              <p className="pane-label">{t.sourceCanvasLabel}</p>
              <h2>{t.sourceCanvasTitle}</h2>
            </div>
            <div className="canvas-pane__legend">
              <span>{t.sourceCanvasLegend}</span>
            </div>
          </div>

          <div className="canvas-stage" ref={canvasPaneRef}>
            {workspace && workspace.sourceCards.length === 0 ? (
              <div className="empty-canvas">
                <p className="empty-canvas__eyebrow">{t.emptyCanvasEyebrow}</p>
                <h3>{t.emptyCanvasTitle}</h3>
                <p>{t.emptyCanvasBody}</p>
              </div>
            ) : null}

            <Excalidraw
              langCode={language === "zh-CN" ? "zh-CN" : "en"}
              excalidrawAPI={setCanvasApi}
              onChange={handleSceneChange}
              onScrollChange={handleScrollChange}
              initialData={{
                elements: [],
                appState: {
                  viewBackgroundColor: "#f7f1e5",
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
        </section>

        <aside className="task-pane">
          <div className="task-pane__header">
            <div>
              <p className="pane-label">{t.taskProjectionLabel}</p>
              <h2>{t.taskProjectionTitle}</h2>
            </div>
            <div className="task-pane__meta">
              <span>{t.tasksLabel}</span>
              <strong>{workspace?.taskItems.length || 0}</strong>
            </div>
          </div>

          <div className="task-pane__sections">
            {orderedTaskItems.length === 0 ? (
              <div className="task-empty">{t.noItems}</div>
            ) : (
              orderedTaskItems.map((taskItem) => {
                const isHovered = hoveredTaskId === taskItem.id;
                const isSelected = selectedTaskId === taskItem.id;
                const isDone = taskItem.status === "done";

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
                      <span className="task-row__title">{taskItem.title}</span>
                    </button>
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
                  </div>
                );
              })
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
    </div>
  );
}
