const { chromium, devices } = require('playwright');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');

const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

async function main() {
  const browser = await chromium.launch({ executablePath: require('./browser').path() });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(APP);
  await page.waitForTimeout(300);

  const results = {};

  // The app must agree it is on a coarse pointer, or none of the touch sizing applies.
  results.coarsePointer = await page.evaluate(() => isCoarsePointer());

  // Load a large image, mimicking an iPhone photo, so canvas units are ~10x screen px.
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 4032; c.height = 3024;
    const g = c.getContext('2d');
    g.fillStyle = '#88aacc'; g.fillRect(0, 0, c.width, c.height);
    const image = new Image();
    await new Promise(r => { image.onload = r; image.src = c.toDataURL(); });
    img = image;
    resizeCanvas();
    updateImageInfo();
  });
  await page.waitForTimeout(200);

  results.canvasSize = await page.evaluate(() => [canvas.width, canvas.height]);
  results.displayedSize = await page.evaluate(() => {
    const r = canvas.getBoundingClientRect();
    return [Math.round(r.width), Math.round(r.height)];
  });
  results.scaleFactor = await page.evaluate(() => {
    const r = canvas.getBoundingClientRect();
    return +(canvas.width / r.width).toFixed(1);
  });

  // Handle sizes, expressed back in SCREEN pixels - this is what a finger sees.
  results.handleScreenPx = await page.evaluate(() => {
    const r = canvas.getBoundingClientRect();
    const toScreen = v => +(v / (canvas.width / r.width)).toFixed(1);
    return {
      resizeHitRadius: toScreen(UI.resizeHit),
      rotationHitRadius: toScreen(UI.rotationHit),
      resizeDotRadius: toScreen(UI.resizeRadius),
      dragThreshold: toScreen(dragThreshold()),
      lineGrabWidth: toScreen(lineGrabWidth()),
    };
  });

  // ---- Touch-drag to draw a rectangle ----
  await page.evaluate(() => {
    document.querySelector('[data-tool="rect"]').click();
  });

  const box = await page.evaluate(() => {
    const r = canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  const cdp = await context.newCDPSession(page);
  const x1 = box.x + box.w * 0.25, y1 = box.y + box.h * 0.3;
  const x2 = box.x + box.w * 0.7,  y2 = box.y + box.h * 0.65;

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x1 + (x2 - x1) * i / 6, y: y1 + (y2 - y1) * i / 6 }],
    });
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(150);

  results.shapesAfterTouchDrag = await page.evaluate(() => shapes.length);
  results.shapeDrawn = await page.evaluate(() =>
    shapes.length ? { type: shapes[0].type, w: Math.round(shapes[0].w), h: Math.round(shapes[0].h) } : null);

  // ---- Did the page scroll/zoom instead of drawing? ----
  results.pageScrolled = await page.evaluate(() => window.scrollY !== 0 || window.scrollX !== 0);

  // ---- Tap to select the shape with the select tool ----
  await page.evaluate(() => document.querySelector('[data-tool="select"]').click());
  const mid = await page.evaluate(() => {
    const s = shapes[0];
    const r = canvas.getBoundingClientRect();
    const sx = r.x + (s.x + s.w / 2) / (canvas.width / r.width);
    const sy = r.y + (s.y + s.h / 2) / (canvas.height / r.height);
    return { x: sx, y: sy };
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mid.x, y: mid.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(150);
  results.selectedAfterTap = await page.evaluate(() => selectedShape !== null);

  // A tap must not be misread as a drag that moves the shape.
  results.shapeMovedByTap = await page.evaluate(() => window.__moved === true);

  // ---- Toolbar tap target sizes ----
  results.toolbarTargets = await page.evaluate(() => {
    const out = {};
    for (const sel of ['#openFile', '#copyImage', '[data-tool="rect"]']) {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      out[sel] = [Math.round(r.width), Math.round(r.height)];
    }
    return out;
  });

  results.toolbarFitsWidth = await page.evaluate(() =>
    document.querySelector('.toolbar').scrollWidth <= window.innerWidth + 1);
  results.bodyOverflowsX = await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth + 1);

  results.pageErrors = errors;

  await page.screenshot({ path: 'iphone.png' });

  finish(results, {
    'coarsePointer': isTrue,
    // Hit targets are defined in canvas units; on a 4032px photo shown at 390px
    // they collapse to a fraction of a screen pixel without the scaling.
    'scaleFactor': atLeast(5),
    'handleScreenPx.resizeHitRadius': atLeast(16),
    'handleScreenPx.rotationHitRadius': atLeast(16),
    'handleScreenPx.resizeDotRadius': atLeast(7),
    'shapesAfterTouchDrag': 1,
    'shapeDrawn.type': 'rect',
    'pageScrolled': isFalse,
    'selectedAfterTap': isTrue,
    'shapeMovedByTap': isFalse,
    'toolbarFitsWidth': isTrue,
    'bodyOverflowsX': isFalse,
  });
  await browser.close();
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
