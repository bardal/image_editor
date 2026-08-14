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

  const r = {};

  // Load an image through the real path so the blob is stored, then annotate it.
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 600;
    const g = c.getContext('2d');
    g.fillStyle = '#3d6b8f'; g.fillRect(0, 0, 900, 600);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    await processImageFile(new File([blob], 'test.png', { type: 'image/png' }));
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    shapes.push({type:'rect', x:100, y:80, w:250, h:150, rotation:0, color:'#ff0000', size:5, fill:false, id:1});
    shapes.push({type:'text', x:120, y:300, text:'Keep me', color:'#00aa00', size:3, rotation:0, fontSize:28, id:2});
    redraw();
  });
  await page.waitForTimeout(1200); // let the debounced save land

  r.before = await page.evaluate(() => ({
    shapes: shapes.length,
    texts: shapes.filter(s=>s.type==='text').map(s=>s.text),
    canvas: [canvas.width, canvas.height],
    hasImage: !!img,
  }));

  // ---- RELOAD ----
  await page.reload();
  await page.waitForTimeout(1200);

  r.after = await page.evaluate(() => ({
    shapes: shapes.length,
    texts: shapes.filter(s=>s.type==='text').map(s=>s.text),
    canvas: [canvas.width, canvas.height],
    hasImage: !!img,
    imageSize: img ? [img.naturalWidth, img.naturalHeight] : null,
  }));
  r.imagePixelRestored = await page.evaluate(() => {
    const d = ctx.getImageData(600, 450, 1, 1).data;
    return `rgb(${d[0]},${d[1]},${d[2]})`;
  });

  // ---- Crop survives a reload too ----
  await page.evaluate(() => {
    document.querySelector('[data-tool="crop"]').click();
    cropRect = {x:50, y:40, w:500, h:400};
  });
  await page.waitForTimeout(200);
  await page.click('#cropApply');
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForTimeout(1200);
  r.afterCropReload = await page.evaluate(() => ({
    canvas: [canvas.width, canvas.height],
    imgOffset: {...imgOffset},
    shapes: shapes.length,
  }));

  // ---- Clearing then reloading must not resurrect the shapes ----
  // Clear now asks what to remove, so pick the drawing-only option.
  await page.evaluate(() => document.getElementById('clear').click());
  await page.waitForTimeout(250);
  await page.evaluate(() => document.getElementById('clearShapesBtn').click());
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForTimeout(1200);
  r.afterClearReload = await page.evaluate(() => ({ shapes: shapes.length, hasImage: !!img }));

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
