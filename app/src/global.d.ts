/// <reference types="vite/client" />

import type {
  DeleteSourceCardPayload,
  DeleteTaskPayload,
  CreateManualTextCapturePayload,
  UpdateAiConfigPayload,
  UpdateLanguagePayload,
  UpdateSourceCardPositionPayload,
  UpdateSourceCardTextPayload,
  UpdateTaskSummaryPayload,
  UpdateTaskStatusPayload,
  UpdateTaskTextPayload,
  WorkspaceSnapshot,
} from "./types";

declare global {
  interface Window {
    desktopApi: {
      getWindowState: () => Promise<{
        isMaximized: boolean;
      }>;
      minimizeWindow: () => Promise<{
        isMaximized: boolean;
      }>;
      toggleMaximizeWindow: () => Promise<{
        isMaximized: boolean;
      }>;
      closeWindow: () => Promise<{
        isMaximized: boolean;
      }>;
      getWorkspaceSnapshot: () => Promise<WorkspaceSnapshot>;
      captureClipboard: () => Promise<WorkspaceSnapshot>;
      createManualTextCapture: (
        payload: CreateManualTextCapturePayload,
      ) => Promise<WorkspaceSnapshot>;
      updateAiConfig: (
        payload: UpdateAiConfigPayload,
      ) => Promise<WorkspaceSnapshot>;
      getAttachmentDataUrl: (attachmentId: string) => Promise<string | null>;
      updateLanguage: (payload: UpdateLanguagePayload) => Promise<WorkspaceSnapshot>;
      updateSourceCardText: (
        payload: UpdateSourceCardTextPayload,
      ) => Promise<WorkspaceSnapshot>;
      updateSourceCardPosition: (
        payload: UpdateSourceCardPositionPayload,
      ) => Promise<WorkspaceSnapshot>;
      updateTaskStatus: (
        payload: UpdateTaskStatusPayload,
      ) => Promise<WorkspaceSnapshot>;
      updateTaskText: (
        payload: UpdateTaskTextPayload,
      ) => Promise<WorkspaceSnapshot>;
      updateTaskSummary: (
        payload: UpdateTaskSummaryPayload,
      ) => Promise<WorkspaceSnapshot>;
      deleteTask: (payload: DeleteTaskPayload) => Promise<WorkspaceSnapshot>;
      deleteSourceCard: (
        payload: DeleteSourceCardPayload,
      ) => Promise<WorkspaceSnapshot>;
      onWorkspaceUpdated: (
        listener: (snapshot: WorkspaceSnapshot) => void,
      ) => () => void;
      onWindowStateChanged: (
        listener: (state: { isMaximized: boolean }) => void,
      ) => () => void;
    };
  }
}

export {};
