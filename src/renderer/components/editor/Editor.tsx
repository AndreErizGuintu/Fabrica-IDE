import MonacoEditor from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import './editor.css';

export interface EditorProps {
  language: string;
  value: string;
  onChange?: (value: string | undefined) => void;
  filename?: string;
  onSelectionChange?: (selected: string) => void;
}

const HTML5_BOILERPLATE_SNIPPET = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '    <meta charset="UTF-8">',
  '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '    <title>${1:Document}</title>',
  '</head>',
  '<body>',
  '    $0',
  '</body>',
  '</html>',
].join('\n');

// beforeMount fires every time an <Editor> mounts, but @monaco-editor/react's
// `monaco` object is a module-level singleton -- registering on every mount
// (e.g. leaving the editor screen and reopening it) would stack duplicate
// entries in the suggestion list. Guarded so it only ever runs once.
let html5BoilerplateRegistered = false;

function registerHtml5BoilerplateSnippet(monaco: Monaco) {
  if (html5BoilerplateRegistered) return;
  html5BoilerplateRegistered = true;

  monaco.languages.registerCompletionItemProvider('html', {
    triggerCharacters: ['!'],
    provideCompletionItems(model, position) {
      const lineBeforeCursor = model
        .getLineContent(position.lineNumber)
        .slice(0, position.column - 1);

      // Only offer on a line that is otherwise empty apart from the '!'.
      if (lineBeforeCursor.trim() !== '!') {
        return { suggestions: [] };
      }

      const bangColumn = lineBeforeCursor.indexOf('!') + 1;

      return {
        suggestions: [
          {
            label: '! (HTML5 boilerplate)',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: HTML5_BOILERPLATE_SNIPPET,
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: 'HTML5 boilerplate',
            documentation:
              'Expands to a standard HTML5 document skeleton, VS Code Emmet-style.',
            range: {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: bangColumn,
              endColumn: position.column,
            },
          },
        ],
      };
    },
  });
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
        beforeMount={registerHtml5BoilerplateSnippet}
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
