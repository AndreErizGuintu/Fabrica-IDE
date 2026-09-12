import MonacoEditor from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import './editor.css';

export interface EditorProps {
  language: string;
  value: string;
  /** Absolute path of the file this editor is showing. Used ONLY as the
    * Monaco model key -- see toModelPath() below. */
  path: string;
  onChange?: (value: string | undefined) => void;
  filename?: string;
  onSelectionChange?: (selected: string) => void;
}

// @monaco-editor/react keys its internal model cache by `path`, resolving it
// with monaco.Uri.parse(). A raw Windows path makes the drive letter parse as
// a URI *scheme* ("C:\Users\..." -> scheme "c", path "\Users\..."), which is
// unique but malformed. Normalising to a real file:// URI keeps the key stable
// and unique per file while giving Monaco the shape it expects.
//
// Without a `path`, every same-language tab collapses onto ONE model, and with
// it one undo stack and one view state -- Ctrl+Z in one file would unwind edits
// made in another.
function toModelPath(filePath: string): string {
  return `file:///${filePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

const EDITOR_FONT_FAMILY = 'Space Mono, monospace';

// Monaco measures character width at construction time. If the Space Mono
// webfont is still loading at that moment it measures the fallback metrics and
// the caret/selection drift out of alignment with the glyphs. Remeasuring once
// the font is actually resolved fixes the offset. Module-scoped guard so it
// runs once per session, not once per <Editor> mount.
let fontRemeasureScheduled = false;

function scheduleFontRemeasure(monaco: Monaco) {
  if (fontRemeasureScheduled) return;
  if (!EDITOR_FONT_FAMILY.startsWith('Space Mono')) return;
  fontRemeasureScheduled = true;

  Promise.all([document.fonts.load('14px "Space Mono"'), document.fonts.ready])
    .then(() => monaco.editor.remeasureFonts())
    .catch(() => {
      fontRemeasureScheduled = false;
    });
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

export default function Editor({ language, value, path, onChange, onSelectionChange }: EditorProps) {
  return (
    <div className="flex-1 h-full overflow-hidden">
      <MonacoEditor
        height="100%"
        width="100%"
        path={toModelPath(path)}
        language={language}
        // UNCONTROLLED, deliberately -- `defaultValue`, never `value`.
        //
        // With a `value` prop, @monaco-editor/react diffs it against the live
        // buffer on every render and, on any mismatch, replaces the WHOLE
        // document (executeEdits over the full model range + a caret move). A
        // `value` that lagged the buffer by even one render therefore stamped
        // stale text back over what the student had just typed, which read as
        // "my keystroke did nothing". Its sync effect no-ops entirely when
        // `value` is undefined, so omitting the prop removes that path.
        //
        // `defaultValue` seeds a model the FIRST time a given `path` is seen;
        // after that Monaco owns the buffer and `onChange` reports upward. So
        // any future feature that needs to push content INTO an already-open
        // tab (AI apply-to-buffer, reload-from-disk) must do it imperatively
        // via a forwarded ref -- editor.setValue()/executeEdits() -- not by
        // writing tab state. Nothing does this today: the only writer of
        // tab.content is the student typing through onChange.
        defaultValue={value}
        theme="vs-dark"
        beforeMount={registerHtml5BoilerplateSnippet}
        onMount={(editor, monaco) => {
          scheduleFontRemeasure(monaco);
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
          fontFamily: EDITOR_FONT_FAMILY,
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
