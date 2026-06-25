# Fabrica IDE — Agent Instructions

## Stack
- Electron + React + TypeScript (ERB boilerplate)
- Tailwind v4 (@import "tailwindcss" in App.css)
- PostCSS + postcss-loader wired into webpack (already configured)
- One Electron window — no multi-window setup
- Monaco Editor for code editing
- Ollama (deepseek-coder:6.7b) for offline AI via localhost:11434

## File Structure
- `src/main/main.ts` — Electron main process + all IPC handlers
- `src/main/preload.ts` — contextBridge surface (what renderer can call)
- `src/renderer/preload.d.ts` — TypeScript types for all window.* bridges
- `src/renderer/App.tsx` — navigation controller + SplashScreen +
  MainMenu + CreateProject components + useRecentProjects hook
- `src/renderer/screens/EditorLayout.tsx` — full editor screen
- `src/renderer/components/editor/Editor.tsx` — Monaco wrapper
- `src/renderer/components/sidebar/Sidebar.tsx` — file tree
- `src/renderer/components/preview/Preview.tsx` — HTML iframe preview
- `src/renderer/components/ai/AIPanel.tsx` — AI translate/explain panel
- `src/renderer/types/index.ts` — shared TypeScript types (Tab, FileEntry)

## IPC Bridge API (window.*)
Always use these bridges — never call Node/Electron APIs directly from
the renderer. Check preload.d.ts for the full type signatures before use.

- `window.fileSystem` — readFile, writeFile, readDir, createFile,
  createFolder, openFolder (dialog), openFile (dialog), openTerminal
- `window.store` — getRecentProjects, addRecentProject (JSON persistence
  in app.getPath('userData')/recent-projects.json, max 5, newest first)
- `window.runner` — run(filePath), onOutput(cb), onDone(cb),
  removeListeners() — spawns language runtimes via child_process
- `window.ai` — complete(prompt) — calls Ollama, streams via ai:token events
- `window.electron.ipcRenderer` — raw IPC, used only for event listeners
  (ai:token, run:output, run:done)

## Language Execution (extension-based, no project type selector)
Run routing is purely by file extension in main.ts getRunConfig():
- `.html` → iframe preview (no spawn)
- `.php` → `php -f <file>`
- `.js` / `.ts` → `node <file>`
- `.cs` → `dotnet run` (shows install prompt if SDK missing)
- `.dart` → `dart run <file>` (shows install prompt if SDK missing)
Missing runtimes show a human-readable error in the Output panel, not a crash.

## Styling Strategy
- Tailwind classes for: flex, grid, width, height, padding, margin,
  gap, rounded, text size, font weight, shadows, backdrop-blur
- Inline style={{}} for: brand hex colors and custom fonts ONLY
- CSS file for EXCEPTIONS ONLY:
  - Pseudo-elements (::before, ::after)
  - Multi-layer radial gradients
  - Complex animations beyond keyframes

## Brand Colors
- Background: #1a0a2e
- Panel: #2d1b4e
- Accent: #a855f7
- Secondary: #7c3aed
- Text: #ffffff
- Muted text: use Tailwind text-gray-400

## Fonts
- Headings: Space Grotesk
- Body: IBM Plex Sans
- Code/Labels: Space Mono

## App.css Rules
ONLY allowed in App.css:
1. @import "tailwindcss"
2. Google Fonts @import
3. :root CSS variables for brand colors
4. body background radial gradient
5. Pseudo-element glow effects (::before, ::after)
6. @keyframes animations
NEVER write layout, spacing, or component styles in App.css.
Global body/reset styles are the only exception.

## Navigation
- useState<'splash' | 'main' | 'create' | 'editor'> in App.tsx
- Never use React Router
- Never add new npm packages without asking first
- editorFolder state (string | undefined) threads the opened folder
  from MainMenu/CreateProject down into EditorLayout → Sidebar

## Key Hooks
- `useRecentProjects()` in App.tsx — returns { recentProjects, load, add }
  wrapping window.store calls; used in App() component

## EditorLayout Architecture
- Top bar: ← Menu, filename, Open File, Save (when dirty), AI toggle, Run button
- Tab bar: open files, dirty indicator (●), close (✕)
- Main row: Sidebar (w-48) | Monaco Editor | HTML Preview | AI Panel (w-80, toggleable)
- Bottom: Output panel (h-200px, collapsible) — shows run:output stream,
  stdout in green (#86efac), stderr in red (#f87171)
- Run button: auto-saves before running, disabled when no file open or
  already running, shows "▶ Run" / "◼ Running..."

## Rules
- Never create separate Electron windows
- Never add npm packages without asking
- Always check preload.d.ts before adding new window.* calls
- Always summarize the current file state before making changes
- No React Router
- Tailwind for layout, inline styles for brand colors only