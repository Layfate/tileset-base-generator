/*
 * Autotile map preview. Paint terrain and watch the generated tiles join up.
 *
 *  - corner mode (15-piece): you paint grid *vertices*; each tile reads its 4 corners
 *  - edge modes (17 / 47):   you paint *cells*; each tile reads its 8 neighbours
 *
 * If a set has no exact tile for a neighbourhood (17-piece has no T-junctions),
 * the closest tile is used, preferring matching sides over matching corners.
 */
(function (root) {
  'use strict';
  const TBG = (root.TBG = root.TBG || {});
  const B = TBG.BIT;
  const DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

  class Preview {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cols = 20;
      this.rows = 12;
      this.map = null;
      this.modeKind = null;
      this.modeId = null;
      this.tileCanvases = new Map();
      this.matchCache = new Map();
      this.painting = 0;
      this.showGrids = true;
      this.bindPointer();
    }

    /** Called after every regeneration. */
    setTiles(mode, tiles, opts) {
      const kindChanged = mode.kind !== this.modeKind || mode.id !== this.modeId;
      this.modeKind = mode.kind;
      this.modeId = mode.id;
      this.n = opts.tileSize;
      this.whiteBg = opts.whiteBg;
      this.tileCanvases.clear();
      this.matchCache.clear();
      for (const t of tiles) {
        if (t.cell.empty) continue;
        const c = document.createElement('canvas');
        c.width = c.height = this.n;
        c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(t.rgba), this.n, this.n), 0, 0);
        this.tileCanvases.set(t.cell.mask, c);
      }
      if (kindChanged || !this.map) this.randomize(opts.seed);
      else this.draw();
    }

    gridSize() {
      return this.modeKind === 'corner' ? [this.cols + 1, this.rows + 1] : [this.cols, this.rows];
    }

    randomize(seed) {
      const [w, h] = this.gridSize();
      this.map = new Uint8Array(w * h);
      let s = (seed >>> 0) + 7;
      const rnd = () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      if (this.modeId === '17' || this.modeId === '16') {
        // 17-piece sets only cover rectangles, so build a map of separated rectangles
        for (let tries = 0; tries < 120; tries++) {
          const rw = rnd() < 0.25 ? 1 : 2 + Math.floor(rnd() * 5);
          const rh = rnd() < 0.25 ? 1 : 2 + Math.floor(rnd() * 4);
          const x0 = Math.floor(rnd() * (w - rw));
          const y0 = Math.floor(rnd() * (h - rh));
          let free = true;
          for (let y = y0 - 1; y <= y0 + rh && free; y++)
            for (let x = x0 - 1; x <= x0 + rw; x++) if (this.get(x, y)) { free = false; break; }
          if (!free) continue;
          for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) this.map[y * w + x] = 1;
        }
      } else {
        const noise = TBG.periodicNoise(64, 3.5, seed + 9001);
        const detail = TBG.periodicNoise(64, 2, seed + 9002);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const v = 0.75 * noise(x, y) + 0.25 * detail(x, y);
            this.map[y * w + x] = v > 0.48 ? 1 : 0;
          }
      }
      this.draw();
    }

    clear() {
      this.map.fill(0);
      this.draw();
    }

    get(x, y) {
      const [w, h] = this.gridSize();
      if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      return this.map[y * w + x];
    }

    bestTile(mask) {
      if (this.tileCanvases.has(mask)) return this.tileCanvases.get(mask);
      if (this.matchCache.has(mask)) return this.matchCache.get(mask);
      let best = null;
      let bestScore = -Infinity;
      for (const [m, c] of this.tileCanvases) {
        let score = 0;
        for (const side of [B.N, B.E, B.S, B.W]) score += !!(m & side) === !!(mask & side) ? 4 : -4;
        for (const cor of [B.NE, B.SE, B.SW, B.NW]) score += !!(m & cor) === !!(mask & cor) ? 1 : 0;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      this.matchCache.set(mask, best);
      return best;
    }

    /**
     * Draw in device pixels with an integer zoom per tile pixel, so pixels stay
     * square and even at fractional display scaling (125%, 150%).
     */
    draw() {
      if (!this.map || !this.n) return;
      const n = this.n;
      const dpr = window.devicePixelRatio || 1;
      const parent = this.canvas.parentElement;
      const availW = Math.max(200, parent.clientWidth - 48) * dpr;
      const availH = Math.max(200, window.innerHeight - 260) * dpr;
      const s = Math.max(1, Math.floor(Math.min(availW / (this.cols * n), availH / (this.rows * n))));
      this.render(this.canvas, s);
      if (this.showGrids) this.drawGrids(s, Math.max(1, Math.round(dpr)));
      this.canvas.style.width = this.canvas.width / dpr + 'px';
      this.canvas.style.height = this.canvas.height / dpr + 'px';
    }

    /**
     * Grid overlay. Corner (dual-grid) mode shows two grids: the world grid you
     * paint on (red) and the tile grid offset by half a tile (teal).
     */
    drawGrids(s, lw) {
      const ctx = this.ctx;
      const cell = this.n * s;
      const W = this.canvas.width, H = this.canvas.height;
      const lines = (offset, color) => {
        ctx.fillStyle = color;
        for (let x = offset; x <= W; x += cell) ctx.fillRect(Math.round(x) - (x >= W ? lw : 0), 0, lw, H);
        for (let y = offset; y <= H; y += cell) ctx.fillRect(0, Math.round(y) - (y >= H ? lw : 0), W, lw);
      };
      lines(0, 'rgba(79, 209, 197, 0.75)');
      if (this.modeKind === 'corner') lines(cell / 2, 'rgba(232, 100, 78, 0.85)');
    }

    /** The map at native resolution (1 tile pixel = 1 image pixel), for download. */
    nativeCanvas() {
      const c = document.createElement('canvas');
      this.render(c, 1);
      return c;
    }

    render(canvas, s) {
      const n = this.n;
      const ctx = canvas.getContext('2d');
      const cell = n * s;
      canvas.width = this.cols * cell;
      canvas.height = this.rows * cell;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (this.whiteBg) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          let tile = null;
          if (this.modeKind === 'corner') {
            const m = this.get(x, y) | (this.get(x + 1, y) << 1) | (this.get(x + 1, y + 1) << 2) | (this.get(x, y + 1) << 3);
            if (m) tile = this.tileCanvases.get(m);
          } else if (this.get(x, y)) {
            let m = 0;
            DIRS.forEach(([dx, dy], i) => {
              if (this.get(x + dx, y + dy)) m |= 1 << i;
            });
            tile = this.bestTile(TBG.reduceMask(m));
          }
          if (tile) ctx.drawImage(tile, x * cell, y * cell, cell, cell);
        }
      }
    }

    fit() {
      this.draw();
    }

    bindPointer() {
      const c = this.canvas;
      c.addEventListener('contextmenu', (e) => e.preventDefault());
      const paint = (e) => {
        if (!this.painting || !this.map) return;
        const r = c.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * this.cols;
        const py = ((e.clientY - r.top) / r.height) * this.rows;
        const corner = this.modeKind === 'corner';
        const x = corner ? Math.round(px) : Math.floor(px);
        const y = corner ? Math.round(py) : Math.floor(py);
        const [w, h] = this.gridSize();
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const v = this.painting === 1 ? 1 : 0;
        if (this.map[y * w + x] !== v) {
          this.map[y * w + x] = v;
          this.draw();
        }
      };
      c.addEventListener('pointerdown', (e) => {
        this.painting = e.button === 2 || e.shiftKey ? 2 : 1;
        c.setPointerCapture(e.pointerId);
        paint(e);
      });
      c.addEventListener('pointermove', paint);
      const stop = () => (this.painting = 0);
      c.addEventListener('pointerup', stop);
      c.addEventListener('pointercancel', stop);
    }
  }

  TBG.Preview = Preview;
})(typeof window !== 'undefined' ? window : globalThis);
