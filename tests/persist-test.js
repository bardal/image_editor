const { open, seedPhoto } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');

(async () => {
  const { browser, context: ctx, page, errors } = await open({ device: 'iPhone 13', settle: 400, reset: false });

  const r = {};

  // Load an image through the real path so the blob is stored, then annotate it.
  await seedPhoto(page, { width: 900, height: 600, name: 'test.png', settle: 500 });
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
  finish(r, {
    'after.shapes': 2,
    'after.texts': ['Keep me'],
    'after.canvas': [900, 600],
    'after.hasImage': isTrue,
    'after.imageSize': [900, 600],
    'imagePixelRestored': 'rgb(61,107,143)',
    'afterCropReload.canvas': [500, 400],
    'afterCropReload.imgOffset.x': -50,
    'afterCropReload.imgOffset.y': -40,
    'afterCropReload.shapes': 2,
    'afterClearReload.shapes': 0,
    'afterClearReload.hasImage': isTrue,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
