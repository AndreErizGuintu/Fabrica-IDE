# Fabrica IDE

Fabrica IDE is an offline-first desktop development environment built with Electron, React, and TypeScript.

## Features

- Monaco-based code editing with tabs and file navigation
- Folder and file explorer with project file management
- Integrated terminal
- Live HTML/CSS preview
- Flutter project controls and Android APK build support
- AI assistant and code inference tools
- C#, PHP, and deprecated API diagnostics
- Source control panel
- Statistics dashboard and configurable app themes

## Tech Stack

- Electron
- React 19
- TypeScript
- Monaco Editor
- Tailwind CSS
- Webpack
- Xterm
- Node.js

## Setup

Prerequisites:

- Node.js
- npm
- A compatible local development environment for projects you want to run

Install dependencies:

```bash
npm install
```

Start the application:

```bash
npm start
```

Build the application:

```bash
npm run build
```

Package the desktop application:

```bash
npm run package
```

## Project Structure

- `src/main` - Electron main process and native integrations
- `src/renderer` - React application
- `src/renderer/components` - Reusable UI components
- `src/renderer/screens` - Application screens
- `src/__tests__` - Jest tests
- `assets` - Application assets

## Screenshots

Screenshots placeholder: add application screenshots here.

## Contributing

Open issues or submit pull requests. Keep changes focused and follow the conventions in `AGENTS.md`.

## License

See [LICENSE](LICENSE).
