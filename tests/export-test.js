// Export had almost no coverage, and it is the app's whole output. The saved
// file must contain the drawing at the image's own resolution, follow a crop,
// and carry none of the editing furniture - the selection outline, its handles
// or the crop frame were all being drawn straight into the picture.
const { open, seedPhoto } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

(async () => {
  const { browser, context: ctx, page, errors } = await open({ downloads: true, resetSettle: 400 });
  const r = {};

  // A photo with a known flat background, so a sampled pixel is unambiguous.
  await seedPhoto(page, { width: 1200, height: 900, colour: '#204060' });

  // A filled red box, left selected - the state the handles used to leak from.
  await page.evaluate(() => {
    shapes.push({ type: 'rect', x: 300, y: 200, w: 400, h: 300, rotation: 0,
      color: '#ff0000', size: 8, fill: true, fillColor: '#ff0000', id: newShapeId() });
    document.querySelector('[data-tool="select"]').click();
    selectedShape = shapes[0]; redraw(); updateButtonStates();
  });
  await page.waitForTimeout(200);

  r.selectedWhileExporting = await page.evaluate(() => selectedShape !== null);

  // Read the exported PNG back through an ImageBitmap so the bytes are checked,
  // not the live canvas.
  // Chromium offers showSaveFilePicker, so the app takes that path and waits on
  // a dialog that never opens here. Stubbing it captures the exact bytes the app
  // would have written; the anchor fallback - which is what Safari and iOS get -
  // is checked separately below.
  const stubPicker = () => page.evaluate(() => {
    window.__written = null;
    window.showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async (blob) => { window.__written = blob; },
        close: async () => {},
      }),
    });
  });

  const readExport = async () => {
    // Sample exactly where the furniture would be drawn, not near it: the
    // rotation handle's own centre and a corner resize handle.
    const spots = await page.evaluate(() => {
      const s = shapes[0];
      const h = getRotationHandle(s);
      const corner = getResizeHandles(s)[0];
      return {
        rotation: { x: Math.round(h.x), y: Math.round(h.y) },
        corner: { x: Math.round(corner.x), y: Math.round(corner.y) },
      };
    });
    await stubPicker();
    await page.click('#download');
    await page.waitForFunction(() => window.__written !== null, null, { timeout: 10000 });
    const probe = await page.evaluate(async (spots) => {
      const blob = window.__written;
      const bmp = await createImageBitmap(blob);
      const off = document.createElement('canvas');
      off.width = bmp.width; off.height = bmp.height;
      const g = off.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const px = (x, y) => {
        const d = g.getImageData(x, y, 1, 1).data;
        return `rgba(${d[0]},${d[1]},${d[2]},${d[3]})`;
      };
      return {
        width: bmp.width, height: bmp.height,
        background: px(20, 20),
        insideShape: px(500, 350),
        atRotationHandle: px(
          Math.min(off.width - 1, Math.max(0, spots.rotation.x)),
          Math.min(off.height - 1, Math.max(0, spots.rotation.y))),
        atCornerHandle: px(
          Math.min(off.width - 1, Math.max(0, spots.corner.x)),
          Math.min(off.height - 1, Math.max(0, spots.corner.y))),
        bytes: blob.size,
        mime: blob.type,
      };
    }, spots);
    return probe;
  };

  const exported = await readExport();
  r.exported = {
    mime: exported.mime,
    size: [exported.width, exported.height],
    // Full image resolution, not the size it happened to be displayed at.
    background: exported.background,
    shapeIsInIt: exported.insideShape,
    // These two are the decisive ones: the handles paint white and blue, so
    // anything other than the background means the furniture leaked in.
    atRotationHandle: exported.atRotationHandle,
    atCornerHandle: exported.atCornerHandle,
    nonEmpty: exported.bytes > 1000,
  };

  // The picture on screen must be unchanged afterwards: the selection comes
  // back, so exporting does not quietly deselect what you were working on.
  r.afterExport = await page.evaluate(() => ({
    stillSelected: selectedShape === shapes[0],
    shapes: shapes.length,
  }));

  // A crop must be reflected in the file.
  await page.evaluate(() => {
    document.querySelector('[data-tool="crop"]').click();
    cropRect = { x: 200, y: 100, w: 600, h: 500 };
    redraw();
    applyCrop();
  });
  await page.waitForTimeout(400);
  const cropped = await readExport();
  r.croppedExport = {
    size: [cropped.width, cropped.height],
    canvasSize: await page.evaluate(() => [canvas.width, canvas.height]),
  };

  // Without showSaveFilePicker - Safari, iOS - the app falls back to an anchor
  // download, which is the path most phones actually take.
  await page.evaluate(() => { delete window.showSaveFilePicker; });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#download'),
  ]);
  r.anchorFallback = { filename: download.suggestedFilename() };

  // Copy to clipboard goes through the same clean render.
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => {
    document.querySelector('[data-tool="select"]').click();
    selectedShape = shapes[0]; redraw(); updateButtonStates();
  });
  r.copyLeavesSelectionAlone = await page.evaluate(async () => {
    await copyImageToClipboard();
    return selectedShape === shapes[0];
  });
  await page.waitForTimeout(200);

  // ---- Saving on a phone goes through the share sheet ----
  // A download on iOS lands in Files > Downloads and can never reach Photos.
  // The share sheet is the only route to "Save Image", so where the browser
  // can share a file, that is what Save does. Chromium cannot open Apple's
  // sheet, so what is checked here is the branch taken and the file handed
  // over - whether the sheet then offers Save Image is for a real phone.
  r.shareBranch = await page.evaluate(async () => {
    const seen = [];
    const realShare = navigator.share, realCanShare = navigator.canShare;
    navigator.canShare = data => !!(data && data.files && data.files.length);
    navigator.share = async data => { seen.push(data); };
    document.getElementById('download').click();
    await new Promise(res => setTimeout(res, 600));
    navigator.share = realShare; navigator.canShare = realCanShare;
    const f = seen.length ? seen[0].files[0] : null;
    return {
      shared: seen.length,
      name: f && f.name,
      type: f && f.type,
      hasBytes: !!(f && f.size > 1000),
    };
  });

  // The name follows the picture it came from rather than being the same
  // word every time, so a phone full of them can be told apart.
  r.nameFromSource = await page.evaluate(() => exportFileName());

  // Sharing refused or dismissed must not leave you with nothing: it falls
  // through to a download.
  await page.evaluate(() => {
    navigator.canShare = () => true;
    navigator.share = async () => { const e = new Error('no'); e.name = 'NotAllowedError'; throw e; };
  });
  const [refusedDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#download'),
  ]);
  r.shareRefusedFallsBack = { filename: refusedDownload.suggestedFilename() };

  // A dismissed sheet is not a failure and must not then download behind it.
  r.shareCancelled = await page.evaluate(async () => {
    let downloaded = false;
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { downloaded = true; };
    navigator.canShare = () => true;
    navigator.share = async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; };
    document.getElementById('download').click();
    await new Promise(res => setTimeout(res, 600));
    HTMLAnchorElement.prototype.click = realClick;
    return { downloaded };
  });

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  finish(r, {
    'selectedWhileExporting': isTrue,
    'exported.mime': 'image/png',
    'exported.size': [1200, 900],
    'exported.background': 'rgba(32,64,96,255)',
    'exported.shapeIsInIt': 'rgba(255,0,0,255)',
    // Plain background where the handles are drawn on screen.
    'exported.atRotationHandle': 'rgba(32,64,96,255)',
    'exported.atCornerHandle': 'rgba(255,0,0,255)',
    'exported.nonEmpty': isTrue,
    'afterExport.stillSelected': isTrue,
    'afterExport.shapes': 1,
    'croppedExport.size': [600, 500],
    'croppedExport.canvasSize': [600, 500],
    'anchorFallback.filename': 'photo-etch.png',
    'shareBranch.shared': 1,
    'shareBranch.name': 'photo-etch.png',
    'shareBranch.type': 'image/png',
    'shareBranch.hasBytes': isTrue,
    'nameFromSource': 'photo-etch.png',
    'shareRefusedFallsBack.filename': 'photo-etch.png',
    'shareCancelled.downloaded': isFalse,
    'copyLeavesSelectionAlone': isTrue,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
