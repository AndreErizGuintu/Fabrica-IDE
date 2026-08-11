# Fabrica IDE — Agent Instructions

Offline-first, AI-assisted desktop IDE (capstone project). Repo branch: `master` (not `main`).

## Stack
- Electron + React + TypeScript (ERB boilerplate)
- Tailwind v4 (`@import "tailwindcss"` in App.css), PostCSS + postcss-loader wired into webpack
- One Electron window — no multi-window setup
- Monaco Editor for code editing
- **node-llama-cpp** (`deepseek-coder-6.7b-instruct.Q4_K_M.gguf`) for offline AI — migrated from Ollama on 2026-07-20. Ollama is no longer bundled or called.

## Ownership boundaries — respect strictly
- Andre owns: `App.tsx`, `src/main/` (IPC handlers, main process), hooks, AI integration, architecture
- Teammate owns: `src/renderer/screens/`, `src/renderer/components/` (UI/design)
- Do not modify files outside your requester's ownership lane without flagging it first.

## File Structure
- `src/main/main.ts` — Electron main process + all IPC handlers, bundled-runtime resolver
- `src/main/llm.ts` — main-process inference PROXY: resolves the model path, forks the worker, speaks the message protocol, owns worker lifecycle. The model itself does NOT load here.
- `src/main/worker/llmWorker.ts` — the inference utility process (moved from `src/main/` on 2026-08-10): model loading, gpuLayers ladder, single-flight lock, generation. Never imports `electron`.
- `src/main/worker/llmProtocol.ts` — the shared main↔worker wire contract (message types, error serialization). Imported by both sides; imports nothing itself.
- `src/main/preload.ts` — contextBridge surface (what renderer can call)
- `src/renderer/preload.d.ts` — TypeScript types for all window.* bridges
- `src/renderer/App.tsx` — navigation controller + SplashScreen + MainMenu + CreateProject + useRecentProjects hook
- `src/renderer/screens/EditorLayout.tsx` — full editor screen (known state-sprawl smell — flagged for post-defense refactor only, don't touch pre-defense)
- `src/renderer/components/editor/Editor.tsx` — Monaco wrapper
- `src/renderer/components/sidebar/Sidebar.tsx` — file tree
- `src/renderer/components/preview/Preview.tsx` — HTML iframe preview
- `src/renderer/components/ai/AIPanel.tsx` — AI panel; four tabbed modes (`TabKey = 'ask' | 'plan' | 'translate' | 'explain'`), rendered as a tab row and selected via `activeTab`, defaulting to **Ask**. Single model, one system prompt per mode.
- `src/renderer/types/index.ts` — shared TypeScript types (Tab, FileEntry)

## IPC Bridge API (window.*)
Always use these bridges — never call Node/Electron APIs directly from the renderer. Check `preload.d.ts` for full type signatures before use.

- `window.fileSystem` — readFile, writeFile, readDir, createFile, createFolder, openFolder (dialog), openFile (dialog), openTerminal
- `window.store` — getRecentProjects, addRecentProject (JSON persistence in `app.getPath('userData')/recent-projects.json`, max 5, newest first)
- `window.runner` — run(filePath), onOutput(cb), onDone(cb), removeListeners() — spawns language runtimes via child_process
- `window.ai` — complete(prompt) — calls **node-llama-cpp** (not Ollama), streams via `ai:token` events (channel name unchanged from the Ollama-era implementation, reused as-is)
- `window.electron.ipcRenderer` — raw IPC, used only for event listeners (`ai:token`, `run:output`, `run:done`)

## Language Execution
Run routing is by file extension in `main.ts` `getRunConfig()`:
- `.html` → iframe preview (no spawn)
- `.php` → bundled PHP via resolver, args `['-f', filePath]`
- `.js` / `.ts` → bundled Node via resolver (native TS type-stripping, no ts-node needed)
- `.cs` → bundled dotnet via resolver, args `['run', filePath]` (NOT `['script', filePath]` — that was a real bug, fixed)
- `.dart` → bundled Dart via resolver, args `['run', filePath]`

**Bundled-runtime resolver** (`getBundledRuntimeBinary()` in `main.ts`): resolves `resources/runtimes/<lang>/<exe>` (packaged: `process.resourcesPath`, dev: `app.getAppPath()`), falls back to system PATH with a `console.warn` if the bundled binary is missing. Dart's binary lives at `bin/dart.exe` within its SDK folder (not root-level like PHP/Node) — resolver has a Dart-specific `subDir` case for this.
Missing runtimes show a human-readable error in the Output panel, not a crash.
`resources/runtimes/` and `resources/models/` are gitignored — repopulate locally before any `electron-builder` packaging run.

## Styling Strategy
- Tailwind classes for: flex, grid, width, height, padding, margin, gap, rounded, text size, font weight, shadows, backdrop-blur
- Inline `style={{}}` for: brand hex colors and custom fonts ONLY
- CSS file for EXCEPTIONS ONLY: pseudo-elements (::before, ::after), multi-layer radial gradients, complex animations beyond keyframes

## Brand Colors
- Background: `#1a0a2e` | Panel: `#2d1b4e` | Accent: `#a855f7` | Secondary: `#7c3aed` | Text: `#ffffff` | Muted text: Tailwind `text-gray-400`

## Fonts
- Headings: Space Grotesk | Body: IBM Plex Sans | Code/Labels: Space Mono

## App.css Rules
ONLY allowed in App.css: `@import "tailwindcss"`, Google Fonts `@import`, `@import "@vscode/codicons/dist/codicon.css"` (icon font, added 2026-08-02, planned for sidebar icons), `:root` CSS variables for brand colors, body background radial gradient, pseudo-element glow effects, `@keyframes` animations.
NEVER write layout, spacing, or component styles in App.css.

## Navigation
- `useState<'splash' | 'main' | 'create' | 'editor'>` in App.tsx
- No React Router, ever
- `editorFolder` state (string | undefined) threads the opened folder from MainMenu/CreateProject → EditorLayout → Sidebar

## EditorLayout Architecture
- Top bar: ← Menu, filename, Open File, Save (when dirty), AI toggle, Run button
- Tab bar: open files, dirty indicator (●), close (✕)
- Main row: Sidebar (w-48) | Monaco Editor | HTML Preview | AI Panel (w-80, toggleable)
- Bottom: Output panel (h-200px, collapsible) — `run:output` stream, stdout green (`#86efac`), stderr red (`#f87171`)
- Run button: auto-saves before running, disabled when no file open or already running, shows "▶ Run" / "◼ Running..."

## Non-negotiable rules
- **Never launch/run/build/self-test the app** (`npm start`, opening the app, `flutter run`, etc.). Write code + report what changed — the human runs and tests locally and pastes back real terminal output.
- Verify success against actual pasted terminal output — not just `get_errors` or a clean build.
- Multi-line files: write via PowerShell here-strings (`@'...'@ | Set-Content -Encoding utf8`), not editor paste.
- PowerShell only, not Git Bash.
- No `npm install` without explicit approval.
- Tight-scope minimal diffs — don't refactor beyond what was asked.
- Always check `preload.d.ts` before adding new `window.*` calls.
- Always summarize the current file state before making changes.
- Single-model, multi-mode AI architecture (one 6.7B model, different system prompts per mode — not multiple models; 6GB VRAM can't hold two).

## Decision log
See `DECISIONS.md` in repo root for the running log of flags, resolved decisions, and deferred items. Read it before starting non-trivial work.

## Propose-first
For any non-trivial change, propose the plan/approach before writing code, especially around file locations, IPC channel names, and anything touching the runtime-resolver pattern in `src/main/main.ts`.
```

Once that's pasted in, `AGENTS.md` is safe to delete (or leave empty/deprecated with a one-line pointer to `CLAUDE.md`, your call) since everything from it now lives in one place.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
