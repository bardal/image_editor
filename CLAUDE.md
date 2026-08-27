# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Etch** - a browser-based image annotation/editing tool built as a single-file HTML application (`index.html`) with embedded CSS and JavaScript. No build tools, no framework, no npm dependencies in the app itself - the only `package.json` entry is the test runner. It's a PWA with offline support via service worker.

## Development

No build step required. Open `index.html` in a browser to run the app.

**Test:** `npm test` (or `./tests/run-all.sh`) — 26 Playwright suites driving a real Chromium against a served copy of the app, about two minutes in all. **Run the whole suite before pushing any change to `index.html`.** The same command gates the deploy in CI, so a change that fails here never reaches the site; finding that out locally costs two minutes, finding it out from CI costs a round trip.

There is a suite per area — `zoom`, `pinch`, `rotate`, `line`, `crop`, `tear`, `undo`, `persist`, `units` and the rest. To iterate on one, serve the repo (`python3 -m http.server 8080 &`) and run it alone: `node tests/zoom-test.js`. It needs a real origin, not `file://` — IndexedDB, the clipboard and the service worker are all unavailable there. A suite passes by asserting its own report, not merely by the page not throwing, so a failure means behaviour changed. `tests/README.md` explains how a suite is written and the two-unit rule (`fitPxToCanvas` vs `screenPxToCanvas`) that most visual faults here have come down to.

`npm install` first if `node_modules` is missing; web sessions get that from `.claude/hooks/session-start.sh`. The browser is found by `tests/browser.js` — Playwright's own if it has one, otherwise whatever the sandbox ships — so `CHROME_PATH` only needs setting to override that choice.

**Branch:** work on `main` and push there. Pages deploys from `main` once the
suites pass, and the phone this app is tested on loads the deployed build - so
a change parked on a side branch is a change nobody can try. Feature branches
have only ever meant pushing the same commits twice.

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

## Working on this app

Written down because the same mistakes keep recurring, and nothing carries
between sessions except this file and the tests.

**Two units, and using the wrong one is the commonest fault here.**
`fitPxToCanvas` is part of the picture — strokes, text, padding, arrowheads,
the geometry a gesture creates — and grows on screen as you zoom.
`screenPxToCanvas` is furniture — handles, hit tolerances, previews — and stays
finger-sized at any zoom. A raw number means canvas units and is nearly always
wrong: 20 of them is 2 screen pixels on a 4032px photo. Getting it backwards is
invisible at 100% and only shows on a zoomed-in phone. See `tests/README.md`.

**Write the failing test first.** Every bug fixed this way stayed fixed. Watch
it fail for the reason you think, not just fail. When a fix is subtle, put the
old code back afterwards and check the test goes red again.

**Tests assert state; faults are often visual.** A control can render as
nonsense while every assertion about its state passes — a touch rule sized the
fill switch 20x20, which turned the pill into a circle with its knob hanging
outside, and it survived weeks of green runs. So: assert the *geometry* of
custom controls (nothing painted inside a control escapes its box, a tap target
is 44px tall), and when you take a screenshot, look at it once with no question
in mind before checking the thing you meant to check.

**Fix the family, not the instance.** Every bug here has turned out to be one
of several. One wrong unit meant six. One touch override that stopped short of
44px meant five. After fixing one, grep for its shape.

**Chromium emulating an iPhone is not Safari.** The two worst faults this app
has had were Safari behaviours Chromium does not reproduce: the page-zoom on a
sub-16px focused field, and the synthesised mouse events after a tap. When a
change rests on iOS behaviour, say plainly that the suites cannot confirm it.

### External dependency
Only one: `heic2any` loaded async from unpkg CDN for HEIC/HEIF to JPEG conversion (iPhone photos).

### PWA files
- `sw.js` — service worker with network-first caching strategy
- `manifest.json` — PWA metadata (app name "Etch", standalone display mode)
