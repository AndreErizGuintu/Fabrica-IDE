Fabrica IDE
===========

Offline-first desktop IDE built with Electron, React, and TypeScript. This README focuses on current progress, support notes, and how to run the app.

Status
------
Active development.

Progress Snapshot
-----------------
Completed
- Editor shell with top bar and tab strip
- Sidebar file explorer with folder open and file list
- Inline new file creation in sidebar
- Monaco editor integration
- Live preview panel for HTML/CSS with auto-refresh
- Basic file open/save via IPC

In Progress
- Editor navigation polish
- Project creation flow wiring
- Preview and editor synchronization improvements

Planned
- Recent projects persistence
- Project templates
- Git integration
- Pop assistant panel

Support Notes
-------------
- The app is a single-window Electron shell.
- Frontend styling uses Tailwind; only exceptions go in component CSS files.
- Main process IPC handles file system access.

Run Locally
-----------
Prereqs: Node.js and npm.

Install
```
npm install
```

Start
```
npm start
```

Build
```
npm run build
```

Project Structure
-----------------
- src/main: Electron main process
- src/renderer: React UI
- src/renderer/components: Reusable UI pieces
- src/renderer/screens: Screen-level layouts
- assets: App assets

Contributing
------------
Open issues or submit pull requests. Keep changes focused and follow the styling conventions in AGENTS.md.

License
-------
See LICENSE.
