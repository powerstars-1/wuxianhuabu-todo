# Canvas Inbox

Canvas Inbox is a desktop-first AI todo workspace built with Electron, React, Vite, and Excalidraw.

The product model is:

- left side: source canvas for copied text, screenshots, and context
- right side: projected todo list generated from those sources
- interaction: hover and click link tasks back to their source cards

## Repository Structure

- `app/`: Electron desktop app, renderer, and local persistence
- `docs/product/`: PRD, MVP scope, interaction flows, and architecture notes
- `upstream/excalidraw/`: upstream Excalidraw source as a submodule reference
- `TEST_REPORT.md`: historical Windows build and interaction validation notes

## Getting Started

1. Initialize the upstream dependency:

```bash
git submodule update --init --recursive
```

2. Install app dependencies:

```bash
cd app
npm install
```

3. Run the desktop app in development mode:

```bash
npm run dev
```

## Build

From `app/`:

```bash
npm run build
npm run dist:win
```

## Key Docs

- [Product docs index](docs/product/README.md)
- [PRD](docs/product/prd-v0.1.md)
- [MVP scope and roadmap](docs/product/mvp-feature-list-and-roadmap-v0.1.md)
