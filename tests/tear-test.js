// A torn page: the rip takes its strip out of the picture rather than painting
// over it, so what is torn away is gone from the export too. These check that
// the strip really is empty, that the rest of the picture is untouched, and
// that a tear is a change to the document like any other - undoable, saved,
// and not left behind in the bitmap the export takes.
const { open, realErrors } = require('./harness');
const { finish, isTrue, isFalse, isEmpty, atLeast } = require('./expect');

(async () => {
  const { browser, page, errors } = await open({ viewport: { width: 1440, height: 900 }, resetSettle: 400 });

  // A flat opaque image, so any transparency in it was torn there.
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 800;
    const g = c.getContext('2d');
    g.fillStyle = '#4477aa'; g.fillRect(0, 0, c.width, c.height);
    const image = new Image();
    await new Promise(res => { image.onload = res; image.src = c.toDataURL(); });
    img = image; imgOffset = { x: 0, y: 0 }; canvasOverride = null;
    resizeCanvas(); updateImageInfo();
    // Stored the way loading a file stores it, so the reload below restores a
    // real picture rather than falling back to a blank canvas.
    await storeImageBlob(await new Promise(res => c.toBlob(res, 'image/png')));
  });
  await page.waitForTimeout(200);

  // Counting rather than sampling one spot: a rip wanders, so how deep it bites
  // at any single x is not something to pin a test to. What must hold is that
  // most of an edge went and none of the middle did.
  await page.addInitScript(() => {});
  const measure = () => page.evaluate(() => {
    const W = canvas.width, H = canvas.height;
    const depth = fitPxToCanvas(tear.depth);
    const gone = (data) => {
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] < 40) n++;
      return n;
    };
    const span = Math.round(W * 0.6);
    const from = Math.round(W * 0.2);
    const tall = Math.round(H * 0.6);
    const top = Math.round(H * 0.2);
    return {
      width: W, height: H, depth: Math.round(depth),
      span, tall,
      bottomRowGone: gone(ctx.getImageData(from, H - 1, span, 1).data),
      topRowGone: gone(ctx.getImageData(from, 0, span, 1).data),
      leftColGone: gone(ctx.getImageData(0, top, 1, tall).data),
      rightColGone: gone(ctx.getImageData(W - 1, top, 1, tall).data),
      // Well inside the deepest the rip can reach: nothing here may be missing.
      insideGone: gone(ctx.getImageData(0, H - 1 - Math.ceil(depth * 1.5), W, 1).data),
      centreAlpha: ctx.getImageData(W / 2, H / 2, 1, 1).data[3],
    };
  });

  const r = {};
  r.beforeTool = await measure();

  // Picking the tool tears the bottom edge, so the tool shows what it does.
  await page.evaluate(() => document.querySelector('[data-tool="tear"]').click());
  await page.waitForTimeout(250);
  r.controlsShown = await page.evaluate(() =>
    document.getElementById('tearGroup').classList.contains('visible'));
  r.bottomOnByDefault = await page.evaluate(() => tear.bottom === true);
  r.afterTool = await measure();

  // The grips are interface, not picture: an export taken with the tool active
  // must not carry them. Sampled at the centre of the top grip, which sits over
  // untorn image.
  r.exported = await page.evaluate(async () => {
    const grip = tearGrip('top');
    const at = { x: Math.round(grip.x + grip.w / 2), y: Math.round(grip.y + grip.h / 2) };
    const blob = await new Promise(res => withCleanCanvas(() => canvas.toBlob(res, 'image/png')));
    const bmp = await createImageBitmap(blob);
    const t = document.createElement('canvas');
    t.width = bmp.width; t.height = bmp.height;
    const g = t.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(at.x, at.y, 1, 1).data;
    let gone = 0;
    const row = g.getImageData(Math.round(bmp.width * 0.2), bmp.height - 1,
                               Math.round(bmp.width * 0.6), 1).data;
    for (let i = 3; i < row.length; i += 4) if (row[i] < 40) gone++;
    return {
      size: [bmp.width, bmp.height],
      overGrip: `rgb(${px[0]},${px[1]},${px[2]})`,
      bottomRowGone: gone,
    };
  });

  // Each edge is its own. Tearing the left must not touch the right.
  await page.click('#tear-left');
  await page.waitForTimeout(200);
  r.afterLeft = await measure();
  r.leftButtonActive = await page.evaluate(() =>
    document.getElementById('tear-left').classList.contains('active'));

  // Deeper bites further in.
  const depthAt = async (value) => {
    await page.evaluate(v => {
      const el = document.getElementById('tearDepth');
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    await page.waitForTimeout(200);
    return page.evaluate(() => {
      const W = canvas.width, H = canvas.height;
      const data = ctx.getImageData(0, 0, W, H).data;
      // How far up the rip has eaten, at its deepest. Read across the middle
      // only: at the very edges the left-hand tear has taken the whole column
      // and there is no picture left to measure down to.
      let deepest = 0;
      for (let x = Math.round(W * 0.25); x < W * 0.75; x += 3) {
        for (let y = H - 1; y >= 0; y--) {
          if (data[(y * W + x) * 4 + 3] >= 250) { deepest = Math.max(deepest, H - 1 - y); break; }
        }
      }
      return deepest;
    });
  };
  r.shallowBite = await depthAt(6);
  r.deepBite = await depthAt(40);
  r.deeperThanShallow = r.deepBite > r.shallowBite + 10;

  // Tearing is a change to the picture, so undo takes it back.
  await page.evaluate(() => { document.getElementById('tear-top').click(); });
  await page.waitForTimeout(200);
  const topTorn = await page.evaluate(() => tear.top === true);
  await page.evaluate(() => document.getElementById('undo').click());
  await page.waitForTimeout(200);
  r.undo = { torn: topTorn, afterUndo: await page.evaluate(() => tear.top === false) };

  // It belongs to the document, not to the tool: switching away keeps it, and
  // so does a reload.
  await page.evaluate(() => document.querySelector('[data-tool="select"]').click());
  await page.waitForTimeout(200);
  r.keptAfterToolChange = await page.evaluate(() => tear.bottom === true && tear.left === true);
  r.gripsGoneWithTool = await page.evaluate(() => {
    const grip = tearGrip('top');
    const px = ctx.getImageData(Math.round(grip.x + grip.w / 2),
                                Math.round(grip.y + grip.h / 2), 1, 1).data;
    return `rgb(${px[0]},${px[1]},${px[2]})`;
  });

  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForTimeout(900);
  r.afterReload = await page.evaluate(() => ({
    bottom: tear.bottom, left: tear.left, top: tear.top,
    depth: tear.depth,
    restoredImage: !!img,
    // The controls have to come back saying what the document says.
    leftButtonActive: document.getElementById('tear-left').classList.contains('active'),
  }));
  r.reloadedShape = await measure();

  r.errors = realErrors(errors);
  // ---- The outline must not cross itself ----
  // Reported from a phone with all four edges torn deeply: little flaps at the
  // corners, "wrapping over themselves". A corner is bitten once and shared by
  // the two edges that meet there, but each edge was still free to start at
  // whatever depth its noise happened to give it - so the top edge began 27
  // units below the corner while the left edge ended 46 to the right of it,
  // and the line closing that gap crossed back over the edge beside it. The
  // fill rule then painted the sliver outside the page as if it were paper.
  //
  // Random by nature, so this asks several seeds and every depth the slider
  // offers rather than the one case that was reported.
  r.outlineSimple = await page.evaluate(() => {
    // Do two segments cross? Endpoints shared by neighbours do not count, so
    // only pairs that are not adjacent are compared.
    // Strictly crossing: a segment that merely touches another's endpoint is
    // two edges meeting at the corner they share, which is the whole point.
    const cross = (p, p2, q, q2) => {
      const d = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      const d1 = d(p, p2, q), d2 = d(p, p2, q2), d3 = d(q, q2, p), d4 = d(q, q2, p2);
      return d1 * d2 < 0 && d3 * d4 < 0;
    };
    const outline = () => {
      const depth = Math.max(1, fitPxToCanvas(tear.depth));
      const corners = tearCorners(depth);
      const pts = [];
      const same = (a, b) => a && Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
      ['top', 'right', 'bottom', 'left'].forEach((e, i) => {
        for (const q of tearEdgePoints(e, corners, depth, i)) {
          // Where two edges meet they now hand over at the same point, which
          // would otherwise leave a zero-length segment for the test to argue
          // with.
          if (!same(pts[pts.length - 1], q)) pts.push(q);
        }
      });
      if (same(pts[pts.length - 1], pts[0])) pts.pop();
      return pts;
    };
    const worst = [];
    let crossings = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const depth of [4, 16, 32, 48]) {
        tear = { top: true, right: true, bottom: true, left: true, depth, seed };
        tearCache = null;
        const pts = outline();
        const n = pts.length;
        let here = 0;
        for (let i = 0; i < n; i++) {
          for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue;   // the closing segment's own ends
            if (cross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) here++;
          }
        }
        crossings += here;
        if (here) worst.push(`seed ${seed} depth ${depth}: ${here}`);
      }
    }
    return { crossings, worst: worst.slice(0, 6) };
  });

  finish(r, {
    'outlineSimple.crossings': 0,
    'outlineSimple.worst': isEmpty,
    // Nothing torn to begin with.
    'beforeTool.bottomRowGone': 0,
    'beforeTool.centreAlpha': 255,
    'controlsShown': isTrue,
    'bottomOnByDefault': isTrue,
    // Most of the bottom edge went, and only the bottom edge.
    'afterTool.bottomRowGone': atLeast(300),
    'afterTool.topRowGone': 0,
    'afterTool.leftColGone': 0,
    'afterTool.rightColGone': 0,
    'afterTool.insideGone': 0,
    'afterTool.centreAlpha': 255,
    // The saved PNG is the same picture, at full size, with no grips in it.
    'exported.size': [1000, 800],
    'exported.overGrip': 'rgb(68,119,170)',
    'exported.bottomRowGone': atLeast(300),
    'leftButtonActive': isTrue,
    'afterLeft.leftColGone': atLeast(200),
    'afterLeft.rightColGone': 0,
    'afterLeft.centreAlpha': 255,
    'deeperThanShallow': isTrue,
    'undo.torn': isTrue,
    'undo.afterUndo': isTrue,
    'keptAfterToolChange': isTrue,
    'gripsGoneWithTool': 'rgb(68,119,170)',
    'afterReload.bottom': isTrue,
    'afterReload.left': isTrue,
    'afterReload.top': isFalse,
    // The depth the slider was left at, not the default.
    'afterReload.depth': 40,
    'afterReload.restoredImage': isTrue,
    'afterReload.leftButtonActive': isTrue,
    'reloadedShape.bottomRowGone': atLeast(300),
    'reloadedShape.centreAlpha': 255,
    'errors': isEmpty,
  });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
