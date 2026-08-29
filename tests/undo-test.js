// Undo used to be shapes.pop(): it removed the most recently added shape
// whatever you had actually just done, so undo after moving a box deleted a
// different box, and a move, a resize, a text edit or a delete could not be
// undone at all. These check that each kind of change is a step of its own.
const { open } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';

(async () => {
  const { browser, page, errors } = await open({ viewport: { width: 1440, height: 900 }, resetSettle: 400 });
  const r = {};

  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 700;
    const g = c.getContext('2d'); g.fillStyle = '#456'; g.fillRect(0, 0, c.width, c.height);
    const image = new Image();
    await new Promise(res => { image.onload = res; image.src = c.toDataURL(); });
    img = image; resizeCanvas(); updateImageInfo();
  });
  await page.waitForTimeout(200);

  const box = await page.evaluate(() => {
    const b = canvas.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const toScreen = await page.evaluate(() => {
    const b = canvas.getBoundingClientRect();
    return b.width / canvas.width;
  });
  const at = (cx, cy) => ({ x: box.x + cx * toScreen, y: box.y + cy * toScreen });
  const dragMouse = async (from, to) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  };

  r.undoDisabledAtStart = await page.evaluate(() =>
    document.getElementById('undo').disabled);

  // Draw two rectangles.
  await page.evaluate(() => document.querySelector('[data-tool="rect"]').click());
  await dragMouse(at(100, 100), at(300, 250));
  await dragMouse(at(500, 100), at(700, 250));
  r.afterDrawing = await page.evaluate(() => ({
    shapes: shapes.length,
    undoEnabled: !document.getElementById('undo').disabled,
    steps: undoStack.length,
  }));

  // Move the first one. Undo must put it back, not delete the second.
  await page.evaluate(() => {
    document.querySelector('[data-tool="select"]').click();
    selectedShape = shapes[0]; redraw(); updateButtonStates();
  });
  const firstBefore = await page.evaluate(() => ({ x: shapes[0].x, y: shapes[0].y, id: shapes[0].id }));
  await dragMouse(at(200, 175), at(260, 235));
  r.afterMove = await page.evaluate(b => ({
    moved: Math.abs(shapes[0].x - b.x) > 20,
    shapes: shapes.length,
  }), firstBefore);

  await page.evaluate(() => undoLastAction());
  await page.waitForTimeout(150);
  r.undoOfMove = await page.evaluate(b => ({
    // The decisive one: the move is reversed and both shapes survive.
    backWhereItWas: Math.abs(shapes[0].x - b.x) < 1 && Math.abs(shapes[0].y - b.y) < 1,
    shapes: shapes.length,
    secondSurvived: shapes.length === 2 && shapes[1] !== undefined,
  }), firstBefore);

  // A selection press that changes nothing must not consume a step.
  const stepsBeforeIdlePress = await page.evaluate(() => undoStack.length);
  await page.mouse.click(at(600, 175).x, at(600, 175).y);
  await page.waitForTimeout(150);
  r.idlePressCostsNothing = await page.evaluate(
    n => undoStack.length === n, stepsBeforeIdlePress);

  // Resize.
  await page.evaluate(() => {
    document.querySelector('[data-tool="select"]').click();
    selectedShape = shapes[0]; redraw(); updateButtonStates();
  });
  const wBefore = await page.evaluate(() => shapes[0].w);
  const handle = await page.evaluate(() => {
    const h = getResizeHandles(shapes[0]).find(g => g.type === 'se' || g.type === 'bottom-right')
      || getResizeHandles(shapes[0])[0];
    const b = canvas.getBoundingClientRect(); const k = canvas.width / b.width;
    return { x: b.x + h.x / k, y: b.y + h.y / k };
  });
  await dragMouse(handle, { x: handle.x + 80, y: handle.y + 60 });
  const wAfter = await page.evaluate(() => shapes[0].w);
  await page.evaluate(() => undoLastAction());
  await page.waitForTimeout(150);
  r.undoOfResize = await page.evaluate(w => ({
    changed: true,
    restored: Math.abs(shapes[0].w - w) < 1,
  }), wBefore);
  r.resizeDidChange = Math.abs(wAfter - wBefore) > 5;

  // Delete.
  await page.evaluate(() => {
    document.querySelector('[data-tool="select"]').click();
    selectedShape = shapes[0]; updateButtonStates();
    deleteSelectedShape();
  });
  await page.waitForTimeout(150);
  const afterDelete = await page.evaluate(() => shapes.length);
  await page.evaluate(() => undoLastAction());
  await page.waitForTimeout(150);
  r.undoOfDelete = { afterDelete, afterUndo: await page.evaluate(() => shapes.length) };

  // A text edit.
  await page.evaluate(() => {
    shapes.length = 0;
    shapes.push({ type: 'callout', x: 100, y: 100, w: 300, h: 60, text: 'Original',
      color: '#c00', size: 3, fill: true, fillColor: '#fff', fontSize: 16,
      fontFamily: 'sans-serif', fontWeight: 'normal', fontStyle: 'normal',
      textAlign: 'left', endStyle: 'closedArrow', rotation: 0, tipX: 500, tipY: 400,
      id: newShapeId() });
    undoStack.length = 0;
    selectedShape = shapes[0]; redraw(); updateButtonStates();
  });
  await page.evaluate(() => startBlockEditing(shapes[0]));
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const el = document.getElementById('calloutTextInput');
    el.value = 'Rewritten'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => finishBlockEditing(false));
  await page.waitForTimeout(200);
  const editedText = await page.evaluate(() => shapes[0].text);
  await page.evaluate(() => undoLastAction());
  await page.waitForTimeout(150);
  r.undoOfTextEdit = { edited: editedText, afterUndo: await page.evaluate(() => shapes[0] && shapes[0].text) };

  // A property change: one step for the adjustment, not one per input event.
  await page.evaluate(() => { undoStack.length = 0; selectedShape = shapes[0]; updateButtonStates(); });
  const colourBefore = await page.evaluate(() => shapes[0].color);
  await page.evaluate(() => {
    const el = document.getElementById('color');
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    for (const v of ['#111111', '#222222', '#00aa00']) {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  r.colourChange = await page.evaluate(c => ({
    applied: shapes[0].color === '#00aa00',
    // Three input events while dragging the picker, one undo step.
    steps: undoStack.length,
    wasDifferent: c !== '#00aa00',
  }), colourBefore);
  await page.evaluate(() => undoLastAction());
  await page.waitForTimeout(150);
  r.undoOfColour = await page.evaluate(c => shapes[0].color === c, colourBefore);

  // The stack is bounded.
  r.stackIsBounded = await page.evaluate(() => {
    undoStack.length = 0;
    for (let i = 0; i < UNDO_LIMIT + 15; i++) {
      beginUndo();
      shapes.push({ type: 'rect', x: i, y: i, w: 10, h: 10, rotation: 0,
        color: '#fff', size: 1, id: newShapeId() });
      commitUndo();
    }
    return undoStack.length <= UNDO_LIMIT;
  });

  // Undoing back past the start must stop cleanly, not throw.
  r.undoPastStart = await page.evaluate(() => {
    for (let i = 0; i < UNDO_LIMIT + 30; i++) undoLastAction();
    return { steps: undoStack.length, disabled: document.getElementById('undo').disabled };
  });

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  finish(r, {
    'undoDisabledAtStart': isTrue,
    'afterDrawing.shapes': 2,
    'afterDrawing.undoEnabled': isTrue,
    'afterDrawing.steps': 2,
    'afterMove.moved': isTrue,
    'afterMove.shapes': 2,
    'undoOfMove.backWhereItWas': isTrue,
    'undoOfMove.shapes': 2,
    'idlePressCostsNothing': isTrue,
    'resizeDidChange': isTrue,
    'undoOfResize.restored': isTrue,
    'undoOfDelete.afterDelete': 1,
    'undoOfDelete.afterUndo': 2,
    'undoOfTextEdit.edited': 'Rewritten',
    'undoOfTextEdit.afterUndo': 'Original',
    'colourChange.applied': isTrue,
    'colourChange.wasDifferent': isTrue,
    'colourChange.steps': 1,
    'undoOfColour': isTrue,
    'stackIsBounded': isTrue,
    'undoPastStart.steps': 0,
    'undoPastStart.disabled': isTrue,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
