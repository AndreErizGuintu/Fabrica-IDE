import { useEffect } from 'react';
import MonacoEditor, { loader } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { useTheme } from '../../theme/ThemeContext';
import { useEditorSettings } from '../../theme/EditorSettingsContext';
import './editor.css';

// @monaco-editor/react's loader defaults to fetching Monaco's AMD bundle from
// cdn.jsdelivr.net at runtime. `node_modules/monaco-editor/min/vs` is an AMD
// bundle meant to be requested as static files by its own loader.js, NOT
// imported through webpack's require() -- that was tried first and broke the
// build, because webpack's require() can't statically analyze the AMD
// module's internal require() calls. Instead, copyMonacoVs()
// (.erb/configs/copyMonacoVs.ts) copies that folder next to the renderer's
// index.html at build time (both dev and prod), and this points the loader
// at it as a plain relative path so it resolves against wherever index.html
// itself is being served/loaded from -- no CDN, no dev/prod branching needed
// here since 'vs' always sits alongside index.html in both modes. Must run
// once at module load, before the first <Editor> mount ever calls
// MonacoEditor's internal loader.
loader.config({ paths: { vs: 'vs' } });

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
  const { theme } = useTheme();
  const { fontSize, tabSize, indentType, wordWrap, lineNumbers } = useEditorSettings();

  useEffect(() => {
    loader.init().then((monaco) => {
      const themeId = `fabrica-${theme.id}`;
      monaco.editor.defineTheme(themeId, {
        base: theme.isDark ? 'vs-dark' : 'vs',
        inherit: true,
        rules: [
          { token: 'comment', foreground: theme.monaco.tokens.comment.replace('#', '') },
          { token: 'keyword', foreground: theme.monaco.tokens.keyword.replace('#', '') },
          { token: 'string', foreground: theme.monaco.tokens.string.replace('#', '') },
          { token: 'number', foreground: theme.monaco.tokens.number.replace('#', '') },
          { token: 'function', foreground: theme.monaco.tokens.function.replace('#', '') },
          { token: 'type', foreground: theme.monaco.tokens.type.replace('#', '') },
          { token: 'tag', foreground: theme.monaco.tokens.tag.replace('#', '') },
          { token: 'attribute.name', foreground: theme.monaco.tokens.attributeName.replace('#', '') },
          { token: 'attribute.value', foreground: theme.monaco.tokens.attributeValue.replace('#', '') },
          { token: 'delimiter', foreground: theme.monaco.tokens.delimiter.replace('#', '') },
          { token: 'variable', foreground: theme.monaco.tokens.variable.replace('#', '') },
        ],
        colors: {
          'editor.background': theme.monaco.background,
          'editor.foreground': theme.monaco.foreground,
          'editorLineNumber.foreground': theme.monaco.lineNumber,
          'editorLineNumber.activeForeground': theme.monaco.lineNumberActive,
          'editor.selectionBackground': theme.monaco.selection,
          'editor.lineHighlightBackground': theme.monaco.lineHighlight,
          'editorCursor.foreground': theme.monaco.cursor,
          'editorGutter.background': theme.monaco.background,
        },
      });
      monaco.editor.setTheme(themeId);
    });
  }, [theme]);

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
        theme={`fabrica-${theme.id}`}
        beforeMount={(monaco) => {
          registerHtml5BoilerplateSnippet(monaco);
          monaco.editor.defineTheme('fabrica-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
              // Comments — muted violet-gray, italic
              { token: 'comment', foreground: '77718F', fontStyle: 'italic' },
              { token: 'comment.line', foreground: '77718F', fontStyle: 'italic' },
              { token: 'comment.block', foreground: '77718F', fontStyle: 'italic' },
              // Keywords (body, function, const, if, return) — light violet
              { token: 'keyword', foreground: 'C084FC' },
              { token: 'keyword.control', foreground: 'C084FC' },
              // Strings — mint green
              { token: 'string', foreground: '4ADE80' },
              { token: 'string.quoted', foreground: '4ADE80' },
              { token: 'string.quoted.double', foreground: '4ADE80' },
              { token: 'string.quoted.single', foreground: '4ADE80' },
              // Numbers — orange
              { token: 'number', foreground: 'FB923C' },
              { token: 'number.hex', foreground: 'FB923C' },
              // Functions — cyan
              { token: 'function', foreground: '38BDF8' },
              { token: 'identifier', foreground: 'F4F1FF' },
              // Types, tags, selectors — light violet
              { token: 'type', foreground: 'C084FC' },
              { token: 'tag', foreground: 'C084FC' },
              { token: 'metatag', foreground: 'C084FC' },
              // Attributes — soft white / green for values
              { token: 'attribute.name', foreground: 'F4F1FF' },
              { token: 'attribute.value', foreground: '4ADE80' },
              // CSS-specific
              { token: 'attribute.name.css', foreground: 'F4F1FF' },
              { token: 'attribute.value.css', foreground: '4ADE80' },
              { token: 'attribute.value.hex.css', foreground: 'FB923C' },
              { token: 'attribute.value.number.css', foreground: 'FB923C' },
              { token: 'attribute.value.unit.css', foreground: 'FB923C' },
              { token: 'selector.css', foreground: 'C084FC' },
              { token: 'tag.css', foreground: 'C084FC' },
              { token: 'keyword.css', foreground: 'C084FC' },
              { token: 'variable.css', foreground: '38BDF8' },
              // HTML-specific
              { token: 'tag.html', foreground: 'C084FC' },
              { token: 'attribute.name.html', foreground: 'F4F1FF' },
              { token: 'attribute.value.html', foreground: '4ADE80' },
              { token: 'delimiter.html', foreground: 'A9A3C7' },
              // Delimiters / punctuation — muted
              { token: 'delimiter', foreground: 'A9A3C7' },
              { token: 'operator', foreground: 'A9A3C7' },
              // Variables — soft white
              { token: 'variable', foreground: 'F4F1FF' },
              { token: 'variable.predefined', foreground: 'C084FC' },
              { token: 'variable.parameter', foreground: 'F4F1FF' },
            ],
            colors: {
              'editor.background': '#080719',
              'editor.foreground': '#F4F1FF',
              'editorLineNumber.foreground': '#77718F',
              'editorLineNumber.activeForeground': '#C084FC',
              'editor.selectionBackground': '#3B1D72',
              'editor.lineHighlightBackground': '#0C0922',
              'editorCursor.foreground': '#A855F7',
              'editorGutter.background': '#080719',
              'editorWidget.background': '#12102D',
              'editorWidget.border': '#29204A',
              'editorSuggestWidget.background': '#12102D',
              'editorSuggestWidget.selectedBackground': '#3B1D72',
              'minimap.background': '#080719',
              'minimap.selectionHighlight': '#3B1D72',
              'minimap.errorHighlight': '#F87171',
              'minimap.warningHighlight': '#FBBF24',
              'minimap.findMatchHighlight': '#A855F7',
              'minimap.selectionOccurrenceHighlight': 'rgba(168, 85, 247, 0.2)',
              'minimapGutter.addedBackground': '#22C55E',
              'minimapGutter.modifiedBackground': '#A855F7',
              'minimapGutter.deletedBackground': '#F87171',
              'minimapSlider.background': 'rgba(168, 85, 247, 0.15)',
              'minimapSlider.hoverBackground': 'rgba(168, 85, 247, 0.25)',
              'minimapSlider.activeBackground': 'rgba(168, 85, 247, 0.35)',
              'scrollbarSlider.background': 'rgba(168, 85, 247, 0.15)',
              'scrollbarSlider.hoverBackground': 'rgba(168, 85, 247, 0.25)',
              'scrollbarSlider.activeBackground': 'rgba(168, 85, 247, 0.35)',
            },
          });
        }}
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
          fontSize,
          tabSize,
          insertSpaces: indentType === 'spaces',
          fontFamily: EDITOR_FONT_FAMILY,
          minimap: {
            enabled: true,
            renderCharacters: false,
            maxColumn: 120,
            showSlider: 'mouseover',
            size: 'proportional',
            side: 'right',
          },
          scrollBeyondLastLine: false,
          wordWrap: wordWrap ? 'on' : 'off',
          lineNumbers: lineNumbers ? 'on' : 'off',
          renderLineHighlight: 'all',
          renderWhitespace: 'selection',
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: true,
          },
          lineHeight: 22,
          padding: { top: 16 },
        }}
      />
    </div>
  );
}
