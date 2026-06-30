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

// Window API types
declare global {
  interface Window {
    fileSystem: {
      openFolder: () => Promise<string | null>;
      openFile: () => Promise<string | null>;
      readFile: (filePath: string) => Promise<FileReadResult>;
      writeFile: (filePath: string, content: string) => Promise<FileWriteResult>;
      readDir: (dirPath: string) => Promise<DirReadResult>;
      createFile: (filePath: string) => Promise<FileWriteResult>;
      createFolder: (folderPath: string) => Promise<FileWriteResult>;
      rename: (oldPath: string, newPath: string) => Promise<FileWriteResult>;
      deleteEntry: (targetPath: string) => Promise<FileWriteResult>;
    };
     ai: {
      complete: (prompt: string) => Promise<{ success: boolean; result?: string; error?: string }>;
    };
  }
}



export {};