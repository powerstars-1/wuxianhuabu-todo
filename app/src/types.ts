export type SourceType = "text" | "image" | "mixed";
export type TaskStatus = "inbox" | "doing" | "done";
export type CaptureStatus = "queued" | "processing" | "done" | "failed";
export type CaptureFeedStage = "captured" | "projected" | "failed";
export type AppLanguage = "zh-CN" | "en-US";
export type AiProvider = "local" | "openai-compatible";
export type StorageHealthStatus = "ready" | "recovered-from-backup" | "reset-to-empty";
export type DesktopPlatform = "mac" | "windows" | "linux";

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
    checklist: string[];
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
  checklist: string[];
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

export interface AiConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
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
  ai: AiConfig;
  captures: Capture[];
  sourceCards: SourceCard[];
  taskItems: TaskItem[];
  attachments: Attachment[];
  ui: WorkspaceUiState;
}

export interface ShortcutRuntimeState {
  accelerator: string;
  displayAccelerator: string;
  registered: boolean;
  errorMessage: string | null;
}

export interface StorageHealthState {
  status: StorageHealthStatus;
  message: string | null;
  updatedAt: string | null;
}

export interface AppRuntimeState {
  platform: DesktopPlatform;
  shortcut: ShortcutRuntimeState;
  storage: StorageHealthState;
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

export interface UpdateAiConfigPayload {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  clearApiKey?: boolean;
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
