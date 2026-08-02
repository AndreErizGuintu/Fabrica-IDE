// File system types
export interface FileEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

export interface FileReadResult {
  success: boolean;
  content?: string;
  error?: string;
}

export interface FileWriteResult {
  success: boolean;
  error?: string;
}

export interface DirReadResult {
  success: boolean;
  files?: FileEntry[];
  error?: string;
}

// Tab type for editor
export interface Tab {
  filename: string;
  path: string;
  content: string;
  isDirty: boolean; // true = unsaved changes
}

export {};