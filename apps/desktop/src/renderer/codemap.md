# apps/desktop/src/renderer/

Renderer process bundle for the Electron desktop app.

## Responsibility

Contains the frontend build configuration and entry points for the Chromium renderer process.

## Design

- **Build Tool**: Vite for development and production builds
- **Framework**: React 19 with TypeScript
- **Styling**: CSS with CSS custom properties for dynamic theming
- **Security**: Sandboxed renderer with no direct Node.js access

## Flow

1. Vite dev server serves React app in development (port 5173)
2. Production build outputs to `dist/renderer/` as static files
3. Main process loads `index.html` which bootstraps the React app

## Integration

- **Main Process**: Communicates via preload script exposed API (`window.openPets`)
- **State Source**: Receives pet state (sprite, animation, speech) from main process
- **User Input**: Pointer events captured and sent to main for drag handling
