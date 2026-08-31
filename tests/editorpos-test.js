// Where the text editors land on screen.
//
// The three editors - the callout/text-block editor, its Done/Cancel bar, and
// the single-line label editor - are absolutely positioned children of
// `.canvas-container`, but their left and top are worked out from the canvas:
// `shape.x * toScreen`. The container centres the canvas inside itself, so the
// two origins are not the same point, and everything was placed by the width of
// whatever gap the centring left. On a 1512px window round a 990px picture the
// editor opened 261px to the left of the callout it belonged to.
//
// Nothing caught it because no suite had ever measured where an editor landed.
// Every assertion about the editor was about its state - is it open, what does
// it contain, what font size did it get - and all of those pass with the box
// sitting anywhere on the page. This one asserts the geometry, which is the
// only thing that was ever wrong.
//
// The gap only opens when the picture does not fill its container, so the
// window and the photo here are deliberately mismatched: a tall picture in a
// wide window, which insets the canvas on both sides. A suite that loads a
// landscape photo on a phone - which is what the editor suites do - sees a gap
// of nearly nothing and goes green either way.
const { open, realErrors } = require('./harness');
const { finish, isTrue, near, isEmpty } = require('./expect');

(async () => {
  const { browser, page, errors } = await open({ viewport: { width: 1440, height: 900 }, settle: 400 });
  const r = {};

  // A tall picture in a wide window, so the canvas is inset by a wide margin.
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 600; c.height = 800;
    const g = c.getContext('2d');
    g.fillStyle = '#3d6b8f'; g.fillRect(0, 0, c.width, c.height);
    const image = new Image();
    await new Promise(res => { image.onload = res; image.src = c.toDataURL(); });
    img = image; imgOffset = { x: 0, y: 0 }; canvasOverride = null; resizeCanvas();
  });
  await page.waitForTimeout(300);

  // The gap the bug is made of. If this is small the suite is not testing
  // anything, so it is asserted rather than assumed.
  r.canvasIsInset = await page.evaluate(() => {
    const cv = canvas.getBoundingClientRect();
    const co = document.querySelector('.canvas-container').getBoundingClientRect();
    return { x: Math.round(cv.x - co.x), y: Math.round(cv.y - co.y) };
  });

  // Every editor is asked the same question: does your top-left corner sit on
  // the shape you are editing? Measured against the canvas's own box, which
  // already carries any zoom or pan, so one rule holds at every zoom.
  const errorFor = (elId, cx, cy) => page.evaluate(({ elId, cx, cy }) => {
    const cv = canvas.getBoundingClientRect();
    const k = cv.width / canvas.width;
    const box = document.getElementById(elId).getBoundingClientRect();
    return {
      x: Math.round(box.x - (cv.x + cx * k)),
      y: Math.round(box.y - (cv.y + cy * k)),
    };
  }, { elId, cx, cy });

  const callout = { type: 'callout', x: 150, y: 200, w: 300, h: 120, text: '', color: '#c00',
    size: 3, fill: true, fillColor: '#fff', fontSize: 16, fontFamily: 'sans-serif',
    fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left', endStyle: 'closedArrow',
    rotation: 0, tipX: 450, tipY: 600 };

  // ---- The callout editor sits on the callout ----
  await page.evaluate(s => {
    shapes.length = 0;
    shapes.push({ ...s, id: newShapeId() });
    redraw();
    startBlockEditing(shapes[0]);
  }, callout);
  await page.waitForTimeout(250);
  r.calloutEditor = await errorFor('calloutTextInput', callout.x, callout.y);
  // The bar is measured against the editor rather than against the shape. It
  // hangs 8px under whatever the editor turned out to be, and the shape is the
  // wrong reference for it: opening the editor on an empty callout reflows the
  // box, so the h passed in here is not the h it ends up with.
  //
  // This says nothing about the displacement on its own - both boxes moved by
  // the same 420px, so it held while the bug was live. It is here to catch the
  // bar coming adrift of the editor, which the assertion above cannot see.
  r.calloutBar = await page.evaluate(() => {
    const ed = calloutTextInput.getBoundingClientRect();
    const bar = document.getElementById('blockEditBar').getBoundingClientRect();
    return { x: Math.round(bar.x - ed.x), gapUnderEditor: Math.round(bar.y - ed.bottom) };
  });
  await page.evaluate(() => finishBlockEditing(true));
  await page.waitForTimeout(200);

  // ---- The text-block editor sits on the block ----
  const block = { type: 'text', x: 120, y: 420, w: 260, h: 0, text: 'Block', color: '#0a0',
    size: 3, fontSize: 16, fontFamily: 'sans-serif', fontWeight: 'normal',
    fontStyle: 'normal', textAlign: 'left', rotation: 0 };
  await page.evaluate(s => {
    shapes.length = 0;
    shapes.push({ ...s, id: newShapeId() });
    ensureBlockWidth(shapes[0]);
    redraw();
    startBlockEditing(shapes[0]);
  }, block);
  await page.waitForTimeout(250);
  r.blockEditor = await errorFor('calloutTextInput', block.x, block.y);
  await page.evaluate(() => finishBlockEditing(true));
  await page.waitForTimeout(200);

  // ---- The label editor sits on the shape it labels ----
  // It is placed from the shape's centre and lifted 15px, so that is what it is
  // measured against.
  const boxShape = { type: 'rect', x: 180, y: 500, w: 240, h: 160, rotation: 0,
    color: '#c00', size: 4 };
  await page.evaluate(s => {
    shapes.length = 0;
    shapes.push({ ...s, id: newShapeId() });
    redraw();
    startLabelEditing(shapes[0]);
  }, boxShape);
  await page.waitForTimeout(250);
  r.labelEditor = await errorFor('canvasTextInput',
    boxShape.x + boxShape.w / 2, boxShape.y + boxShape.h / 2);
  await page.evaluate(() => finishLabelEditing());
  await page.waitForTimeout(200);

  r.errors = realErrors(errors);
  finish(r, {
    // Without a real inset this suite proves nothing.
    'canvasIsInset.x': v => typeof v === 'number' && v > 100,
    'calloutEditor.x': near(0, 2),
    'calloutEditor.y': near(0, 2),
    'calloutBar.x': near(0, 2),
    'calloutBar.gapUnderEditor': near(8, 3),
    'blockEditor.x': near(0, 2),
    'blockEditor.y': near(0, 2),
    'labelEditor.x': near(0, 2),
    'labelEditor.y': near(-15, 3),
    'errors': isEmpty,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
