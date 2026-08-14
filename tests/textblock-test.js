const { chromium } = require('playwright');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
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

  // Text tool now opens the multi-line editor.
  await page.evaluate(() => document.querySelector('[data-tool="text"]').click());
  await page.waitForTimeout(150);
  await page.mouse.click(box.x + 100, box.y + 100);
  await page.waitForTimeout(200);
  r.multilineEditorUsed = await page.evaluate(() => {
    const el = document.getElementById('calloutTextInput');
    return el.tagName === 'TEXTAREA' && el.style.display === 'block' && document.activeElement === el;
  });

  // Multi-line input: Enter should insert a break, not commit.
  await page.keyboard.type('First line');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second line, plus enough words that this one has to wrap around.');
  await page.waitForTimeout(200);
  r.enterMakesNewline = await page.evaluate(() =>
    document.getElementById('calloutTextInput').value.includes('\n'));
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(250);

  r.textWraps = await page.evaluate(() => {
    const t = shapes.find(s => s.type === 'text');
    const m = textBlockMetrics(t);
    return { lines: m.lines.length, height: Math.round(m.height), width: Math.round(t.w) };
  });

  // Width handles reflow the text, same as a callout.
  r.widthReflows = await page.evaluate(() => {
    const t = shapes.find(s => s.type === 'text');
    const before = textBlockMetrics(t).lines.length;
    t.w *= 2;
    const after = textBlockMetrics(t).lines.length;
    t.w /= 2;
    return { narrow: before, wide: after, reflowed: after < before };
  });

  // The width handles exist on a text block.
  r.textHasWidthHandles = await page.evaluate(() => {
    const t = shapes.find(s => s.type === 'text');
    return getResizeHandles(t).map(h => h.type);
  });

  // Both shapes share one implementation.
  r.sharedImplementation = await page.evaluate(() => ({
    oneWrapper: typeof wrapTextToWidth === 'function',
    oneMetrics: typeof textBlockMetrics === 'function',
    oneRenderer: typeof drawTextBlock === 'function',
    oneEditor: typeof startBlockEditing === 'function',
    oldTextPathGone: typeof startTextEditing === 'undefined' && typeof finishTextEditing === 'undefined',
  }));

  // Legacy text shapes without a width must still render.
  r.legacyMigrates = await page.evaluate(() => {
    const legacy = { type:'text', x:400, y:400, text:'Older text with no width', color:'#000',
                     size:3, rotation:0, fontSize:24, id:999 };
    shapes.push(legacy);
    redraw();
    return { gotWidth: Number.isFinite(legacy.w) && legacy.w > 0, lines: textBlockMetrics(legacy).lines.length };
  });

  // Labels still work off the single-line input.
  r.labelsStillWork = await page.evaluate(() => typeof startLabelEditing === 'function' &&
    document.getElementById('canvasTextInput') !== null);

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
