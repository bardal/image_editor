const { chromium } = require('playwright');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

(async () => {
  const browser = await chromium.launch({ executablePath: require('./browser').path() });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(APP);
  await page.waitForTimeout(400);
  await page.evaluate(async () => { await dbDelete('doc'); await dbDelete('image'); });
  await page.reload();
  await page.waitForTimeout(400);

  const r = {};
  const box = await page.evaluate(() => {
    const b = canvas.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });

  // Drag out a callout box.
  await page.evaluate(() => document.querySelector('[data-tool="callout"]').click());
  await page.waitForTimeout(150);
  await page.mouse.move(box.x + 120, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 170, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  r.created = await page.evaluate(() => {
    const c = shapes.find(s => s.type === 'callout');
    return c ? { w: Math.round(c.w), hasTip: Number.isFinite(c.tipX), filled: c.fill } : null;
  });
  r.editorOpen = await page.evaluate(() =>
    document.getElementById('calloutTextInput').style.display === 'block' &&
    document.activeElement === document.getElementById('calloutTextInput'));

  // Type text long enough to wrap onto several lines.
  await page.keyboard.type('This note is deliberately long so that it has to wrap onto several lines inside the box.');
  await page.waitForTimeout(200);
  r.heightGrewWhileTyping = await page.evaluate(() => {
    const c = shapes.find(s => s.type === 'callout');
    const m = textBlockMetrics(c);
    return { lines: m.lines.length, height: Math.round(m.height) };
  });
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(250);

  r.committed = await page.evaluate(() => {
    const c = shapes.find(s => s.type === 'callout');
    return { text: c.text.slice(0, 20), lines: textBlockMetrics(c).lines.length, h: Math.round(c.h) };
  });

  // The tip must move independently of the box.
  const before = await page.evaluate(() => {
    const c = shapes.find(s => s.type === 'callout');
    return { x: c.x, y: c.y, tipX: c.tipX, tipY: c.tipY, w: c.w, h: c.h };
  });
  await page.evaluate(() => {
    document.querySelector('[data-tool="select"]').click();
    selectedShape = shapes.find(s => s.type === 'callout');
    redraw(); updateButtonStates();
  });
  await page.waitForTimeout(150);
  const tipScreen = await page.evaluate(() => {
    const c = selectedShape; const b = canvas.getBoundingClientRect();
    const k = canvas.width / b.width;
    return { x: b.x + c.tipX / k, y: b.y + c.tipY / k };
  });
  await page.mouse.move(tipScreen.x, tipScreen.y);
  await page.mouse.down();
  await page.mouse.move(tipScreen.x + 90, tipScreen.y + 70, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const afterTip = await page.evaluate(() => {
    const c = selectedShape;
    return { x: c.x, y: c.y, tipX: c.tipX, tipY: c.tipY };
  });
  r.tipMovedBoxStayed = {
    tipMoved: Math.abs(afterTip.tipX - before.tipX) > 20,
    boxUnmoved: afterTip.x === before.x && afterTip.y === before.y,
  };

  // Dragging the box must leave the tip where it is. The tip marks a place on
  // the picture; moving the label is how you get the words out of the way, and
  // it must not drag the marker off what it was pointing at.
  const boxCentre = await page.evaluate(() => {
    const c = selectedShape; const b = canvas.getBoundingClientRect();
    const k = canvas.width / b.width;
    return { x: b.x + (c.x + c.w/2) / k, y: b.y + (c.y + c.h/2) / k };
  });
  const beforeDrag = await page.evaluate(() => ({ ...selectedShape }));
  await page.mouse.move(boxCentre.x, boxCentre.y);
  await page.mouse.down();
  await page.mouse.move(boxCentre.x + 60, boxCentre.y + 40, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  r.boxDragLeavesTip = await page.evaluate(bd => {
    const c = selectedShape;
    const dx = c.x - bd.x, dy = c.y - bd.y;
    return { boxMoved: Math.abs(dx) > 20,
             tipStayed: Math.abs(c.tipX - bd.tipX) < 1 && Math.abs(c.tipY - bd.tipY) < 1 };
  }, beforeDrag);

  // Widening the box should reflow the text and change the line count.
  r.widthReflows = await page.evaluate(() => {
    const c = selectedShape;
    const before = textBlockMetrics(c).lines.length;
    c.w = c.w * 2;
    const after = textBlockMetrics(c).lines.length;
    c.w = c.w / 2;
    return { narrow: before, wide: after, reflowed: after < before };
  });

  // Survives a reload.
  await page.waitForTimeout(1000);
  await page.reload();
  await page.waitForTimeout(900);
  r.survivesReload = await page.evaluate(() => {
    const c = shapes.find(s => s.type === 'callout');
    return c ? { text: c.text.slice(0, 20), tip: [Math.round(c.tipX), Math.round(c.tipY)] } : null;
  });

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  finish(r, {
    'created.hasTip': isTrue,
    'created.filled': isTrue,
    'created.w': atLeast(1),
    'editorOpen': isTrue,
    'heightGrewWhileTyping.lines': atLeast(2),
    'committed.text': 'This note is deliber',
    'committed.lines': atLeast(2),
    'tipMovedBoxStayed.tipMoved': isTrue,
    'tipMovedBoxStayed.boxUnmoved': isTrue,
    'boxDragLeavesTip.boxMoved': isTrue,
    'boxDragLeavesTip.tipStayed': isTrue,
    'widthReflows.reflowed': isTrue,
    'survivesReload.text': 'This note is deliber',
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
