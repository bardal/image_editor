const { chromium } = require('playwright');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(APP);
  await page.waitForTimeout(200);

  const r = {};
  r.coarsePointer = await page.evaluate(() => isCoarsePointer());

  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 800;
    const g = c.getContext('2d');
    g.fillStyle = '#ccddaa'; g.fillRect(0, 0, c.width, c.height);
    const image = new Image();
    await new Promise(res => { image.onload = res; image.src = c.toDataURL(); });
    img = image; resizeCanvas(); updateImageInfo();
  });
  await page.waitForTimeout(150);

  r.scaleFactor = await page.evaluate(() => {
    const b = canvas.getBoundingClientRect();
    return +(canvas.width / b.width).toFixed(2);
  });

  // Mouse drag to draw a rectangle.
  await page.evaluate(() => document.querySelector('[data-tool="rect"]').click());
  const b = await page.evaluate(() => {
    const x = canvas.getBoundingClientRect();
    return { x: x.x, y: x.y, w: x.width, h: x.height };
  });
  await page.mouse.move(b.x + b.w * 0.2, b.y + b.h * 0.2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.w * 0.6, b.y + b.h * 0.6, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  r.shapesAfterMouseDrag = await page.evaluate(() => shapes.length);

  // Mouse select + the effective stroke width in screen px.
  await page.evaluate(() => document.querySelector('[data-tool="select"]').click());
  r.strokeScreenPx = await page.evaluate(() => {
    const bb = canvas.getBoundingClientRect();
    return +(strokeWidth(3) / (canvas.width / bb.width)).toFixed(2);
  });
  r.handleScreenPx = await page.evaluate(() => {
    const bb = canvas.getBoundingClientRect();
    return +(UI.resizeHit / (canvas.width / bb.width)).toFixed(1);
  });

  // Double-click to add a label (mouse path must still work).
  const mid = await page.evaluate(() => {
    const s = shapes[0]; const bb = canvas.getBoundingClientRect();
    return {
      x: bb.x + (s.x + s.w / 2) / (canvas.width / bb.width),
      y: bb.y + (s.y + s.h / 2) / (canvas.height / bb.height),
    };
  });
  await page.mouse.dblclick(mid.x, mid.y);
  await page.waitForTimeout(150);
  r.labelEditorOpened = await page.evaluate(() =>
    document.getElementById('canvasTextInput').style.display !== 'none');

  // The label editor from the double-click above is still open; dismiss it so
  // the text-tool checks below start from a clean state.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // ---- Text tool with a real mouse ----
  // A mouse press moves focus to the document by default; if that lands after
  // the input is focused it blurs it and commits empty text instantly. Touch
  // does not behave this way, so only a mouse test catches it.
  await page.evaluate(() => document.querySelector('[data-tool="text"]').click());
  await page.waitForTimeout(150);
  const tb = await page.evaluate(() => {
    const x = canvas.getBoundingClientRect();
    return { x: x.x, y: x.y, w: x.width, h: x.height };
  });
  await page.mouse.click(tb.x + tb.w * 0.35, tb.y + tb.h * 0.35);
  await page.waitForTimeout(150);
  // Text blocks now use the multi-line editor, shared with callouts.
  r.textStaysFocusedAfterClick = await page.evaluate(() =>
    isEditingText && document.activeElement === document.getElementById('calloutTextInput'));
  await page.keyboard.type('Typed on PC');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(200);
  r.textCommitted = await page.evaluate(() =>
    shapes.filter(s => s.type === 'text').map(s => s.text));

  // Clicking existing text with the text tool must edit it, not stack a new one.
  await page.mouse.click(tb.x + tb.w * 0.35 + 20, tb.y + tb.h * 0.35 + 5);
  await page.waitForTimeout(150);
  r.reopensExistingText = await page.evaluate(() =>
    document.getElementById('calloutTextInput').value);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // Line thickness is meaningless for text; the swatch label should say so.
  r.textPropLabel = await page.evaluate(() => {
    document.querySelector('[data-tool="text"]').click();
    return {
      label: document.getElementById('lineGroupLabel').textContent,
      sliderHidden: document.getElementById('size').classList.contains('hidden'),
    };
  });
  r.rectPropLabel = await page.evaluate(() => {
    document.querySelector('[data-tool="rect"]').click();
    return {
      label: document.getElementById('lineGroupLabel').textContent,
      sliderHidden: document.getElementById('size').classList.contains('hidden'),
    };
  });

  r.pageErrors = errors.filter(e => !e.includes('ServiceWorker'));
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
