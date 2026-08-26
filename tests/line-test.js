const { chromium, devices } = require('playwright');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

(async () => {
  const browser = await chromium.launch({ executablePath: require('./browser').path() });
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(APP);
  await page.waitForTimeout(300);

  const cdp = await ctx.newCDPSession(page);
  const box = await page.evaluate(() => {
    const r = canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const P = (fx, fy) => ({ x: box.x + box.w * fx, y: box.y + box.h * fy });

  const tap = async (p) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(120);
  };
  const drag = async (from, to) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x + (to.x - from.x) * i / 5, y: from.y + (to.y - from.y) * i / 5 }],
      });
      await page.waitForTimeout(15);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(120);
  };
  const state = () => page.evaluate(() => ({
    drawing: isDrawingPolyline,
    pending: polylinePoints.length,
    committed: shapes.filter(s => s.type === 'polyline').length,
    lastPts: shapes.filter(s => s.type === 'polyline').slice(-1).map(s => s.points.length)[0] || 0,
    closed: shapes.filter(s => s.type === 'polyline').slice(-1).map(s => !!s.closed)[0] || false,
  }));

  await page.evaluate(() => document.querySelector('[data-tool="polyline"]').click());
  await page.waitForTimeout(150);

  const r = {};
  await tap(P(0.2, 0.2));
  r.afterStartTap = await state();

  await drag(P(0.2, 0.2), P(0.6, 0.3));
  r.afterFirstDrag = await state();

  await drag(P(0.6, 0.3), P(0.7, 0.6));
  r.afterSecondDrag = await state();

  // A plain tap well away from the last point must end the line.
  await tap(P(0.3, 0.8));
  r.afterEndingTap = await state();

  // A fresh line must be startable straight afterwards (not swallowed as a double tap).
  await tap(P(0.15, 0.5));
  await drag(P(0.15, 0.5), P(0.45, 0.55));
  r.afterSecondLineDrag = await state();
  await tap(P(0.8, 0.85));
  r.afterSecondLineEnd = await state();

  // ---- Undo in the middle of a line ----
  // Reported: draw a line, undo it, draw another, and the undone one is back -
  // joined onto the new one. A drag leaves the line open, waiting for the tap
  // that ends it, so undo lands while the gesture is still running. Undo went
  // to the stack, took back the shape before it, and left the half-drawn line
  // in hand for the next press to carry on from.
  await page.evaluate(() => { shapes.length = 0; undoStack.length = 0;
                              selectedShape = null; redraw(); updateButtonStates(); });
  await page.waitForTimeout(150);
  // Measured again here: the property bar takes a different number of rows for
  // different tools, so the canvas is not where it was at the top of the file.
  const box2 = await page.evaluate(() => {
    const b = canvas.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const Q = (fx, fy) => ({ x: box2.x + box2.w * fx, y: box2.y + box2.h * fy });
  // One finished line to sit behind the open one, so it is clear which of the
  // two undo takes back.
  await drag(Q(0.2, 0.15), Q(0.5, 0.18));
  await tap(Q(0.75, 0.25));
  await drag(Q(0.2, 0.25), Q(0.55, 0.3));
  r.openLineBeforeUndo = await state();
  r.undoOfferedMidLine = await page.evaluate(() =>
    !document.getElementById('undo').disabled);
  await page.evaluate(() => undoLastAction());
  await page.waitForTimeout(200);
  r.afterUndoMidLine = await state();

  await drag(Q(0.25, 0.7), Q(0.6, 0.75));
  await tap(Q(0.8, 0.9));
  r.lineAfterUndo = await state();

  // And the whole thing again with a line that was finished first, which is
  // the way the report was worded.
  await page.evaluate(() => { shapes.length = 0; undoStack.length = 0;
                              selectedShape = null; redraw(); updateButtonStates(); });
  await page.waitForTimeout(150);
  await drag(Q(0.2, 0.2), Q(0.5, 0.25));
  await tap(Q(0.75, 0.4));
  const madeOne = await state();
  await page.evaluate(() => undoLastAction());
  await page.waitForTimeout(200);
  await drag(Q(0.2, 0.6), Q(0.5, 0.65));
  await tap(Q(0.75, 0.8));
  r.finishedThenUndone = { madeOne: madeOne.committed, ...(await state()) };

  // ---- Undo takes back one segment, not the whole line ----
  // A line is drawn a segment at a time, so undo works the same way: the last
  // segment goes, the rest of the line stays in hand and can be carried on.
  // Only when there is nothing left of it does undo move on to the stack.
  await page.evaluate(() => { shapes.length = 0; undoStack.length = 0;
                              selectedShape = null; redraw(); updateButtonStates(); });
  await page.waitForTimeout(150);
  await drag(Q(0.15, 0.2), Q(0.4, 0.25));
  await tap(Q(0.7, 0.35));
  const behind = await state();
  await drag(Q(0.15, 0.5), Q(0.4, 0.55));
  await drag(Q(0.4, 0.55), Q(0.6, 0.7));
  await drag(Q(0.6, 0.7), Q(0.8, 0.55));
  r.threeSegments = await state();
  const undo = async () => { await page.evaluate(() => undoLastAction());
                             await page.waitForTimeout(150); return state(); };
  r.backOne = await undo();
  r.backTwo = await undo();
  // Nothing but the point it started from now; the next takes the line away.
  r.backToStart = await undo();
  r.lineGone = await undo();
  // Only now does it reach the finished line behind it.
  r.thenTheStack = await undo();
  r.behindCommitted = behind.committed;

  // What is left in hand after taking a segment back must still be a line you
  // can carry on drawing, not a stub that starts a new one.
  await page.evaluate(() => { shapes.length = 0; undoStack.length = 0;
                              selectedShape = null; redraw(); updateButtonStates(); });
  await page.waitForTimeout(150);
  await drag(Q(0.2, 0.3), Q(0.45, 0.35));
  await drag(Q(0.45, 0.35), Q(0.65, 0.5));
  await page.evaluate(() => undoLastAction());
  await page.waitForTimeout(150);
  await drag(Q(0.45, 0.35), Q(0.7, 0.3));
  await tap(Q(0.85, 0.2));
  r.carriedOn = await state();

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  finish(r, {
    'afterStartTap.drawing': isFalse,
    'afterFirstDrag.drawing': isTrue,
    'afterFirstDrag.pending': 2,
    'afterSecondDrag.pending': 3,
    'afterEndingTap.drawing': isFalse,
    'afterEndingTap.committed': 1,
    'afterEndingTap.lastPts': 3,
    'afterSecondLineDrag.drawing': isTrue,
    'afterSecondLineEnd.committed': 2,
    'afterSecondLineEnd.lastPts': 2,
    'openLineBeforeUndo.drawing': isTrue,
    // Undo takes the half-drawn line out of your hand as well as off the page.
    'undoOfferedMidLine': isTrue,
    // One segment of the open line goes; what is left stays in hand.
    'afterUndoMidLine.drawing': isTrue,
    'afterUndoMidLine.pending': 1,
    // It took back part of the line in hand, not the finished one behind it.
    'afterUndoMidLine.committed': 1,
    'lineAfterUndo.committed': 2,
    // Two points: the new line only, not the undone one joined onto it.
    'lineAfterUndo.lastPts': 2,
    'finishedThenUndone.madeOne': 1,
    'finishedThenUndone.committed': 1,
    'finishedThenUndone.lastPts': 2,
    'behindCommitted': 1,
    'threeSegments.pending': 4,
    'backOne.pending': 3,
    'backOne.drawing': isTrue,
    'backTwo.pending': 2,
    'backToStart.pending': 1,
    'backToStart.drawing': isTrue,
    'lineGone.drawing': isFalse,
    'lineGone.pending': 0,
    // The finished line behind it is still there until one more undo.
    'lineGone.committed': 1,
    'thenTheStack.committed': 0,
    'carriedOn.committed': 1,
    'carriedOn.lastPts': 3,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
