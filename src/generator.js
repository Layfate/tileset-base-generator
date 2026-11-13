/*
 * Tile renderer.
 *
 * Each tile is drawn on an "extended" grid (the tile plus a margin on every
 * side). The base shape is extrapolated into the margin by clamping, which is
 * exact near tile borders because every boundary crosses a tile edge at a
 * right angle. All noise is periodic with the tile size, so a tile's right
 * edge continues seamlessly into any compatible tile's left edge.
 *
 * Pipeline per tile:
 *   1. binary base shape from the connectivity mask
 *   2. morphological close + open  -> rounded inner / outer corners
 *   3. signed distance field       -> displaced by periodic noise (edge noise)
 *   4. pixel cleanup               -> no stray single pixels
 *   5. elevation wall (optional)   -> rock face under south-facing edges
 *   6. shading                     -> outline, base->edge ramp, texture, flecks
 */
(function (root) {
  'use strict';
  const TBG = (root.TBG = root.TBG || {});
  const BIT = TBG.BIT || { N: 1, NE: 2, E: 4, SE: 8, S: 16, SW: 32, W: 64, NW: 128 };
  const CORNER = TBG.CORNER || { TL: 1, TR: 2, BR: 4, BL: 8 };

  // ---------------------------------------------------------------- random

  function hash2(x, y, seed) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    h ^= h >>> 16;
    h = Math.imul(h, 2654435761);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  const mod = (a, n) => ((a % n) + n) % n;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /** Value noise in [0,1] that repeats every `period` pixels on both axes. */
  function periodicNoise(period, cell, seed) {
    const k = Math.max(1, Math.round(period / Math.max(0.5, cell)));
    const step = period / k;
    return function (x, y) {
      const fx = x / step;
      const fy = y / step;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      let tx = fx - x0;
      let ty = fy - y0;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const xa = mod(x0, k), xb = mod(x0 + 1, k);
      const ya = mod(y0, k), yb = mod(y0 + 1, k);
      return lerp(
        lerp(hash2(xa, ya, seed), hash2(xb, ya, seed), tx),
        lerp(hash2(xa, yb, seed), hash2(xb, yb, seed), tx),
        ty
      );
    };
  }

  // ------------------------------------------------- euclidean distance

  const INF = 1e20;

  function edt1d(f, n, d, v, z) {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      d[q] = dq * dq + f[v[k]];
    }
  }

  /** Squared distance from every cell to the nearest cell whose value === target. */
  function edt(grid, w, h, target) {
    const out = new Float64Array(w * h);
    const n = Math.max(w, h);
    const f = new Float64Array(n);
    const d = new Float64Array(n);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    for (let i = 0; i < w * h; i++) out[i] = grid[i] === target ? 0 : INF;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = out[y * w + x];
      edt1d(f, h, d, v, z);
      for (let y = 0; y < h; y++) out[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) f[x] = out[y * w + x];
      edt1d(f, w, d, v, z);
      for (let x = 0; x < w; x++) out[y * w + x] = d[x];
    }
    return out;
  }

  function dilate(g, w, h, r) {
    const d = edt(g, w, h, 1);
    const r2 = r * r + 0.01;
    const o = new Uint8Array(w * h);
    for (let i = 0; i < o.length; i++) o[i] = d[i] <= r2 ? 1 : 0;
    return o;
  }

  function erode(g, w, h, r) {
    const d = edt(g, w, h, 0);
    const r2 = r * r + 0.01;
    const o = new Uint8Array(w * h);
    for (let i = 0; i < o.length; i++) o[i] = d[i] > r2 ? 1 : 0;
    return o;
  }

  // ------------------------------------------------------------- colour

  function hexToRgb(hex) {
    let h = String(hex).replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const lighten = (c, t) => mix(c, [255, 255, 255], t);
  const darken = (c, t) => mix(c, [0, 0, 0], t);

  // ------------------------------------------------------- base shapes

  /** Edge / blob tiles: land is the centre square plus every connected arm and corner. */
  function edgeLand(mask, n, pad, bottomPad) {
    const has = (b) => (mask & b) !== 0;
    const table = [
      // [zy][zx]
      [has(BIT.N) && has(BIT.W) && has(BIT.NW), has(BIT.N), has(BIT.N) && has(BIT.E) && has(BIT.NE)],
      [has(BIT.W), true, has(BIT.E)],
      [has(BIT.S) && has(BIT.W) && has(BIT.SW), has(BIT.S), has(BIT.S) && has(BIT.E) && has(BIT.SE)],
    ];
    return function (x, y) {
      const zx = x < pad ? 0 : x >= n - pad ? 2 : 1;
      const zy = y < pad ? 0 : y >= n - bottomPad ? 2 : 1;
      return table[zy][zx] ? 1 : 0;
    };
  }

  /**
   * Corner (Wang) tiles: each quadrant belongs to the terrain of its corner.
   * The two diagonal tiles (TL+BR, TR+BL) get a neck through the centre so the
   * pieces join instead of touching at a single point. The neck is a diamond
   * of radius `join` around the centre, so it never reaches a tile edge.
   */
  function cornerLand(mask, n, wallH, join) {
    const xm = n / 2;
    const ym = n / 2 - Math.floor(wallH / 2); // lift land so the wall fits below it
    const diagonal = mask === (CORNER.TL | CORNER.BR) || mask === (CORNER.TR | CORNER.BL);
    const neck = diagonal ? join : 0;
    return function (x, y) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const right = cx >= xm;
      const bottom = cy >= ym;
      const bit = bottom ? (right ? CORNER.BR : CORNER.BL) : right ? CORNER.TR : CORNER.TL;
      if (mask & bit) return 1;
      return neck > 0 && Math.abs(cx - xm) + Math.abs(cy - ym) < neck ? 1 : 0;
    };
  }

  // ------------------------------------------------------------- render

  /**
   * Render one tile into an RGBA buffer (alpha 0 = background).
   * Also returns the land mask (1 = terrain or wall) for tests / previews.
   */
  function renderTile(cell, o) {
    const n = o.tileSize;
    const rgba = new Uint8ClampedArray(n * n * 4);
    const solid = new Uint8Array(n * n);
    if (!cell || cell.empty || (cell.kind === 'corner' && cell.mask === 0)) return { rgba, solid };

    const corner = cell.kind === 'corner';
    const pad = corner ? 0 : o.padding;
    // the wall must fit inside the tile below the land
    const maxWall = corner ? n / 2 - 2 : n - 2 * pad - 4;
    const wallH = o.elevation ? clamp(o.wallHeight | 0, 1, Math.max(1, maxWall)) : 0;
    const radius = o.radius;
    const amp = o.noise;
    const M = Math.ceil(pad + radius + amp + wallH + o.fade + 6);
    const W = n + 2 * M;
    const size = W * W;

    // 1. base shape on the extended grid
    const join = o.joinDiagonals === false ? 0 : Math.max(2, Math.round(n * 0.22));
    const shape = corner ? cornerLand(cell.mask, n, wallH, join) : edgeLand(cell.mask, n, pad, pad + wallH);
    let g = new Uint8Array(size);
    for (let j = 0; j < W; j++) {
      const y = clamp(j - M, 0, n - 1);
      for (let i = 0; i < W; i++) g[j * W + i] = shape(clamp(i - M, 0, n - 1), y);
    }

    // 2. rounded corners: closing rounds inner corners, opening rounds outer
    if (radius > 0) {
      g = erode(dilate(g, W, W, radius), W, W, radius);
      g = dilate(erode(g, W, W, radius), W, W, radius);
    }

    // 3. signed distance + periodic edge noise
    let land = g;
    if (amp > 0) {
      const toWater = edt(g, W, W, 0);
      const toLand = edt(g, W, W, 1);
      const nA = periodicNoise(n, o.noiseSize, o.seed + 101);
      const nB = periodicNoise(n, Math.max(1, o.noiseSize / 2.5), o.seed + 202);
      const outward = corner ? amp * 0.4 : Math.min(amp * 0.4, Math.max(0, pad - 1));
      land = new Uint8Array(size);
      for (let j = 0; j < W; j++) {
        const y = j - M + 0.5;
        for (let i = 0; i < W; i++) {
          const x = i - M + 0.5;
          const idx = j * W + i;
          const sd = g[idx] ? -(Math.sqrt(toWater[idx]) - 0.5) : Math.sqrt(toLand[idx]) - 0.5;
          if (sd > amp + 1 || sd < -amp - 1) {
            land[idx] = sd < 0 ? 1 : 0;
            continue;
          }
          let u;
          if (o.rough) {
            const jitter = hash2(mod(Math.floor(x), n), mod(Math.floor(y), n), o.seed + 303);
            u = 0.5 * nA(x, y) + 0.22 * nB(x, y) + 0.28 * jitter;
          } else {
            u = 0.75 * nA(x, y) + 0.25 * nB(x, y);
          }
          u = clamp((u - 0.5) * 1.7 + 0.5, 0, 1);
          land[idx] = sd + amp * u - outward < 0 ? 1 : 0;
        }
      }

      // 4. cleanup: drop lone pixels and fill one-pixel pits
      const c = new Uint8Array(land);
      for (let j = 1; j < W - 1; j++) {
        for (let i = 1; i < W - 1; i++) {
          const idx = j * W + i;
          const k = land[idx - 1] + land[idx + 1] + land[idx - W] + land[idx + W];
          if (land[idx] && k <= 1) c[idx] = 0;
          else if (!land[idx] && k >= 3) c[idx] = 1;
        }
      }
      land = c;
    }

    // 5. elevation wall: rows below land, `wallH` tall
    let wall = null;
    if (wallH > 0) {
      wall = new Uint8Array(size);
      for (let i = 0; i < W; i++) {
        let last = -1e9;
        for (let j = 0; j < W; j++) {
          const idx = j * W + i;
          if (land[idx]) last = j;
          else if (j - last <= wallH) wall[idx] = j - last;
        }
      }
    }

    // 6. shading
    const depth = edt(land, W, W, 0);
    const colBase = hexToRgb(o.colors.base);
    const colEdge = hexToRgb(o.colors.edge);
    const colRock = hexToRgb(o.colors.rock);
    const shades = Math.max(2, o.shades | 0);
    const ramp = [];
    for (let s = 0; s < shades; s++) ramp.push(mix(colEdge, colBase, s / (shades - 1)));
    const baseLight = lighten(colBase, 0.12);
    const baseDark = mix(colBase, colEdge, 0.3);
    const fleckLight = lighten(colBase, 0.3);
    const fleckDark = mix(colBase, colEdge, 0.45);
    const tex = o.texture / 100;
    const nT = periodicNoise(n, 2, o.seed + 404);
    const nT2 = periodicNoise(n, 5, o.seed + 505);
    const rockA = darken(colRock, 0.35);
    const rockB = darken(colRock, 0.5);
    const rockStripe = darken(colRock, 0.14);
    const rockLight = lighten(colRock, 0.1);
    const fleckSeed = o.seed * 31 + (cell.mask + 1) * 7919 + (cell.kind === 'corner' ? 17 : 0);
    const isFleck = (px, py) => o.flecksOn && o.flecks > 0 && hash2(px, py, fleckSeed) < o.flecks / 400;

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const idx = (y + M) * W + (x + M);
        const p = (y * n + x) * 4;
        let c = null;
        if (land[idx]) {
          const dist = Math.sqrt(depth[idx]);
          const t1 = nT(x + 0.5, y + 0.5);
          const t2 = nT2(x + 0.5, y + 0.5);
          let level;
          if (dist < 1.01) level = 0;
          else if (shades <= 2 || o.fade <= 0) level = shades - 1;
          else {
            const jittered = dist - 1.01 + tex * 10 * (t1 - 0.5) * 0.6;
            level = clamp(1 + Math.floor((jittered / o.fade) * (shades - 2)), 1, shades - 1);
          }
          c = ramp[level];
          if (level === shades - 1) {
            const v = 0.6 * t2 + 0.4 * t1;
            if (v > 1 - tex * 1.6) c = baseLight;
            else if (v < tex * 0.9) c = baseDark;
            if (isFleck(x, y)) c = fleckLight;
            else if (y > 0 && isFleck(x, y - 1)) c = fleckDark;
          }
        } else if (wall && wall[idx]) {
          const k = wall[idx];
          const below = idx + W;
          const bottom = k === wallH || below >= size || !wall[below];
          if (k === 1) c = rockA;
          else if (bottom) c = rockB;
          else if (hash2(mod(x, n), 0, o.seed + 606) < 0.28) c = rockStripe;
          else if (nT(x + 0.5, y + 0.5) > 1 - tex * 1.5) c = rockLight;
          else c = colRock;
        }
        if (c) {
          rgba[p] = c[0];
          rgba[p + 1] = c[1];
          rgba[p + 2] = c[2];
          rgba[p + 3] = 255;
          solid[y * n + x] = 1;
        }
      }
    }
    return { rgba, solid };
  }

  /** Render every tile of a mode. Returns [{cell, rgba, solid}]. */
  function renderTiles(mode, o) {
    return mode.cells.map((cell) => ({ cell, ...renderTile(cell, o) }));
  }

  /**
   * Sheet geometry. Tile pixels scale by an integer `scale`; grid lines and the
   * margin are measured in *output* pixels, so every line has the same
   * thickness and the outer frame matches the inner lines at any scale.
   *
   *   margin | line | tile | line | tile | ... | line | margin
   */
  function sheetGeometry(mode, o, opt = {}) {
    const scale = Math.max(1, opt.scale | 0 || 1);
    const line = o.grid ? Math.max(1, opt.lineWidth != null ? opt.lineWidth | 0 : o.gridWidth | 0 || 1) : 0;
    const margin = Math.max(0, opt.margin != null ? opt.margin | 0 : o.margin | 0);
    const cell = o.tileSize * scale;
    return {
      scale,
      line,
      margin,
      cell,
      width: 2 * margin + mode.cols * cell + (mode.cols + 1) * line,
      height: 2 * margin + mode.rows * cell + (mode.rows + 1) * line,
    };
  }

  /**
   * Largest integer scale that fits the sheet inside target x target px, and the
   * output size that keeps the long side exactly `target` with equal padding
   * on every side.
   */
  function fitToSize(mode, o, target, opt = {}) {
    const g0 = sheetGeometry(mode, o, { ...opt, scale: 1 });
    const fixedW = g0.width - mode.cols * o.tileSize;
    const fixedH = g0.height - mode.rows * o.tileSize;
    const scale = Math.max(
      1,
      Math.floor(Math.min((target - fixedW) / (mode.cols * o.tileSize), (target - fixedH) / (mode.rows * o.tileSize)))
    );
    const g = sheetGeometry(mode, o, { ...opt, scale });
    const extra = Math.max(0, target - Math.max(g.width, g.height));
    return { scale, outWidth: g.width + extra, outHeight: g.height + extra };
  }

  /**
   * Compose rendered tiles into one RGBA sheet.
   * opt: { scale, lineWidth, margin, outWidth, outHeight } (all optional).
   * When outWidth/outHeight exceed the sheet, it is centred.
   */
  function composeSheet(mode, tiles, o, opt = {}) {
    const g = sheetGeometry(mode, o, opt);
    const w = Math.max(g.width, opt.outWidth | 0);
    const h = Math.max(g.height, opt.outHeight | 0);
    const offX = Math.floor((w - g.width) / 2);
    const offY = Math.floor((h - g.height) / 2);
    const data = new Uint8ClampedArray(w * h * 4);
    const px = new Uint32Array(data.buffer);
    const pack = (r, gg, b, a) => ((a << 24) | (b << 16) | (gg << 8) | r) >>> 0;
    const fill = (x, y, rw, rh, c) => {
      for (let j = y; j < y + rh; j++) px.fill(c, j * w + x, j * w + x + rw);
    };

    if (o.whiteBg) px.fill(pack(255, 255, 255, 255));

    const s = g.scale;
    const step = g.cell + g.line;
    const gx = offX + g.margin; // grid frame origin
    const gy = offY + g.margin;
    if (g.line) {
      const [r, gg, b] = hexToRgb(o.gridColor || '#000000');
      const c = pack(r, gg, b, 255);
      const frameW = mode.cols * step + g.line;
      const frameH = mode.rows * step + g.line;
      for (let k = 0; k <= mode.cols; k++) fill(gx + k * step, gy, g.line, frameH, c);
      for (let k = 0; k <= mode.rows; k++) fill(gx, gy + k * step, frameW, g.line, c);
    }

    const n = o.tileSize;
    for (const t of tiles) {
      const ox = gx + g.line + t.cell.col * step;
      const oy = gy + g.line + t.cell.row * step;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = (y * n + x) * 4;
          if (t.rgba[i + 3] === 0) continue;
          fill(ox + x * s, oy + y * s, s, s, pack(t.rgba[i], t.rgba[i + 1], t.rgba[i + 2], t.rgba[i + 3]));
        }
      }
    }
    return { width: w, height: h, data, geometry: { ...g, offX, offY } };
  }

  /** Engine-agnostic metadata (native scale) describing each tile's position and connections. */
  function sheetMetadata(mode, o) {
    const n = o.tileSize;
    const g = sheetGeometry(mode, o);
    const gap = g.line;
    const margin = g.margin + g.line;
    return {
      generator: 'tileset-base-generator',
      format: mode.id + '-piece',
      bitmask:
        mode.kind === 'corner'
          ? 'corner: TL=1 TR=2 BR=4 BL=8'
          : 'edge (blob-reduced): N=1 NE=2 E=4 SE=8 S=16 SW=32 W=64 NW=128',
      tileSize: n,
      columns: mode.cols,
      rows: mode.rows,
      margin,
      spacing: gap,
      seed: o.seed,
      tiles: mode.cells.map((c, i) => ({
        id: i,
        col: c.col,
        row: c.row,
        x: margin + c.col * (n + gap),
        y: margin + c.row * (n + gap),
        mask: c.mask,
        empty: !!c.empty,
        connects: TBG.describeMask ? TBG.describeMask(mode.kind, c.mask) : undefined,
      })),
    };
  }

  TBG.hash2 = hash2;
  TBG.periodicNoise = periodicNoise;
  TBG.edt = edt;
  TBG.hexToRgb = hexToRgb;
  TBG.renderTile = renderTile;
  TBG.renderTiles = renderTiles;
  TBG.composeSheet = composeSheet;
  TBG.sheetGeometry = sheetGeometry;
  TBG.fitToSize = fitToSize;
  TBG.sheetMetadata = sheetMetadata;

  if (typeof module !== 'undefined' && module.exports) module.exports = TBG;
})(typeof window !== 'undefined' ? window : globalThis);
