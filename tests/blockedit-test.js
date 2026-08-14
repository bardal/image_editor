// Editing a text block on a phone. Three faults made this unusable on iOS:
// the editor's font size was computed in canvas units, so on a 4032px photo it
// came out at ~2px and Safari force-zoomed the whole page; there was no visible
// way to end the edit; and tapping away created another callout instead of
// committing the one being typed.
const { chromium, devices } = require('playwright');
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
  await page.waitForTimeout(400);
  const cdp = await ctx.newCDPSession(page);
  const r = {};

  // A real phone photo, where the unit mix-up bit hardest.
  await page.evaluate(async () => {
    const cv = document.createElement('canvas');
    cv.width = 4032; cv.height = 3024;
    const g = cv.getContext('2d');
    g.fillStyle = '#889'; g.fillRect(0, 0, cv.width, cv.height);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    await processImageFile(new File([blob], 'photo.png', { type: 'image/png' }));
  });
  await page.waitForTimeout(700);

  const box = await page.evaluate(() => {
    const b = canvas.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });

  // Drag out a callout by touch, exactly as on the phone.
  await page.evaluate(() => document.querySelector('[data-tool="callout"]').click());
  await page.waitForTimeout(150);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: box.x + 50, y: box.y + 60 }] });
  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: box.x + 50 + i * 40, y: box.y + 60 + i * 10 }] });
    await page.waitForTimeout(25);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);

  // iOS zooms the page whenever a focused field is under 16px.
  r.editorFont = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('calloutTextInput'));
    return { px: cs.fontSize, iosWouldZoomPage: parseFloat(cs.fontSize) < 16 };
  });

  r.doneBarVisible = await page.evaluate(() => {
    const bar = document.getElementById('blockEditBar');
    const b = bar.getBoundingClientRect();
    return {
      open: bar.classList.contains('open'),
      onScreen: b.width > 0 && b.top >= 0 && b.bottom <= window.innerHeight + 1,
    };
  });

  await page.keyboard.type('Some note');
  await page.waitForTimeout(150);

  // Tapping away must finish the edit, not spawn a second callout.
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: box.x + box.w * 0.8, y: box.y + box.h * 0.8 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(350);
  r.afterTapAway = await page.evaluate(() => ({
    callouts: shapes.filter(s => s.type === 'callout').length,
    text: shapes.filter(s => s.type === 'callout').map(s => s.text),
    editorClosed: document.getElementById('calloutTextInput').style.display === 'none',
  }));

  // Done commits and hides the bar.
  await page.evaluate(() => startBlockEditing(shapes[0]));
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const el = document.getElementById('calloutTextInput');
    el.value = 'Edited via Done';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => document.getElementById('blockDone')
    .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })));
  await page.waitForTimeout(250);
  r.doneCommits = await page.evaluate(() => ({
    text: shapes[0].text,
    closed: document.getElementById('calloutTextInput').style.display === 'none',
    barHidden: !document.getElementById('blockEditBar').classList.contains('open'),
  }));

  // Cancel restores the previous text rather than destroying the shape.
  await page.evaluate(() => startBlockEditing(shapes[0]));
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const el = document.getElementById('calloutTextInput');
    el.value = 'scrapped';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => document.getElementById('blockCancel')
    .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })));
  await page.waitForTimeout(250);
  r.cancelRestores = await page.evaluate(() => ({
    text: shapes[0].text,
    stillThere: shapes.length,
  }));

  // The same must hold for the text tool, which shares the editor.
  await page.evaluate(() => document.querySelector('[data-tool="text"]').click());
  await page.waitForTimeout(150);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: box.x + box.w * 0.3, y: box.y + box.h * 0.6 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  r.textTool = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('calloutTextInput'));
    return {
      fontPx: cs.fontSize,
      iosWouldZoomPage: parseFloat(cs.fontSize) < 16,
      barOpen: document.getElementById('blockEditBar').classList.contains('open'),
    };
  });

  // Tapping an existing callout with the callout tool edits it; it must not
  // stack a second one on top.
  await page.evaluate(() => { finishBlockEditing(true); shapes.length = 0; selectedShape = null; redraw(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('[data-tool="callout"]').click());
  await page.waitForTimeout(150);
  const tap = async (pt) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
  };
  await tap({ x: box.x + box.w * 0.35, y: box.y + box.h * 0.3 });
  r.tapCreatesCallout = await page.evaluate(() => ({
    count: shapes.filter(s => s.type === 'callout').length,
    editing: !!editingBlock,
    // Not the bare minimum width a tight drag would floor at.
    widerThanMinimum: shapes[0].w > calloutMinWidth() * 1.5,
    fontSize: shapes[0].fontSize,
  }));
  await page.keyboard.type('First');
  await page.evaluate(() => finishBlockEditing(false));
  await page.waitForTimeout(200);

  const onCallout = await page.evaluate(() => {
    const s = shapes[0];
    const b = canvas.getBoundingClientRect();
    const k = canvas.width / b.width;
    const m = textBlockMetrics(s);
    return { x: b.x + (s.x + s.w / 2) / k, y: b.y + (s.y + m.height / 2) / k };
  });
  // Finishing an edit hands you the select tool, so pick the callout tool
  // again - this is the "callout tool active, tap an existing one" case.
  await page.evaluate(() => document.querySelector('[data-tool="callout"]').click());
  await page.waitForTimeout(150);
  await tap(onCallout);
  r.tapExistingEdits = await page.evaluate(() => ({
    count: shapes.filter(s => s.type === 'callout').length,
    editingSameShape: editingBlock === shapes[0],
    value: document.getElementById('calloutTextInput').value,
  }));
  await page.evaluate(() => finishBlockEditing(true));
  await page.waitForTimeout(150);

  // After placing one, the handles must be on screen and live: selected, on
  // the select tool, and draggable without picking a tool first.
  r.afterPlacing = await page.evaluate(() => ({
    selected: selectedShape === shapes[0],
    tool,
    handles: getResizeHandles(shapes[0]).map(h => h.type),
  }));
  r.handlesDrawn = await page.evaluate(() => {
    // The east width handle sits on the box edge; sample the canvas there and
    // check something was painted over the callout's own fill.
    const s = shapes[0];
    const h = getResizeHandles(s).find(g => g.type === 'block-e');
    const d = ctx.getImageData(Math.round(h.x), Math.round(h.y), 1, 1).data;
    const tip = getResizeHandles(s).find(g => g.type === 'callout-tip');
    const t = ctx.getImageData(Math.round(tip.x), Math.round(tip.y), 1, 1).data;
    return {
      widthHandlePainted: `rgb(${d[0]},${d[1]},${d[2]})`,
      tipHandleIsAccent: t[2] > t[0] + 40,
    };
  });
  const tipPt = await page.evaluate(() => {
    const s = shapes[0];
    const b = canvas.getBoundingClientRect(); const k = canvas.width / b.width;
    return { x: b.x + s.tipX / k, y: b.y + s.tipY / k, tipX: s.tipX, boxX: s.x };
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: tipPt.x, y: tipPt.y }] });
  for (let i = 1; i <= 4; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: tipPt.x + i * 15, y: tipPt.y + i * 12 }] });
    await page.waitForTimeout(25);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  r.tipDraggableStraightAfter = await page.evaluate((before) => ({
    tipMoved: Math.abs(shapes[0].tipX - before.tipX) > 1,
    boxStayed: Math.abs(shapes[0].x - before.boxX) < 1,
  }), tipPt);

  // A tap with a drawing tool must not leave a zero-sized speck behind; it
  // picks up the shape underneath instead.
  await page.evaluate(() => document.querySelector('[data-tool="rect"]').click());
  await page.waitForTimeout(150);
  await tap({ x: box.x + box.w * 0.75, y: box.y + box.h * 0.15 });
  r.rectTapOnBlank = await page.evaluate(() => ({
    shapesAdded: shapes.filter(s => s.type === 'rect').length,
    stillRectTool: tool === 'rect',
  }));
  await tap(onCallout);
  r.rectTapOnShape = await page.evaluate(() => ({
    rects: shapes.filter(s => s.type === 'rect').length,
    selectedIsCallout: selectedShape && selectedShape.type === 'callout',
    switchedToSelect: tool === 'select',
  }));

  // Dragging still creates, on the same tool.
  await page.evaluate(() => document.querySelector('[data-tool="rect"]').click());
  await page.waitForTimeout(150);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: box.x + 40, y: box.y + box.h - 120 }] });
  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: box.x + 40 + i * 25, y: box.y + box.h - 120 + i * 10 }] });
    await page.waitForTimeout(25);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  r.dragStillDraws = await page.evaluate(() => {
    const rects = shapes.filter(s => s.type === 'rect');
    return { count: rects.length, hasArea: rects.length > 0 && rects[0].w > 0 && rects[0].h > 0 };
  });

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
