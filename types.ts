
export enum MessageType {
  BATCH_INIT = 'batch_init',
  FILE_READY = 'file_ready',
  FILE_PROGRESS = 'file_progress',
  SEGMENT_TRANSLATION = 'segment_translation',
  SEGMENT_WARNING = 'segment_warning',
  FILE_COMPLETE = 'file_complete',
  BATCH_COMPLETE = 'batch_complete',
}

export interface Segment {
  id: string;
  index: number;
  original: string;
  translated: string;
  status: 'pending' | 'translating' | 'completed' | 'warning';
  warningMessage?: string;
  pageNumber?: number; // New: Tracks which page this segment belongs to
}

export interface PageRange {
  start: number;
  end: number;
}

export interface FileJob {
  id: string;
  name: string;
  type: string;
  size: number;
  status: 'idle' | 'queued' | 'processing' | 'completed' | 'error';
  progress: number;
  segments: Segment[];
  htmlContent: string;
  sourceLang: string;
  targetLang: string;
  pageCount?: number; // New: Total pages (PDF only)
  selectedRange?: PageRange; // New: User selected range
}

export interface WebSocketMessage {
  type: MessageType;
  batchId?: string;
  fileId?: string;
  segmentId?: string;
  index?: number;
  payload?: any;
}

export enum SupportedLocale {
  EN = 'en',
  ZH_CN = 'zh-CN',
  ZH_TW = 'zh-TW',
  JA = 'ja',
  KO = 'ko'
}

export interface TranslationConfig {
  sourceLang: string;
  targetLang: string;
}
