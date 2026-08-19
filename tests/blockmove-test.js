// A selected callout shows handles, which says the box is yours to work with -
// but with the callout or text tool active, pressing the body opened the
// keyboard instead of moving it. A drag is unambiguous: a tap already opens
// the editor, so there is nothing to lose by letting a drag move the box.
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

  // A portrait phone photo, as reported.
  await page.evaluate(async () => {
    const cv = document.createElement('canvas');
    cv.width = 3024; cv.height = 4032;
    const g = cv.getContext('2d'); g.fillStyle = '#8a9a7a'; g.fillRect(0, 0, cv.width, cv.height);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    await processImageFile(new File([blob], 'photo.png', { type: 'image/png' }));
  });
  await page.waitForTimeout(800);

  const place = (kind) => page.evaluate((kind) => {
    shapes.length = 0;
    const w = canvas.width;
    const common = { x: w * 0.3, y: canvas.height * 0.35, w: w * 0.35,
      text: 'Nicko', color: '#222222', size: 5, fontSize: 16,
      fontFamily: 'sans-serif', fontWeight: 'normal', fontStyle: 'normal',
      textAlign: 'left', rotation: 0, id: 1 };
    shapes.push(kind === 'callout'
      ? { ...common, type: 'callout', h: w * 0.09, fill: true, fillColor: '#ffffff',
          endStyle: 'closedArrow', tipX: w * 0.5, tipY: canvas.height * 0.45 }
      : { ...common, type: 'text', h: 0 });
    selectedShape = shapes[0]; redraw(); updateButtonStates();
  }, kind);

  const onBody = () => page.evaluate(() => {
    const s = shapes[0];
    const b = canvas.getBoundingClientRect();
    const k = canvas.width / b.width;
    const m = textBlockMetrics(s);
    return { x: b.x + (s.x + s.w * 0.5) / k, y: b.y + (s.y + m.height * 0.5) / k };
  });

  const state = () => page.evaluate(() => ({
    x: Math.round(shapes[0] ? shapes[0].x : -1),
    y: Math.round(shapes[0] ? shapes[0].y : -1),
    tipX: shapes[0] && typeof shapes[0].tipX === 'number' ? Math.round(shapes[0].tipX) : null,
    editing: !!editingBlock,
    count: shapes.length,
  }));

  const dragBody = async (dx, dy) => {
    const from = await onBody();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
        touchPoints: [{ x: from.x + dx * i / 6, y: from.y + dy * i / 6 }] });
      await page.waitForTimeout(30);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(350);
  };
  const tapBody = async () => {
    const at = await onBody();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(350);
  };
  const useTool = (t) => page.evaluate(t => {
    document.querySelector(`[data-tool="${t}"]`).click();
    selectedShape = shapes[0]; redraw(); updateButtonStates();
  }, t);

  for (const [kind, tool] of [['callout', 'callout'], ['text', 'text'], ['callout', 'select']]) {
    const key = `${kind}With${tool[0].toUpperCase()}${tool.slice(1)}`;

    await place(kind);
    await useTool(tool);
    const before = await state();
    await dragBody(70, -90);
    const afterDrag = await state();
    await page.evaluate(() => { if (editingBlock) finishBlockEditing(true); });
    await page.waitForTimeout(150);

    await place(kind);
    await useTool(tool);
    await tapBody();
    const afterTap = await state();
    await page.evaluate(() => { if (editingBlock) finishBlockEditing(true); });
    await page.waitForTimeout(150);

    r[key] = {
      dragMoved: Math.abs(afterDrag.x - before.x) > 5 || Math.abs(afterDrag.y - before.y) > 5,
      dragOpenedEditor: afterDrag.editing,
      tipFollowed: before.tipX === null ? null : Math.abs(afterDrag.tipX - before.tipX) > 5,
      // A tap is still how you edit, whichever tool is active.
      tapOpenedEditor: afterTap.editing,
      tapMoved: Math.abs(afterTap.x - before.x) > 5 || Math.abs(afterTap.y - before.y) > 5,
      // Neither gesture may leave a second shape behind.
      count: afterDrag.count,
    };
  }

  // Dragging must be one undo step, and undo must put the box back.
  await place('callout');
  await useTool('callout');
  await page.evaluate(() => { undoStack.length = 0; });
  const undoBefore = await state();
  await dragBody(80, 60);
  await page.evaluate(() => { if (editingBlock) finishBlockEditing(true); });
  await page.waitForTimeout(150);
  const steps = await page.evaluate(() => undoStack.length);
  await page.evaluate(() => undoLastAction());
  await page.waitForTimeout(200);
  const undoAfter = await state();
  r.undoOfDrag = {
    steps,
    backWhereItWas: Math.abs(undoAfter.x - undoBefore.x) < 2 && Math.abs(undoAfter.y - undoBefore.y) < 2,
  };

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  finish(r, {
    'calloutWithCallout.dragMoved': isTrue,
    'calloutWithCallout.dragOpenedEditor': isFalse,
    'calloutWithCallout.tipFollowed': isTrue,
    'calloutWithCallout.tapOpenedEditor': isTrue,
    'calloutWithCallout.tapMoved': isFalse,
    'calloutWithCallout.count': 1,
    'textWithText.dragMoved': isTrue,
    'textWithText.dragOpenedEditor': isFalse,
    'textWithText.tapOpenedEditor': isTrue,
    'textWithText.tapMoved': isFalse,
    'textWithText.count': 1,
    // The select tool must go on behaving exactly as it did.
    'calloutWithSelect.dragMoved': isTrue,
    'calloutWithSelect.dragOpenedEditor': isFalse,
    'calloutWithSelect.tipFollowed': isTrue,
    'calloutWithSelect.count': 1,
    'undoOfDrag.steps': 1,
    'undoOfDrag.backWhereItWas': isTrue,
    'errors': isEmpty,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
