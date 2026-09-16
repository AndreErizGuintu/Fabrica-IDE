import { loader } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

export interface ParsedError {
  file: string;
  line: number;
  column: number;
  severity: string;
  code: string;
  message: string;
}

// Common shape every language's saved lint result is normalized to before
// reaching applyMarkers, so that function stays a single shared code path
// instead of branching per language.
export interface LintMarker {
  file: string;
  line: number;
  startColumn: number;
  endColumn: number;
  severity: string;
  message: string;
}

// Mirrors Editor.tsx's toModelPath() -- kept local rather than imported since
// that's a teammate-owned file and this is a one-line helper.
const toModelPath = (filePath: string) =>
  `file:///${filePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;

// Dart's --format=machine output escapes backslashes in FILE_PATH (e.g.
// C:\\Users\\...), so a run of one or more backslashes must collapse to a
// single forward slash -- replacing each backslash independently would turn
// that escaped double-backslash into a double forward slash instead.
const normalize = (p: string) => p.replace(/\\+/g, '/').replace(/^\/+/, '').toLowerCase();

export async function applyMarkers(model: editor.ITextModel, markers: LintMarker[], owner: string) {
  const monaco = await loader.init();
  const modelFile = normalize(model.uri.path);
  const modelMarkers: editor.IMarkerData[] = markers
    .filter((m) => modelFile.endsWith(normalize(m.file)) || normalize(m.file).endsWith(modelFile))
    .map((m) => ({
      severity: m.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      startLineNumber: m.line,
      startColumn: m.startColumn,
      endLineNumber: m.line,
      endColumn: m.endColumn,
      message: m.message,
    }));
  monaco.editor.setModelMarkers(model, owner, modelMarkers);
}

// Runs the build-based lint for a saved .cs file and applies the resulting
// markers to that file's live Monaco model, if it's currently open.
export async function lintCSharpFile(filePath: string) {
  const result = await window.lint.csharp(filePath);
  if (!result.success || !result.errors) return;
  const monaco = await loader.init();
  const model = monaco.editor.getModel(monaco.Uri.parse(toModelPath(filePath)));
  if (!model) return;
  const markers: LintMarker[] = result.errors.map((e) => ({
    file: e.file,
    line: e.line,
    startColumn: e.column,
    endColumn: e.column + 1,
    severity: e.severity,
    message: `${e.code}: ${e.message}`,
  }));
  await applyMarkers(model, markers, 'csharp-build');
}

// Runs `dart analyze` for the project containing a saved .dart file and
// applies the resulting markers to that file's live Monaco model, if open.
export async function lintDartFile(filePath: string) {
  const projectDir = filePath.replace(/[\\/][^\\/]*$/, '');
  const result = await window.lint.dart(projectDir);
  if (!result.success || !result.errors) return;
  const monaco = await loader.init();
  const model = monaco.editor.getModel(monaco.Uri.parse(toModelPath(filePath)));
  if (!model) return;
  const markers: LintMarker[] = result.errors.map((e) => ({
    file: e.file,
    line: e.line,
    startColumn: e.column,
    endColumn: e.endColumn,
    severity: e.severity,
    message: `${e.code}: ${e.message}`,
  }));
  await applyMarkers(model, markers, 'dart-analyze');
}

// Runs `php -l` (syntax check only, first error wins) for a saved .php file
// and applies the resulting marker to its live Monaco model, if open.
export async function lintPhpFile(filePath: string) {
  const result = await window.lint.php(filePath);
  if (!result.success || !result.errors) return;
  const monaco = await loader.init();
  const model = monaco.editor.getModel(monaco.Uri.parse(toModelPath(filePath)));
  if (!model) return;
  // php -l reports no column, so the squiggle spans the whole line -- using
  // the model's own line length rather than a sentinel, since it's right here.
  const markers: LintMarker[] = result.errors.map((e) => ({
    file: e.file,
    line: e.line,
    startColumn: 1,
    endColumn: model.getLineMaxColumn(e.line),
    severity: 'error',
    message: e.message,
  }));
  await applyMarkers(model, markers, 'php-lint');
}
