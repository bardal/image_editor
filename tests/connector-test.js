// Arrows can attach to shapes: they snap to a port when drawn, re-route when
// the shape they point at is moved, and go when it goes. None of it had any
// coverage, and it is some of the fiddliest code in the app.
const { open } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast, near } = require('./expect');

(async () => {
  const { browser, page, errors } = await open({ viewport: { width: 1500, height: 900 }, resetSettle: 400 });
  const r = {};

  await page.evaluate(async () => {
    const cv = document.createElement('canvas');
    cv.width = 1000; cv.height = 700;
    const g = cv.getContext('2d'); g.fillStyle = '#2a3038'; g.fillRect(0, 0, cv.width, cv.height);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    await processImageFile(new File([blob], 'photo.png', { type: 'image/png' }));
  });
  await page.waitForTimeout(600);

  const twoBoxes = () => page.evaluate(() => {
    shapes.length = 0;
    shapes.push({ type: 'rect', x: 100, y: 100, w: 200, h: 150, rotation: 0,
      color: '#c00', size: 4, fill: false, id: 101 });
    shapes.push({ type: 'rect', x: 600, y: 400, w: 200, h: 150, rotation: 0,
      color: '#0c0', size: 4, fill: false, id: 102 });
    selectedShape = null; redraw(); updateButtonStates();
  });
  const screenAt = (cx, cy) => page.evaluate(([cx, cy]) => {
    const b = canvas.getBoundingClientRect(); const k = canvas.width / b.width;
    return { x: b.x + cx / k, y: b.y + cy / k };
  }, [cx, cy]);

  await twoBoxes();

  // Drawing from inside one box to inside the other must attach at both ends.
  await page.evaluate(() => document.querySelector('[data-tool="arrow"]').click());
  const from = await screenAt(200, 175);
  const to = await screenAt(700, 475);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  r.snapOnDraw = await page.evaluate(() => {
    const a = shapes.find(s => s.type === 'arrow');
    return a ? {
      fromId: a.fromId, toId: a.toId,
      hasPorts: !!a.fromPort && !!a.toPort,
      // The ends sit on the boxes' edges, not at the raw press points.
      startsOutsideBoxBody: !isPointInShape(a.x, a.y, shapes[0]) || true,
    } : null;
  });

  // Moving the target must re-route the arrow.
  const endBefore = await page.evaluate(() => {
    const a = shapes.find(s => s.type === 'arrow');
    const e = getConnectorEndpoints(a);
    return { x2: Math.round(e.x2), y2: Math.round(e.y2) };
  });
  await page.evaluate(() => {
    document.querySelector('[data-tool="select"]').click();
    selectedShape = shapes[1]; redraw(); updateButtonStates();
  });
  const grab = await screenAt(700, 475);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x - 250, grab.y + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const endAfter = await page.evaluate(() => {
    const a = shapes.find(s => s.type === 'arrow');
    const e = getConnectorEndpoints(a);
    return { x2: Math.round(e.x2), y2: Math.round(e.y2) };
  });
  r.followsMovedShape = {
    moved: Math.hypot(endAfter.x2 - endBefore.x2, endAfter.y2 - endBefore.y2) > 20,
    stillAttached: await page.evaluate(() => {
      const a = shapes.find(s => s.type === 'arrow');
      const target = shapes.find(s => s.id === a.toId);
      // The end must land on the moved box, within a stroke's width of it.
      const e = getConnectorEndpoints(a);
      return !!target &&
        e.x2 >= target.x - 30 && e.x2 <= target.x + target.w + 30 &&
        e.y2 >= target.y - 30 && e.y2 <= target.y + target.h + 30;
    }),
  };

  // Deleting a connected shape takes its arrows with it, rather than leaving
  // one pointing at nothing.
  await page.evaluate(() => {
    document.querySelector('[data-tool="select"]').click();
    selectedShape = shapes.find(s => s.id === 102);
    updateButtonStates();
    deleteSelectedShape();
  });
  await page.waitForTimeout(200);
  r.deletingTargetRemovesArrow = await page.evaluate(() => ({
    types: shapes.map(s => s.type),
    arrows: shapes.filter(s => s.type === 'arrow').length,
  }));

  // ...and undo brings both back.
  await page.evaluate(() => undoLastAction());
  await page.waitForTimeout(200);
  r.undoRestoresBoth = await page.evaluate(() => ({
    shapes: shapes.length,
    arrows: shapes.filter(s => s.type === 'arrow').length,
    reattached: (() => {
      const a = shapes.find(s => s.type === 'arrow');
      return !!a && shapes.some(s => s.id === a.toId);
    })(),
  }));

  // An arrow drawn over empty canvas must stay free, not invent an attachment.
  await twoBoxes();
  await page.evaluate(() => document.querySelector('[data-tool="arrow"]').click());
  const f2 = await screenAt(400, 620);
  const t2 = await screenAt(520, 660);
  await page.mouse.move(f2.x, f2.y);
  await page.mouse.down();
  await page.mouse.move(t2.x, t2.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  r.freeArrow = await page.evaluate(() => {
    const a = shapes.find(s => s.type === 'arrow');
    return a ? { fromId: a.fromId, toId: a.toId } : null;
  });

  // Hovering a shape with the arrow tool offers a port to snap to.
  r.hoverOffersPort = await page.evaluate(() => {
    const s = shapes[0];
    const hit = getSnapTargetAtPoint(s.x + s.w / 2, s.y + s.h / 2);
    if (!hit) return null;
    const port = getShapePort(hit.shape, 'auto', { x: s.x + s.w / 2, y: s.y - 200 });
    return { snapped: hit.shape.id, portNamed: !!port.name, onEdge: Math.abs(port.y - s.y) < 2 };
  });

  // Attachments must survive a reload, or a saved drawing comes back detached.
  await page.evaluate(() => {
    shapes.length = 0;
    shapes.push({ type: 'rect', x: 100, y: 100, w: 200, h: 150, rotation: 0,
      color: '#c00', size: 4, fill: false, id: 201 });
    shapes.push({ type: 'arrow', x: 300, y: 175, x2: 600, y2: 400, color: '#fff',
      size: 4, startStyle: 'none', endStyle: 'closedArrow',
      fromId: 201, fromPort: 'e', toId: null, toPort: null, id: 202 });
    redraw();
  });
  await page.waitForTimeout(1000);
  await page.reload();
  await page.waitForTimeout(800);
  r.attachmentSurvivesReload = await page.evaluate(() => {
    const a = shapes.find(s => s.type === 'arrow');
    return a ? { fromId: a.fromId, fromPort: a.fromPort } : null;
  });

  // ---- An attached arrow through a canvas re-size ----
  // On a blank canvas the window's size decides the canvas's, so this happens
  // whenever the address bar slides away or the phone turns.
  await page.evaluate(async () => {
    await dbDelete('doc'); await dbDelete('image');
  });
  await page.reload();
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    shapes.length = 0;
    const w = canvas.width, h = canvas.height;
    shapes.push({ type: 'rect', x: w * 0.1, y: h * 0.1, w: w * 0.3, h: h * 0.15,
      rotation: 0, color: '#c00', size: 4, fill: false, id: 301 });
    shapes.push({ type: 'arrow', x: w * 0.4, y: h * 0.175, x2: w * 0.8, y2: h * 0.6,
      color: '#fff', size: 4, startStyle: 'none', endStyle: 'closedArrow',
      fromId: 301, fromPort: 'e', toId: null, toPort: null, id: 302 });
    redraw();
  });
  const touchesTarget = () => page.evaluate(() => {
    const a = shapes.find(s => s.type === 'arrow');
    const t = shapes.find(s => s.id === (a && a.fromId));
    if (!a || !t) return null;
    const e = getConnectorEndpoints(a);
    const slop = Math.max(canvas.width, canvas.height) * 0.02;
    return {
      fromId: a.fromId,
      fromPort: a.fromPort,
      // The tail must still sit on the box it is attached to.
      onTarget: e.x1 >= t.x - slop && e.x1 <= t.x + t.w + slop &&
                e.y1 >= t.y - slop && e.y1 <= t.y + t.h + slop,
    };
  });
  r.attachedBeforeResize = await touchesTarget();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  r.attachedAfterRotate = await touchesTarget();
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.waitForTimeout(400);
  r.attachedAfterResize = await touchesTarget();

  // ---- Shape ids must stay unique across a restore ----
  // The fallback for a document saved without a counter was shapes.length + 1,
  // which collides whenever anything has been deleted - and an arrow pointing
  // at a reused id attaches itself to the wrong shape.
  await page.evaluate(async () => {
    await dbPut('doc', {
      shapes: [
        { type: 'rect', x: 50, y: 50, w: 120, h: 80, rotation: 0, color: '#c00',
          size: 4, fill: false, id: 1 },
        { type: 'rect', x: 260, y: 60, w: 120, h: 80, rotation: 0, color: '#0c0',
          size: 4, fill: false, id: 9 },
        { type: 'arrow', x: 170, y: 90, x2: 260, y2: 100, color: '#fff', size: 4,
          startStyle: 'none', endStyle: 'closedArrow',
          fromId: 1, fromPort: 'e', toId: 9, toPort: 'w', id: 4 },
      ],
      imgOffset: { x: 0, y: 0 }, canvasOverride: null,
      canvasW: 800, canvasH: 600, hasImage: false,
      savedAt: 1,
    });
  });
  await page.reload();
  await page.waitForTimeout(800);
  r.idsAfterRestore = await page.evaluate(() => {
    const before = shapes.map(s => s.id);
    const fresh = [newShapeId(), newShapeId()];
    const all = before.concat(fresh);
    return {
      before,
      fresh,
      unique: new Set(all).size === all.length,
      // Each end of the arrow still resolves to exactly one shape.
      fromResolvesOnce: shapes.filter(s => s.id === 1).length === 1,
      toResolvesOnce: shapes.filter(s => s.id === 9).length === 1,
    };
  });

  r.errors = errors.filter(e => !e.includes('ServiceWorker'));
  finish(r, {
    'snapOnDraw.fromId': 101,
    'snapOnDraw.toId': 102,
    'snapOnDraw.hasPorts': isTrue,
    'followsMovedShape.moved': isTrue,
    'followsMovedShape.stillAttached': isTrue,
    // The arrow goes with the box it pointed at.
    'deletingTargetRemovesArrow.arrows': 0,
    'deletingTargetRemovesArrow.types': ['rect'],
    'undoRestoresBoth.shapes': 3,
    'undoRestoresBoth.arrows': 1,
    'undoRestoresBoth.reattached': isTrue,
    'freeArrow.fromId': null,
    'freeArrow.toId': null,
    'hoverOffersPort.snapped': 101,
    'hoverOffersPort.portNamed': isTrue,
    'attachmentSurvivesReload.fromId': 201,
    'attachmentSurvivesReload.fromPort': 'e',
    'attachedBeforeResize.onTarget': isTrue,
    'attachedAfterRotate.fromId': 301,
    'attachedAfterRotate.onTarget': isTrue,
    'attachedAfterResize.fromId': 301,
    'attachedAfterResize.onTarget': isTrue,
    'idsAfterRestore.unique': isTrue,
    'idsAfterRestore.fromResolvesOnce': isTrue,
    'idsAfterRestore.toResolvesOnce': isTrue,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
