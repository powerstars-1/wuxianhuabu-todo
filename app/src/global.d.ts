/// <reference types="vite/client" />

import type {
  CreateManualTextCapturePayload,
  UpdateLanguagePayload,
  UpdateSourceCardPositionPayload,
  UpdateSourceCardTextPayload,
  UpdateTaskStatusPayload,
  UpdateTaskTextPayload,
  WorkspaceSnapshot,
} from "./types";

declare global {
  interface Window {
    desktopApi: {
      getWorkspaceSnapshot: () => Promise<WorkspaceSnapshot>;
      captureClipboard: () => Promise<WorkspaceSnapshot>;
      createManualTextCapture: (
        payload: CreateManualTextCapturePayload,
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
      onWorkspaceUpdated: (
        listener: (snapshot: WorkspaceSnapshot) => void,
      ) => () => void;
    };
  }
}

export {};
