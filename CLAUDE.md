# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Etch** - a browser-based image annotation/editing tool built as a single-file HTML application (`index.html`) with embedded CSS and JavaScript. No build tools, no framework, no npm dependencies in the app itself - the only `package.json` entry is the test runner. It's a PWA with offline support via service worker.

## Development

No build step required. Open `index.html` in a browser to run the app.

**Test:** `npm test` (or `./tests/run-all.sh`) — 26 Playwright suites driving a real Chromium against a served copy of the app, about two minutes in all. **Run the whole suite before pushing any change to `index.html`.** The same command gates the deploy in CI, so a change that fails here never reaches the site; finding that out locally costs two minutes, finding it out from CI costs a round trip.

There is a suite per area — `zoom`, `pinch`, `rotate`, `line`, `crop`, `tear`, `undo`, `persist`, `units` and the rest. To iterate on one, serve the repo (`python3 -m http.server 8080 &`) and run it alone: `node tests/zoom-test.js`. It needs a real origin, not `file://` — IndexedDB, the clipboard and the service worker are all unavailable there. A suite passes by asserting its own report, not merely by the page not throwing, so a failure means behaviour changed. `tests/README.md` explains how a suite is written and the two-unit rule (`fitPxToCanvas` vs `screenPxToCanvas`) that most visual faults here have come down to.

`npm install` first if `node_modules` is missing; web sessions get that from `.claude/hooks/session-start.sh`. The browser is found by `tests/browser.js` — Playwright's own if it has one, otherwise whatever the sandbox ships — so `CHROME_PATH` only needs setting to override that choice.

**Deploy:** `./deploy.sh` — deploys via SSH (default) or FTP to barney.daltons.net/image_editor. Requires `.env` with `DEPLOY_USER` (see `.env.example`). CI publishes to GitHub Pages from `main` once the suites pass (`.github/workflows/pages.yml`).

## Architecture

### Single-file structure (`index.html`, ~1,900 lines)

The entire app lives in one file with three sections:
1. **HTML + CSS** (lines 1–513): Toolbar, canvas container, status bar, modal dialogs. CSS uses dark theme with `#1a1a1e` / `#252528` palette and `#3b8eed` accent.
2. **JavaScript** (line 515+): All application logic in a single `<script>` tag.

### Key global state variables
- `img` — loaded image; `shapes` — array of all drawn shapes; `selectedShape` — current selection
- `tool` — active tool: `'select'`, `'rect'`, `'ellipse'`, `'arrow'`, `'polyline'`, `'text'`, `'callout'`, `'crop'`, `'tear'`
- `tear` — which page edges are torn, how deep, and the seed the rip is generated from
- `color`, `size`, `fillDefault` — drawing properties
- `drawing`, `isDragging`, `isRotating`, `isResizing` — interaction state flags
- `canvasScale` — DPI adjustment factor for coordinate conversion

### Shape model
Each shape is a plain object with `type`, position/size fields, `color`, `size`, `rotation`, and type-specific properties (e.g., `points` for polyline, `text`/`fontSize` for text). Shapes are stored in the `shapes` array and rendered sequentially by `redraw()`.

### Core patterns
- **Coordinate conversion**: All mouse events go through `screenToCanvas()` to handle DPI scaling and canvas offset.
- **Hit detection**: `isPointInShape()` dispatches by shape type. Overlapping shapes are cycled on repeated clicks via `getAllShapesAtPoint()`.
- **Selection UI**: Selected shapes get green dashed borders, a rotation handle (green circle), and resize handles (corner squares for rect/ellipse).
- **Undo**: Stack-based — each entry is a deep copy of `{ shapes, tear }`, so tearing an edge is a step like any other. No redo.
- **Canvas redraw**: `redraw()` clears canvas, draws the base image, then iterates all shapes. Called after every state change.
- **Torn page**: `tearPaths()` builds the ragged page outline from a seeded noise function (`tearRandom`/`tearSample`), cached against the canvas size and settings. `redraw()` clips the picture to it, so the strip a tear takes is cleared rather than painted — an export keeps the alpha. Depth is in `fitPx`, like stroke widths.

### External dependency
Only one: `heic2any` loaded async from unpkg CDN for HEIC/HEIF to JPEG conversion (iPhone photos).

### PWA files
- `sw.js` — service worker with network-first caching strategy
- `manifest.json` — PWA metadata (app name "Etch", standalone display mode)
