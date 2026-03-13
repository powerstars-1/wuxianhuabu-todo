export type SourceType = "text" | "image" | "mixed";
export type TaskStatus = "inbox" | "doing" | "done";
export type CaptureStatus = "queued" | "processing" | "done" | "failed";
export type CaptureFeedStage = "captured" | "projected" | "failed";
export type AppLanguage = "zh-CN" | "en-US";

export interface Board {
  id: string;
  schemaVersion: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Capture {
  id: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  sourceType: SourceType;
  rawText: string;
  attachmentIds: string[];
  aiStatus: CaptureStatus;
  aiSummary: string;
  aiTaskSuggestions: Array<{
    title: string;
    timeHint: string | null;
    confidence: number;
  }>;
  aiTimeSuggestion: string | null;
  tags: string[];
  ocrText?: string | null;
  processedAt?: string | null;
  errorMessage?: string | null;
}

export interface Attachment {
  id: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  mimeType: string;
  storageKey: string;
  size: number;
  sha256: string;
}

export interface SourceCard {
  id: string;
  schemaVersion: number;
  captureId: string;
  boardId: string;
  title: string;
  summary: string;
  tags: string[];
  position: {
    x: number;
    y: number;
  };
  sourceType: SourceType;
  attachmentIds: string[];
  linkedTaskIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskItem {
  id: string;
  schemaVersion: number;
  boardId: string;
  title: string;
  summary: string;
  status: TaskStatus;
  timeHint: string | null;
  priority: string;
  sourceCardIds: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceUiState {
  language: AppLanguage;
  shortcut: string;
  captureStatus: string;
  captureMessage: string;
  lastCaptureId: string | null;
  lastCaptureAt: string | null;
  activeCaptureCount: number;
  captureFeed: CaptureFeedItem[];
}

export interface CaptureFeedItem {
  id: string;
  captureId: string;
  stage: CaptureFeedStage;
  message: string;
  createdAt: string;
}

export interface WorkspaceSnapshot {
  schemaVersion: number;
  updatedAt: string;
  board: Board;
  captures: Capture[];
  sourceCards: SourceCard[];
  taskItems: TaskItem[];
  attachments: Attachment[];
  ui: WorkspaceUiState;
}

export interface ScrollState {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface UpdateSourceCardPositionPayload {
  sourceCardId: string;
  position: {
    x: number;
    y: number;
  };
}

export interface UpdateTaskStatusPayload {
  taskId: string;
  status: TaskStatus;
}

export interface UpdateLanguagePayload {
  language: AppLanguage;
}

export interface CreateManualTextCapturePayload {
  text: string;
  position?: {
    x: number;
    y: number;
  };
}

export interface UpdateSourceCardTextPayload {
  sourceCardId: string;
  text: string;
}

export interface UpdateTaskTextPayload {
  taskId: string;
  text: string;
}

export interface UpdateTaskSummaryPayload {
  taskId: string;
  summary: string;
}

export interface DeleteTaskPayload {
  taskId: string;
}

export interface DeleteSourceCardPayload {
  sourceCardId: string;
}
