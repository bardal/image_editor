# Tests

Browser tests driven by Playwright against a real Chromium. There is no build
step for the app itself; these only need Node and Playwright.

    npm install playwright
    ./tests/run-all.sh

`run-all.sh` serves the repo over HTTP and runs every `*-test.js`. A suite passes
if it exits cleanly and reports no page errors. Override the target with
`APP_URL`, or the browser binary with `CHROME_PATH`.

The app must be served over HTTP rather than opened as a file: IndexedDB, the
clipboard and the service worker are all unavailable over `file://`, so
persistence and paste cannot be exercised there.

## Why both touch and mouse

Several bugs have only ever appeared on one of the two:

- Placing text committed instantly with a mouse but not by touch, because a
  mouse press moves focus to the document by default and blurred the input.
- Hesitating before a drag opened the context menu and lost the gesture.
- Callouts had only mouse coverage, which is why two touch faults survived.

Suites using `devices['iPhone 13']` drive real touch events through CDP;
`desktop-test.js` drives a mouse. Anything touching input should be covered by
both.

## Suites

| Suite | Covers |
| --- | --- |
| `regression` | Previously fixed faults: long press stealing a drag, a stranded block edit, Escape destroying a callout |
| `callout` / `callout-touch` | Callouts by mouse and by touch: creation, wrapping, tip and box independence, re-editing |
| `textblock` | Wrapping, growth, width handles, and that text and callouts share one implementation |
| `zoom` | Pinch zoom, pan, stroke width fixed to the image, drawing while zoomed |
| `menu` | Long-press and right-click menus, duplicate, stacking order |
| `crop` | Crop, expand, transparent margins, reset |
| `clear` | Clearing the drawing, everything, and what survives a reload |
| `persist` | Shapes, image and crop surviving a reload |
| `touch` / `keyboard` | Touch drawing, hit target sizes, the on-screen keyboard |
| `line` | Drag adds a segment, tap ends it |
| `desktop` | Mouse drawing, text entry, labels |
| `layout` | Phone layout: pinned bars, nothing unreachable, tap targets |
