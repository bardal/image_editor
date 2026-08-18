// Four separate faults in one week were the same mistake: a size expressed in
// the wrong unit. There are two, and which one is right depends on what the
// size is for.
//
//   fitPxToCanvas    - part of the picture. Fixed against the image, so it
//                      grows on screen as you zoom, like everything else in
//                      the drawing. Stroke widths, text, padding, arrowheads.
//   screenPxToCanvas - something you touch or something drawn over the
//                      picture. Fixed on the glass, so it stays finger-sized
//                      whatever the zoom. Handles, hit tolerances, the crop
//                      frame, previews.
//
// Getting it backwards is invisible at 100% and only shows up zoomed in, which
// is why these kept reaching a phone. This suite pins the ones that are part
// of the picture.
const { chromium, devices } = require('playwright');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(APP);
  await page.waitForTimeout(400);
  await page.evaluate(async () => { await dbDelete('doc'); await dbDelete('image'); });
  await page.reload();
  await page.waitForTimeout(500);
  const cdp = await ctx.newCDPSession(page);
  const r = {};

  await page.evaluate(async () => {
    const cv = document.createElement('canvas');
    cv.width = 2400; cv.height = 1800;
    const g = cv.getContext('2d'); g.fillStyle = '#39618c'; g.fillRect(0, 0, cv.width, cv.height);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    await processImageFile(new File([blob], 'photo.png', { type: 'image/png' }));
  });
  await page.waitForTimeout(700);

  const addCallout = () => page.evaluate(() => {
    shapes.length = 0;
    selectedShape = null;
    shapes.push({ type: 'callout', x: 200, y: 200, w: 900, h: 200,
      text: 'Cracked render below the sill', color: '#c0392b', size: 4,
      fill: true, fillColor: '#ffffff', fontSize: 16, fontFamily: 'sans-serif',
      fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left',
      endStyle: 'closedArrow', rotation: 0, tipX: 1400, tipY: 900, id: 1 });
    redraw();
  });

  // Every size that belongs to the drawing, against the text it sits with. If
  // any of these are in screen pixels the ratio changes with the zoom.
  const pictureSizes = () => page.evaluate(() => {
    const s = shapes[0];
    const text = textHeightOf(s);
    return {
      paddingPerText: +(blockPadding(s) / text).toFixed(3),
      strokePerText: +(strokeWidth(s.size) / text).toFixed(3),
      cornerPerText: +(calloutCornerRadius(s) / text).toFixed(3),
    };
  });

  await addCallout();
  await page.waitForTimeout(200);
  r.atFit = await pictureSizes();
  await page.evaluate(() => setZoom(4, canvas.getBoundingClientRect().left + 30,
                                      canvas.getBoundingClientRect().top + 30));
  await page.waitForTimeout(250);
  r.at4x = await pictureSizes();
  await page.evaluate(() => resetZoom());
  await page.waitForTimeout(200);

  r.heldAcrossZoom = {
    padding: Math.abs(r.atFit.paddingPerText - r.at4x.paddingPerText) < 0.01,
    stroke: Math.abs(r.atFit.strokePerText - r.at4x.strokePerText) < 0.01,
  };

  // The text has to sit inside its box at any zoom. With the padding in screen
  // pixels it collapses as you zoom in and the words run to the border.
  const textInset = () => page.evaluate(() => {
    const s = shapes[0];
    ctx.font = buildFont(s);
    const m = textBlockMetrics(s);
    const widest = Math.max(...m.lines.map(l => ctx.measureText(String(l)).width));
    return {
      gapPerText: +((s.w - widest) / textHeightOf(s)).toFixed(3),
      fitsInBox: widest <= s.w,
    };
  });
  r.insetAtFit = await textInset();
  await page.evaluate(() => setZoom(4, canvas.getBoundingClientRect().left + 30,
                                      canvas.getBoundingClientRect().top + 30));
  await page.waitForTimeout(250);
  r.insetAt4x = await textInset();
  await page.evaluate(() => resetZoom());
  await page.waitForTimeout(200);

  // ---- Shapes created while zoomed in ----
  // Their geometry is stored in canvas units, so a default width in screen
  // pixels bakes the zoom into the shape: the same tap makes a box a quarter
  // the size at 4x, and it stays that size when you zoom back out.
  const box = await page.evaluate(() => {
    const b = canvas.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const tapNew = async (tool, at) => {
    await page.evaluate(t => { shapes.length = 0; selectedShape = null;
      document.querySelector(`[data-tool="${t}"]`).click(); }, tool);
    await page.waitForTimeout(150);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(350);
    const made = await page.evaluate(() => {
      const s = shapes[0];
      if (!s) return null;
      const out = { type: s.type, w: Math.round(s.w), h: Math.round(s.h) };
      if (typeof s.tipX === 'number') {
        out.reach = Math.round(Math.hypot(s.tipX - (s.x + s.w / 2), s.tipY - (s.y + s.h / 2)));
      }
      return out;
    });
    await page.evaluate(() => { if (editingBlock) finishBlockEditing(true); });
    await page.waitForTimeout(150);
    return made;
  };

  const spot = { x: box.x + box.w * 0.3, y: box.y + box.h * 0.4 };
  r.calloutAtFit = await tapNew('callout', spot);
  await page.evaluate(() => setZoom(4, canvas.getBoundingClientRect().left + 30,
                                      canvas.getBoundingClientRect().top + 30));
  await page.waitForTimeout(250);
  r.calloutAt4x = await tapNew('callout', spot);
  await page.evaluate(() => resetZoom());
  await page.waitForTimeout(200);

  r.textAtFit = await tapNew('text', spot);
  await page.evaluate(() => setZoom(4, canvas.getBoundingClientRect().left + 30,
                                      canvas.getBoundingClientRect().top + 30));
  await page.waitForTimeout(250);
  r.textAt4x = await tapNew('text', spot);
  await page.evaluate(() => resetZoom());

  // ---- The label editor ----
  // The other editor on the canvas, and it had the same two faults the block
  // editor was fixed for: a floor below the 16px at which iOS force-zooms the
  // whole page, and a size unrelated to the label it is editing.
  await page.evaluate(() => {
    shapes.length = 0;
    shapes.push({ type: 'rect', x: 300, y: 300, w: 900, h: 500, rotation: 0,
      color: '#c0392b', size: 3, fill: false, label: 'Valve', id: 5 });
    document.querySelector('[data-tool="select"]').click();
    selectedShape = shapes[0]; redraw(); updateButtonStates();
    startLabelEditing(shapes[0]);
  });
  await page.waitForTimeout(250);
  r.labelEditor = await page.evaluate(() => {
    const el = document.getElementById('canvasTextInput');
    const px = parseFloat(getComputedStyle(el).fontSize);
    const b = canvas.getBoundingClientRect();
    // What the label is actually drawn at, in screen pixels.
    const drawnPx = textHeightOf(shapes[0]) * (b.width / canvas.width);
    return {
      px: +px.toFixed(2),
      iosWouldZoomPage: px < 16,
      drawnPx: +drawnPx.toFixed(2),
      // Editing at the size it will be, give or take the 16px floor.
      matchesDrawn: Math.abs(px - Math.max(16, drawnPx)) < 1,
    };
  });
  await page.evaluate(() => finishLabelEditing());
  await page.waitForTimeout(150);

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  finish(r, {
    // Padding and stroke keep their proportion to the text at any zoom.
    'heldAcrossZoom.padding': isTrue,
    'heldAcrossZoom.stroke': isTrue,
    'at4x.cornerPerText': v => Math.abs(v - r.atFit.cornerPerText) < 0.01,
    'insetAtFit.fitsInBox': isTrue,
    'insetAt4x.fitsInBox': isTrue,
    'insetAt4x.gapPerText': v => Math.abs(v - r.insetAtFit.gapPerText) < 0.02,
    // A tap makes the same shape whatever the zoom happened to be.
    'calloutAt4x.w': v => Math.abs(v - r.calloutAtFit.w) <= 2,
    'calloutAt4x.h': v => Math.abs(v - r.calloutAtFit.h) <= 2,
    // The box grows to fit its text after the tip has been placed, so this is
    // measured from a centre that has since moved by half that growth. A couple
    // of per cent, not the fourfold difference the screen-pixel default gave.
    'calloutAt4x.reach': v => Math.abs(v - r.calloutAtFit.reach) <= 20,
    'textAt4x.w': v => Math.abs(v - r.textAtFit.w) <= 2,
    'labelEditor.iosWouldZoomPage': isFalse,
    'labelEditor.matchesDrawn': isTrue,
    'errors': isEmpty,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
