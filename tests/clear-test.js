const { chromium, devices } = require('playwright');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

const seed = async (page) => page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 800; c.height = 500;
  const g = c.getContext('2d');
  g.fillStyle = '#3d6b8f'; g.fillRect(0, 0, 800, 500);
  const blob = await new Promise(res => c.toBlob(res, 'image/png'));
  await processImageFile(new File([blob], 't.png', { type: 'image/png' }));
});

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const r = {};

  await page.goto(APP);
  await page.waitForTimeout(400);
  await page.evaluate(async () => { await dbDelete('image'); await dbDelete('doc'); });
  await page.reload();
  await page.waitForTimeout(500);

  // 1. Empty canvas: no dialog, just a toast.
  await page.click('#clear');
  await page.waitForTimeout(250);
  r.emptyCanvas = await page.evaluate(() => ({
    dialogShown: document.getElementById('clearModal').style.display === 'block',
    toast: document.getElementById('toast').textContent,
  }));

  // 2. Image + shapes: both options offered.
  await seed(page);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    shapes.push({type:'rect',x:60,y:60,w:200,h:120,rotation:0,color:'#f00',size:5,id:1});
    redraw();
  });
  await page.waitForTimeout(900);
  await page.click('#clear');
  await page.waitForTimeout(250);
  r.withBoth = await page.evaluate(() => ({
    dialogShown: document.getElementById('clearModal').style.display === 'block',
    summary: document.getElementById('clearSummary').textContent,
    shapesOptionEnabled: !document.getElementById('clearShapesBtn').disabled,
    allOptionEnabled: !document.getElementById('clearAllBtn').disabled,
  }));

  // 3. Drawing only: shapes go, image stays.
  await page.click('#clearShapesBtn');
  await page.waitForTimeout(400);
  r.afterClearDrawing = await page.evaluate(() => ({
    shapes: shapes.length, hasImage: !!img, canvas: [canvas.width, canvas.height],
  }));

  // 4. Image only: the drawing-only option is unavailable.
  await page.click('#clear');
  await page.waitForTimeout(250);
  r.imageOnly = await page.evaluate(() => ({
    summary: document.getElementById('clearSummary').textContent,
    shapesOptionEnabled: !document.getElementById('clearShapesBtn').disabled,
    allOptionEnabled: !document.getElementById('clearAllBtn').disabled,
  }));

  // 5. Everything: image goes too, and stays gone across a reload.
  await page.click('#clearAllBtn');
  await page.waitForTimeout(600);
  r.afterClearAll = await page.evaluate(() => ({ shapes: shapes.length, hasImage: !!img }));
  await page.reload();
  await page.waitForTimeout(900);
  r.afterClearAllReload = await page.evaluate(() => ({ shapes: shapes.length, hasImage: !!img }));

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  finish(r, {
    'emptyCanvas.dialogShown': isFalse,
    'emptyCanvas.toast': 'Nothing to clear',
    'withBoth.dialogShown': isTrue,
    'withBoth.summary': '1 shape drawn on an image.',
    'withBoth.shapesOptionEnabled': isTrue,
    'withBoth.allOptionEnabled': isTrue,
    'afterClearDrawing.shapes': 0,
    'afterClearDrawing.hasImage': isTrue,
    'imageOnly.summary': 'An image with no annotations.',
    'imageOnly.shapesOptionEnabled': isFalse,
    'imageOnly.allOptionEnabled': isTrue,
    'afterClearAll.shapes': 0,
    'afterClearAll.hasImage': isFalse,
    // Clearing everything must survive a reload - it used to be left to the
    // save debounce, so the shapes came straight back.
    'afterClearAllReload.shapes': 0,
    'afterClearAllReload.hasImage': isFalse,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
