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
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
