const { open, seedPhoto, realErrors } = require('./harness');
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

  // ---- Everything the undo stack calls a document survives a reload ----
  //
  // Named field by field, this suite only covers what someone remembered to
  // list, and the document has grown twice without the list growing with it:
  // the crop fields reached saveSession and never reached the undo snapshot,
  // and nothing here or there went red. So this one is generic. It asks the
  // app what the document is - snapshotDoc(), the same answer undo works
  // from - and requires all of it back, whatever it turns out to hold.
  //
  // A field added to the document in future is covered by this the day it is
  // added. That is the point of it: the two hand-written lists are what keeps
  // going wrong, so nothing here is hand-written.
  await page.evaluate(async () => {
    await dbDelete('doc');
    await dbDelete('image');
  });
  await page.reload();
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 600;
    const g = c.getContext('2d'); g.fillStyle = '#3d6b8f'; g.fillRect(0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    await processImageFile(new File([blob], 'roundtrip.png', { type: 'image/png' }));
  });
  await page.waitForTimeout(700);
  // Every kind of document state at once: a drawing, a torn edge, a crop.
  await page.evaluate(() => {
    shapes.push({ type: 'rect', x: 120, y: 90, w: 240, h: 160, rotation: 0,
      color: '#ff0000', size: 5, fill: false, id: newShapeId() });
    shapes.push({ type: 'polyline', points: [{x:200,y:200},{x:300,y:260},{x:380,y:210}],
      color: '#00aa00', size: 3, rotation: 0, id: newShapeId() });
    toggleTearEdge('right');
    setTearDepth(22);
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.querySelector('[data-tool="crop"]').click();
    cropRect = { x: 60, y: 50, w: 600, h: 450 };
  });
  await page.waitForTimeout(200);
  await page.click('#cropApply');
  await page.waitForTimeout(1400); // let the debounced save land

  const docBefore = await page.evaluate(() => JSON.stringify(snapshotDoc()));
  await page.reload();
  await page.waitForTimeout(1400);
  const docAfter = await page.evaluate(() => JSON.stringify(snapshotDoc()));

  r.roundTrip = {
    // Reported whole so a failure says which field was dropped, not just that
    // one was.
    before: JSON.parse(docBefore),
    after: JSON.parse(docAfter),
    identical: docBefore === docAfter,
    // Guards against the whole thing passing because both sides are empty.
    wasNotEmpty: JSON.parse(docBefore).shapes.length === 2,
    wasCropped: JSON.parse(docBefore).canvasOverride !== null,
    wasTorn: JSON.parse(docBefore).tear.right === true,
  };

  r.errors = realErrors(errors);
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
    'roundTrip.wasNotEmpty': isTrue,
    'roundTrip.wasCropped': isTrue,
    'roundTrip.wasTorn': isTrue,
    'roundTrip.identical': isTrue,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
