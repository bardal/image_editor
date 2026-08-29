const { open } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');

(async () => {
  const { browser, context: ctx, page, errors } = await open({ device: 'iPhone 13', reset: false });

  // Load a 1000x800 image and put a shape at a known spot.
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 800;
    const g = c.getContext('2d');
    g.fillStyle = '#4477aa'; g.fillRect(0, 0, c.width, c.height);
    const image = new Image();
    await new Promise(r => { image.onload = r; image.src = c.toDataURL(); });
    img = image; imgOffset = {x:0,y:0}; canvasOverride = null; resizeCanvas();
    shapes.push({type:'rect', x:400, y:300, w:200, h:100, rotation:0, color:'#ff0000', size:4, id:1});
    redraw();
  });
  await page.waitForTimeout(200);

  const r = {};
  r.start = await page.evaluate(() => ({canvas:[canvas.width,canvas.height], shape:[shapes[0].x,shapes[0].y], imgOffset:{...imgOffset}}));

  await page.evaluate(() => document.querySelector('[data-tool="crop"]').click());
  await page.waitForTimeout(200);
  r.cropModeOn = await page.evaluate(() => !!cropRect && document.getElementById('cropGroup').classList.contains('visible'));

  // ---- CROP: pull the frame inward to 200,150 -> 800,650 ----
  await page.evaluate(() => { cropRect = {x:200, y:150, w:600, h:500}; redraw(); });
  await page.click('#cropApply');
  await page.waitForTimeout(300);
  r.afterCrop = await page.evaluate(() => ({
    canvas:[canvas.width,canvas.height],
    shape:[shapes[0].x,shapes[0].y],
    imgOffset:{...imgOffset},
  }));

  // The pixel at the shape's new position must still be the shape (geometry moved with the canvas).
  r.cropKeptAlignment = await page.evaluate(() => {
    const s = shapes[0];
    // Sample just inside the top edge of the rect stroke.
    const d = ctx.getImageData(Math.round(s.x + s.w/2), Math.round(s.y), 1, 1).data;
    return `rgb(${d[0]},${d[1]},${d[2]})`;
  });

  // ---- EXPAND: push the frame outward beyond the canvas ----
  // Expanded well past the image's own edge, so the sampled corner is genuinely
  // new blank space rather than image area the earlier crop had trimmed off.
  await page.evaluate(() => { cropRect = {x:-400, y:-400, w:1600, h:1400}; redraw(); });
  await page.click('#cropApply');
  await page.waitForTimeout(300);
  r.afterExpand = await page.evaluate(() => ({
    canvas:[canvas.width,canvas.height],
    shape:[shapes[0].x,shapes[0].y],
    imgOffset:{...imgOffset},
  }));

  // New margin must stay transparent. Sampled with the crop tool inactive, so
  // a crop handle drawn at the corner cannot be mistaken for the background.
  await page.evaluate(() => document.querySelector('[data-tool="select"]').click());
  await page.waitForTimeout(200);
  r.marginAlpha = await page.evaluate(() => ctx.getImageData(5, 5, 1, 1).data[3]);
  r.exportedMarginAlpha = await page.evaluate(async () => {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    const bmp = await createImageBitmap(blob);
    const t = document.createElement('canvas');
    t.width = bmp.width; t.height = bmp.height;
    const g = t.getContext('2d'); g.drawImage(bmp, 0, 0);
    return g.getImageData(5, 5, 1, 1).data[3];
  });
  await page.evaluate(() => document.querySelector('[data-tool="crop"]').click());
  await page.waitForTimeout(200);

  // ---- RESET back to the image's own bounds ----
  await page.click('#cropReset');
  await page.waitForTimeout(300);
  r.afterReset = await page.evaluate(() => ({
    canvas:[canvas.width,canvas.height],
    shape:[shapes[0].x,shapes[0].y],
    imgOffset:{...imgOffset},
  }));

  // Leaving the crop tool must clear the overlay.
  await page.evaluate(() => document.querySelector('[data-tool="select"]').click());
  await page.waitForTimeout(200);
  r.overlayCleared = await page.evaluate(() => cropRect === null);

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  finish(r, {
    'cropModeOn': isTrue,
    'afterCrop.canvas': [600, 500],
    'afterCrop.shape': [200, 150],
    'afterCrop.imgOffset.x': -200,
    'afterCrop.imgOffset.y': -150,
    'cropKeptAlignment': 'rgb(255,0,0)',
    'afterExpand.canvas': [1600, 1400],
    'afterExpand.shape': [600, 550],
    // Expanded margins stay transparent, in the app and in the export.
    'marginAlpha': 0,
    'exportedMarginAlpha': 0,
    'afterReset.canvas': [1000, 800],
    'afterReset.shape': [400, 300],
    'overlayCleared': isTrue,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
