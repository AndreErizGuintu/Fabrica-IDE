import MonacoEditor from '@monaco-editor/react';
import './editor.css';

export interface EditorProps {
  language: string;
  value: string;
  onChange?: (value: string | undefined) => void;
  filename?: string;
  onSelectionChange?: (selected: string) => void;
}

export default function Editor({ language, value, onChange, onSelectionChange }: EditorProps) {
  return (
    <div className="flex-1 h-full overflow-hidden">
      <MonacoEditor
        height="100%"
        width="100%"
        language={language}
        value={value}
        theme="vs-dark"
        onMount={(editor) => {
          editor.onDidChangeCursorSelection(() => {
            const selection = editor.getSelection();
            if (selection) {
              const text = editor.getModel()?.getValueInRange(selection) ?? '';
              onSelectionChange?.(text);
            }
          });
        }}
        onChange={onChange}
        options={{
          fontSize: 14,
          fontFamily: 'Space Mono, monospace',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          lineNumbers: 'on',
          renderLineHighlight: 'all',
          padding: { top: 16 },
        }}
      />
    </div>
  );
}
