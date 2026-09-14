// A pasted picture arrives as a new document.
//
// processImageFile reset the bounds - offset, crop, canvas size - but left the
// shapes and the torn edges where they were, so pasting a screenshot brought
// the last picture's arrows with it, measured against a canvas that no longer
// existed. Everything a person draws belongs to the picture it was drawn on.
//
// The paste is dispatched as a real `paste` event carrying a file, which is
// how the clipboard reaches the app on every platform but the toolbar button;
// that button lands in the same processImageFile, so this covers both.
const { open, seedPhoto, realErrors } = require('./harness');
const { finish, isTrue, isFalse, isEmpty } = require('./expect');

// A flat colour of a known size, handed to the app as a paste rather than a
// file, so the report can say the picture on the canvas is the pasted one.
async function pasteImage(page, { width, height, colour }) {
  const delivered = await page.evaluate(async ({ width, height, colour }) => {
    const cv = document.createElement('canvas');
    cv.width = width; cv.height = height;
    const g = cv.getContext('2d');
    g.fillStyle = colour; g.fillRect(0, 0, width, height);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'pasted.png', { type: 'image/png' }));
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    // Says the event carried the file at all: a ClipboardEvent built without
    // clipboardData would leave the handler with nothing and every assertion
    // below would pass for the wrong reason.
    return !!(ev.clipboardData && ev.clipboardData.items.length);
  }, { width, height, colour });
  await page.waitForTimeout(700);
  return delivered;
}

(async () => {
  const { browser, page, errors } = await open({ viewport: { width: 1200, height: 900 } });
  const r = {};

  await seedPhoto(page, { width: 800, height: 500, colour: '#3d6b8f', name: 'first.png' });

  // A worked-on document: something drawn, an edge torn, a crop taken. Each of
  // those is a separate field of the document and each was carried over.
  await page.evaluate(() => {
    shapes.push({ type: 'rect', x: 60, y: 60, w: 200, h: 120, rotation: 0, color: '#f00', size: 5, id: 1 });
    toggleTearEdge('top');
    cropRect = { x: 50, y: 40, w: 600, h: 380 };
    applyCrop();
    redraw();
  });
  await page.waitForTimeout(600);
  r.beforePaste = await page.evaluate(() => ({
    shapes: shapes.length,
    tornTop: !!tear.top,
    canvas: [canvas.width, canvas.height],
    override: !!canvasOverride,
    offset: [imgOffset.x, imgOffset.y],
    undoSteps: undoStack.length,
  }));

  r.delivered = await pasteImage(page, { width: 600, height: 400, colour: '#c04a2a' });

  r.afterPaste = await page.evaluate(() => {
    const g = ctx.getImageData(Math.round(canvas.width / 2), Math.round(canvas.height / 2), 1, 1).data;
    return {
      shapes: shapes.length,
      selected: !!selectedShape,
      torn: [tear.top, tear.right, tear.bottom, tear.left],
      override: canvasOverride,
      cropRect,
      offset: [imgOffset.x, imgOffset.y],
      canvas: [canvas.width, canvas.height],
      image: [img.naturalWidth, img.naturalHeight],
      // The pasted colour, not the first picture's: the canvas shows the new
      // image rather than a resized view of the old one.
      pixel: [g[0], g[1], g[2]],
      // Undo steps belong to the document that was replaced. Left in place, the
      // first press dropped the old picture's shapes onto the new one.
      undoSteps: undoStack.length,
      undoOffered: !document.getElementById('undo').disabled,
    };
  });

  // Undo is not a way back to the picture that was pasted over.
  await page.evaluate(() => undoLastAction());
  await page.waitForTimeout(300);
  r.afterUndo = await page.evaluate(() => ({
    shapes: shapes.length,
    canvas: [canvas.width, canvas.height],
    torn: [tear.top, tear.right, tear.bottom, tear.left],
  }));

  // And the clean document is what a reload brings back - the save is not left
  // to a debounce that a reload can outrun.
  await page.reload();
  await page.waitForTimeout(900);
  r.afterReload = await page.evaluate(() => ({
    shapes: shapes.length,
    hasImage: !!img,
    canvas: [canvas.width, canvas.height],
    torn: [tear.top, tear.right, tear.bottom, tear.left],
  }));

  r.errors = realErrors(errors);
  finish(r, {
    'delivered': isTrue,
    // The document really was worked on, or the paste proves nothing.
    'beforePaste.shapes': 1,
    'beforePaste.tornTop': isTrue,
    'beforePaste.override': isTrue,
    'beforePaste.canvas': [600, 380],

    'afterPaste.shapes': 0,
    'afterPaste.selected': isFalse,
    'afterPaste.torn': [false, false, false, false],
    'afterPaste.override': null,
    'afterPaste.cropRect': null,
    'afterPaste.offset': [0, 0],
    'afterPaste.canvas': [600, 400],
    'afterPaste.image': [600, 400],
    'afterPaste.pixel': [192, 74, 42],
    'afterPaste.undoSteps': 0,
    'afterPaste.undoOffered': isFalse,

    'afterUndo.shapes': 0,
    'afterUndo.canvas': [600, 400],
    'afterUndo.torn': [false, false, false, false],

    'afterReload.shapes': 0,
    'afterReload.hasImage': isTrue,
    'afterReload.canvas': [600, 400],
    'afterReload.torn': [false, false, false, false],
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
