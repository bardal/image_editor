const { open, seedPhoto, resetApp, realErrors } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

// The bin a finger actually lands on. On a phone it is the one floating over
// the picture: the top bar keeps only what you do once a session.
const BIN = '#floatClear';

(async () => {
  const { browser, context: ctx, page, errors } = await open({ device: 'iPhone 13', reset: false });
  const r = {};

  await page.goto(APP);
  await page.waitForTimeout(400);
  await page.evaluate(async () => { await dbDelete('image'); await dbDelete('doc'); });
  await page.reload();
  await page.waitForTimeout(500);

  // 1. Empty canvas: no dialog, just a toast.
  await page.click(BIN);
  await page.waitForTimeout(250);
  r.emptyCanvas = await page.evaluate(() => ({
    dialogShown: document.getElementById('clearModal').style.display === 'block',
    toast: document.getElementById('toast').textContent,
  }));

  // 2. Image + shapes: both options offered.
  await seedPhoto(page, { name: 't.png', settle: 500 });
  await page.evaluate(() => {
    shapes.push({type:'rect',x:60,y:60,w:200,h:120,rotation:0,color:'#f00',size:5,id:1});
    redraw();
  });
  await page.waitForTimeout(900);
  await page.click(BIN);
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
  await page.click(BIN);
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

  // ---- One bin, two jobs ----
  // The toolbar had a cross for "delete the shape you picked" beside a
  // wastebasket for "clear everything". The wastebasket is the icon a person
  // reaches for to delete the thing they have selected, so the two were the
  // wrong way round and one tap away from each other. Now there is one bin: it
  // takes the selection if there is one, and offers to clear if there is not.
  await page.evaluate(() => { shapes.length = 0; selectedShape = null; });
  await seedPhoto(page, { name: 't.png', settle: 500 });
  await page.evaluate(() => {
    shapes.length = 0;
    shapes.push({type:'rect',x:40,y:40,w:150,h:100,rotation:0,color:'#f00',size:5,id:71});
    shapes.push({type:'rect',x:250,y:60,w:150,h:100,rotation:0,color:'#0f0',size:5,id:72});
    document.querySelector('[data-tool="select"]').click();
    selectedShape = shapes[1];
    redraw(); updateButtonStates();
  });
  await page.waitForTimeout(200);
  r.binWithSelection = await page.evaluate(() => ({
    label: document.querySelector('#clear .btn-label').textContent,
    title: document.getElementById('floatClear').title,
    // Red when it will take the shape you have picked rather than offer to
    // clear: there is no room for a word over the picture.
    armed: document.getElementById('floatClear').classList.contains('armed'),
  }));
  await page.click(BIN);
  await page.waitForTimeout(250);
  r.binTakesSelection = await page.evaluate(() => ({
    left: shapes.map(s => s.id),
    dialogShown: document.getElementById('clearModal').style.display === 'block',
    // Removing one shape is a single undo step, like any other change.
    undoable: undoStack.length > 0,
  }));

  // If the bin offered the dialog instead of taking the selection, get out of
  // it before carrying on - a modal over the toolbar swallows the next tap.
  await page.evaluate(() => closeClearOptions());
  await page.waitForTimeout(200);

  r.binWithoutSelection = await page.evaluate(() => ({
    label: document.querySelector('#clear .btn-label').textContent,
    title: document.getElementById('floatClear').title,
    // Red when it will take the shape you have picked rather than offer to
    // clear: there is no room for a word over the picture.
    armed: document.getElementById('floatClear').classList.contains('armed'),
  }));
  await page.click(BIN);
  await page.waitForTimeout(250);
  r.binOffersClear = await page.evaluate(() => ({
    dialogShown: document.getElementById('clearModal').style.display === 'block',
    stillThere: shapes.length,
  }));
  await page.evaluate(() => closeClearOptions());
  await page.waitForTimeout(150);

  // The cross is gone: two destructive buttons side by side, with the more
  // dangerous one wearing the icon that means the safer thing.
  r.noSeparateDeleteButton = await page.evaluate(() =>
    document.getElementById('delete') === null);

  // ---- A torn edge is an annotation ----
  // Tearing an edge is a mark made on the picture, like drawing on it: it is an
  // undo step like any other and it travels in the document. "Drawing only"
  // took the shapes and left the rips behind, so the only way to put a torn
  // page back was to clear the image with it and open the picture again. A
  // picture whose only annotation was a tear had it worse: it reported "no
  // annotations" and offered nothing but Everything.
  await resetApp(page, 600);
  await seedPhoto(page, { name: 't.png', settle: 500 });
  await page.evaluate(() => {
    shapes.push({type:'rect',x:60,y:60,w:200,h:120,rotation:0,color:'#f00',size:5,id:81});
    toggleTearEdge('top');
    toggleTearEdge('left');
    redraw(); updateButtonStates();
  });
  await page.waitForTimeout(300);
  await page.click(BIN);
  await page.waitForTimeout(250);
  r.withTear = await page.evaluate(() => ({
    summary: document.getElementById('clearSummary').textContent,
    shapesOptionEnabled: !document.getElementById('clearShapesBtn').disabled,
  }));
  await page.click('#clearShapesBtn');
  await page.waitForTimeout(400);
  r.afterClearWithTear = await page.evaluate(() => ({
    shapes: shapes.length,
    torn: [tear.top, tear.right, tear.bottom, tear.left],
    // The rip settings are not the annotation: how deep a tear goes and the
    // shape it rips in are still what they were, ready for the next one.
    depth: tear.depth,
    hasImage: !!img,
    canvas: [canvas.width, canvas.height],
    // The edge buttons have to say what the document says, or the next press
    // on one turns the edge it already shows as off.
    edgeButtonsLit: ['top','right','bottom','left']
      .filter(e => document.getElementById('tear-' + e).classList.contains('active')),
  }));

  // One step, so one undo brings the drawing and the rips back together.
  await page.evaluate(() => undoLastAction());
  await page.waitForTimeout(300);
  r.undoBringsBothBack = await page.evaluate(() => ({
    shapes: shapes.length,
    torn: [tear.top, tear.right, tear.bottom, tear.left],
  }));

  // A torn page with nothing drawn on it is still a page with something to
  // clear, and saying so is the whole of what the dialog is for.
  await page.evaluate(() => { shapes.length = 0; selectedShape = null; redraw(); updateButtonStates(); });
  await page.waitForTimeout(200);
  await page.click(BIN);
  await page.waitForTimeout(250);
  r.tearOnly = await page.evaluate(() => ({
    summary: document.getElementById('clearSummary').textContent,
    shapesOptionEnabled: !document.getElementById('clearShapesBtn').disabled,
    allOptionEnabled: !document.getElementById('clearAllBtn').disabled,
  }));
  // Tolerant of a disabled button on purpose: when the option is not offered
  // the failure belongs in the report, next to the state that explains it,
  // rather than as a thirty-second timeout with the rest of the suite unrun.
  await page.click('#clearShapesBtn', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  r.afterClearTearOnly = await page.evaluate(() => ({
    torn: [tear.top, tear.right, tear.bottom, tear.left],
    hasImage: !!img,
  }));

  r.errors = realErrors(errors);
  finish(r, {
    'withTear.summary': '1 shape and 2 torn edges on an image.',
    'withTear.shapesOptionEnabled': isTrue,
    'afterClearWithTear.shapes': 0,
    'afterClearWithTear.torn': [false, false, false, false],
    'afterClearWithTear.depth': 16,
    'afterClearWithTear.hasImage': isTrue,
    'afterClearWithTear.canvas': [800, 500],
    'afterClearWithTear.edgeButtonsLit': isEmpty,
    'undoBringsBothBack.shapes': 1,
    'undoBringsBothBack.torn': [true, false, false, true],
    'tearOnly.summary': '2 torn edges on an image.',
    'tearOnly.shapesOptionEnabled': isTrue,
    'tearOnly.allOptionEnabled': isTrue,
    'afterClearTearOnly.torn': [false, false, false, false],
    'afterClearTearOnly.hasImage': isTrue,

    'binWithSelection.armed': isTrue,
    'binWithoutSelection.armed': isFalse,
    'binWithSelection.label': 'Delete',
    'binWithSelection.title': v => /selected/i.test(v),
    'binTakesSelection.left': [71],
    'binTakesSelection.dialogShown': isFalse,
    'binTakesSelection.undoable': isTrue,
    'binWithoutSelection.label': 'Clear',
    'binOffersClear.dialogShown': isTrue,
    'binOffersClear.stillThere': 1,
    'noSeparateDeleteButton': isTrue,
    'emptyCanvas.dialogShown': isFalse,
    'emptyCanvas.toast': 'Nothing to clear',
    'withBoth.dialogShown': isTrue,
    'withBoth.summary': '1 shape on an image.',
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
