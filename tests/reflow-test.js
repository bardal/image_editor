// A drawing on a blank canvas has to survive the canvas being re-sized under
// it. The canvas has no photo to take its dimensions from, so it is sized to
// the window - and the window changes constantly on a phone as the address bar
// slides away. Shape geometry is in canvas units, so unless it moves with the
// canvas the drawing jumps: this is what turned a saved callout into a column
// of one word per line after the canvas resolution changed.
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
  await page.waitForTimeout(400);
  await page.evaluate(async () => { await dbDelete('doc'); await dbDelete('image'); });
  await page.reload();
  await page.waitForTimeout(500);
  const r = {};

  // A callout whose text just fits its box, plus a rect, on a blank canvas.
  const build = () => page.evaluate(() => {
    shapes.length = 0;
    const w = canvas.width, h = canvas.height;
    shapes.push({ type: 'rect', x: w * 0.1, y: h * 0.08, w: w * 0.5, h: h * 0.12,
      rotation: 0, color: '#222', size: 4, fill: false, id: 1 });
    shapes.push({ type: 'callout', x: w * 0.1, y: h * 0.35, w: w * 0.6, h: h * 0.1,
      text: 'And redd cfr', color: '#222', size: 4, fill: true, fillColor: '#fff',
      fontSize: 16, fontFamily: 'sans-serif', fontWeight: 'normal', fontStyle: 'normal',
      textAlign: 'left', endStyle: 'closedArrow', rotation: 0,
      tipX: w * 0.5, tipY: h * 0.2, id: 2 });
    redraw();
  });

  // What the drawing looks like independently of the canvas's own dimensions:
  // where it sits as a fraction of the canvas, and how the text breaks.
  const layout = () => page.evaluate(() => {
    const c = shapes.find(s => s.type === 'callout');
    const rect = shapes.find(s => s.type === 'rect');
    const m = textBlockMetrics(c);
    return {
      canvas: [canvas.width, canvas.height],
      lines: m.lines.length,
      // The longest line as a fraction of the box, which is what "the text fits"
      // actually means. Lines come back as strings, so they are measured here.
      fillRatio: (() => {
        ctx.font = buildFont(c);
        const widest = Math.max(...m.lines.map(l => ctx.measureText(String(l)).width));
        return +(widest / c.w).toFixed(2);
      })(),
      calloutFrac: [+(c.x / canvas.width).toFixed(3), +(c.y / canvas.height).toFixed(3),
                    +(c.w / canvas.width).toFixed(3)],
      rectFrac: [+(rect.x / canvas.width).toFixed(3), +(rect.w / canvas.width).toFixed(3)],
      tipFrac: [+(c.tipX / canvas.width).toFixed(3), +(c.tipY / canvas.height).toFixed(3)],
    };
  });

  await build();
  await page.waitForTimeout(200);
  r.before = await layout();

  // The address bar sliding away: same width, less height.
  await page.setViewportSize({ width: 390, height: 560 });
  await page.waitForTimeout(400);
  r.afterHeightChange = await layout();

  // Turning the phone on its side.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  r.afterRotate = await layout();

  // ...and back again. The drawing must be where it started.
  await page.setViewportSize({ width: 390, height: 664 });
  await page.waitForTimeout(400);
  r.afterRotateBack = await layout();

  // The case actually reported: a drawing saved when the blank canvas was sized
  // in CSS pixels, reopened now that it is sized for the screen.
  await page.evaluate(async () => {
    await dbPut('doc', {
      shapes: [{
        type: 'callout', x: 40, y: 120, w: 230, h: 60, text: 'And redd cfr',
        color: '#222', size: 4, fill: true, fillColor: '#fff', fontSize: 16,
        fontFamily: 'sans-serif', fontWeight: 'normal', fontStyle: 'normal',
        textAlign: 'left', endStyle: 'closedArrow', rotation: 0,
        tipX: 200, tipY: 60, id: 7,
      }],
      imgOffset: { x: 0, y: 0 },
      canvasOverride: null,
      canvasW: 390, canvasH: 560,
      hasImage: false,
      nextShapeId: 8,
      savedAt: 1,
    });
  });
  await page.reload();
  await page.waitForTimeout(800);
  r.oldDocument = await page.evaluate(() => {
    const c = shapes.find(s => s.type === 'callout');
    if (!c) return null;
    const m = textBlockMetrics(c);
    return {
      canvas: [canvas.width, canvas.height],
      lines: m.lines.length,
      fillRatio: (() => {
        ctx.font = buildFont(c);
        const widest = Math.max(...m.lines.map(l => ctx.measureText(String(l)).width));
        return +(widest / c.w).toFixed(2);
      })(),
      widthFrac: +(c.w / canvas.width).toFixed(3),
      xFrac: +(c.x / canvas.width).toFixed(3),
    };
  });

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  finish(r, {
    // 'And redd cfr' fits on one line in a box six tenths of the canvas wide.
    'before.lines': 1,
    'before.fillRatio': v => v > 0.05 && v < 1,
    // Every re-size keeps the drawing where it was, proportionally, and keeps
    // the text breaking the same way.
    'afterHeightChange.lines': 1,
    'afterHeightChange.calloutFrac': v => JSON.stringify(v) === JSON.stringify(r.before.calloutFrac),
    'afterHeightChange.rectFrac': v => JSON.stringify(v) === JSON.stringify(r.before.rectFrac),
    'afterRotate.lines': 1,
    'afterRotate.calloutFrac': v => JSON.stringify(v) === JSON.stringify(r.before.calloutFrac),
    'afterRotate.tipFrac': v => JSON.stringify(v) === JSON.stringify(r.before.tipFrac),
    'afterRotateBack.lines': 1,
    'afterRotateBack.calloutFrac': v => JSON.stringify(v) === JSON.stringify(r.before.calloutFrac),
    'afterRotateBack.fillRatio': v => Math.abs(v - r.before.fillRatio) < 0.05,
    // The reported fault: the box kept its old width while the text grew to
    // suit the new canvas, so every word landed on a line of its own.
    'oldDocument.lines': 1,
    'oldDocument.widthFrac': near(230 / 390, 0.02),
    'oldDocument.xFrac': near(40 / 390, 0.02),
    // Brought up to this screen's resolution on open, rather than left soft
    // until something happened to resize it.
    'oldDocument.canvas': v => Array.isArray(v) && v[0] > 390,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
