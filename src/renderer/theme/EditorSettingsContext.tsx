import React, { createContext, useContext, useState } from 'react';

const STORAGE_KEY = 'fabrica.editorSettings';

type IndentType = 'spaces' | 'tabs';

type EditorSettings = {
  fontSize: number;
  tabSize: number;
  indentType: IndentType;
  wordWrap: boolean;
  lineNumbers: boolean;
  autoSave: boolean;
};

const DEFAULT_SETTINGS: EditorSettings = {
  fontSize: 14,
  tabSize: 4,
  indentType: 'spaces',
  wordWrap: true,
  lineNumbers: true,
  autoSave: false,
};

function readSettings(): EditorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: EditorSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
}

type EditorSettingsContextValue = EditorSettings & {
  setFontSize: (fontSize: number) => void;
  setTabSize: (tabSize: number) => void;
  setIndentType: (indentType: IndentType) => void;
  setWordWrap: (wordWrap: boolean) => void;
  setLineNumbers: (lineNumbers: boolean) => void;
  setAutoSave: (autoSave: boolean) => void;
};

const EditorSettingsContext = createContext<EditorSettingsContextValue | undefined>(undefined);

export function EditorSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<EditorSettings>(readSettings);

  const update = (patch: Partial<EditorSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      writeSettings(next);
      return next;
    });
  };

  const setFontSize = (fontSize: number) => update({ fontSize });
  const setTabSize = (tabSize: number) => update({ tabSize });
  const setIndentType = (indentType: IndentType) => update({ indentType });
  const setWordWrap = (wordWrap: boolean) => update({ wordWrap });
  const setLineNumbers = (lineNumbers: boolean) => update({ lineNumbers });
  const setAutoSave = (autoSave: boolean) => update({ autoSave });

  return (
    <EditorSettingsContext.Provider
      value={{ ...settings, setFontSize, setTabSize, setIndentType, setWordWrap, setLineNumbers, setAutoSave }}
    >
      {children}
    </EditorSettingsContext.Provider>
  );
}

export function useEditorSettings(): EditorSettingsContextValue {
  const ctx = useContext(EditorSettingsContext);
  if (!ctx) throw new Error('useEditorSettings must be used within EditorSettingsProvider');
  return ctx;
}
