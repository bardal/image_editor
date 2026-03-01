# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browser-based image annotation/editing tool built as a single-file HTML application (`index.html`) with embedded CSS and JavaScript. No build tools, no framework, no npm dependencies. It's a PWA with offline support via service worker.

## Development

No build step required. Open `index.html` in a browser to run the app.

**Deploy:** `./deploy.sh` — deploys via SSH (default) or FTP to barney.daltons.net/image_editor. Requires `.env` with `DEPLOY_USER` (see `.env.example`).

## Architecture

### Single-file structure (`index.html`, ~1,900 lines)

The entire app lives in one file with three sections:
1. **HTML + CSS** (lines 1–513): Toolbar, canvas container, status bar, modal dialogs. CSS uses dark theme with `#1a1a1e` / `#252528` palette and `#3b8eed` accent.
2. **JavaScript** (line 515+): All application logic in a single `<script>` tag.

### Key global state variables
- `img` — loaded image; `shapes` — array of all drawn shapes; `selectedShape` — current selection
- `tool` — active tool: `'select'`, `'rect'`, `'ellipse'`, `'arrow'`, `'polyline'`, `'text'`
- `color`, `size`, `fillDefault` — drawing properties
- `drawing`, `isDragging`, `isRotating`, `isResizing` — interaction state flags
- `canvasScale` — DPI adjustment factor for coordinate conversion

### Shape model
Each shape is a plain object with `type`, position/size fields, `color`, `size`, `rotation`, and type-specific properties (e.g., `points` for polyline, `text`/`fontSize` for text). Shapes are stored in the `shapes` array and rendered sequentially by `redraw()`.

### Core patterns
- **Coordinate conversion**: All mouse events go through `screenToCanvas()` to handle DPI scaling and canvas offset.
- **Hit detection**: `isPointInShape()` dispatches by shape type. Overlapping shapes are cycled on repeated clicks via `getAllShapesAtPoint()`.
- **Selection UI**: Selected shapes get green dashed borders, a rotation handle (green circle), and resize handles (corner squares for rect/ellipse).
- **Undo**: Stack-based — stores deep copies of shape state. No redo.
- **Canvas redraw**: `redraw()` clears canvas, draws the base image, then iterates all shapes. Called after every state change.

### External dependency
Only one: `heic2any` loaded async from unpkg CDN for HEIC/HEIF to JPEG conversion (iPhone photos).

### PWA files
- `sw.js` — service worker with network-first caching strategy
- `manifest.json` — PWA metadata (app name "Image Editor", standalone display mode)
