/*
 * Seam tests: tiles must join without visible breaks.
 *
 *  - open edges stay empty (terrain never touches a side it doesn't connect to)
 *  - connected edges continue: the last column of a tile and the first column
 *    of its neighbour only differ where an outline crosses the edge
 *
 * Run: node test/seams.test.js
 */
'use strict';
const assert = require('assert');
const TBG = require('../src/layouts.js');
require('../src/generator.js');
const { defaultOptions } = require('../src/presets.js');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ok  ' + name);
  } catch (e) {
    failures++;
    console.log('  FAIL ' + name + '\n       ' + e.message);
  }
}

const B = TBG.BIT;

function edgeConnects(cell, side) {
  if (cell.kind === 'corner') {
    const C = TBG.CORNER;
    const pairs = { N: C.TL | C.TR, S: C.BL | C.BR, W: C.TL | C.BL, E: C.TR | C.BR };
    return (cell.mask & pairs[side]) !== 0;
  }
  return (cell.mask & B[side]) !== 0;
}

function variants(size) {
  const base = defaultOptions(size);
  return [
    ['rough', { ...base }],
    ['clean', { ...base, rough: false }],
    ['elevation', { ...base, elevation: true }],
    ['big-noise', { ...base, noise: Math.round(size / 5), radius: Math.round(size / 10), padding: Math.round(size / 8) }],
    ['no-noise', { ...base, noise: 0, radius: 0 }],
  ];
}

console.log('layouts');
check('47-piece has 47 unique blob masks', () => {
  const masks = TBG.MODES['47'].cells.map((c) => c.mask);
  assert.strictEqual(masks.length, 47);
  assert.strictEqual(new Set(masks).size, 47);
  for (const m of masks) assert.strictEqual(TBG.reduceMask(m), m, `mask ${m} is not blob-reduced`);
  assert.deepStrictEqual([...masks].sort((a, b) => a - b), TBG.blobMasks());
});
check('47-piece uses the 12x4 sheet', () => {
  assert.strictEqual(TBG.MODES['47'].cols, 12);
  assert.strictEqual(TBG.MODES['47'].rows, 4);
});
check('15-piece has all 16 corner combinations', () => {
  assert.strictEqual(new Set(TBG.MODES['15'].cells.map((c) => c.mask)).size, 16);
});
check('17-piece has 17 tiles', () => {
  assert.strictEqual(TBG.MODES['17'].cells.length, 17);
});

for (const size of [16, 32, 64]) {
  for (const [vname, o] of variants(size)) {
    for (const modeId of ['15', '17', '47']) {
      const mode = TBG.MODES[modeId];
      const tiles = TBG.renderTiles(mode, o);
      const n = size;
      const col = (t, x) => Array.from({ length: n }, (_, y) => t.solid[y * n + x]);
      const row = (t, y) => Array.from(t.solid.subarray(y * n, y * n + n));

      check(`${modeId}-piece ${size}px ${vname}: open edges stay empty`, () => {
        for (const t of tiles) {
          const sides = { N: row(t, 0), S: row(t, n - 1), W: col(t, 0), E: col(t, n - 1) };
          for (const s of Object.keys(sides)) {
            if (edgeConnects(t.cell, s)) continue;
            const hits = sides[s].reduce((a, b) => a + b, 0);
            assert.strictEqual(hits, 0, `mask ${t.cell.mask} side ${s} has ${hits} px`);
          }
        }
      });

      check(`${modeId}-piece ${size}px ${vname}: connected edges continue`, () => {
        let worst = 0;
        for (const a of tiles) {
          for (const b of tiles) {
            // horizontal: a | b must agree on the shared terrain at the border
            if (compatibleH(a.cell, b.cell)) {
              const d = diff(col(a, n - 1), col(b, 0));
              worst = Math.max(worst, d);
            }
            if (compatibleV(a.cell, b.cell)) {
              const d = diff(row(a, n - 1), row(b, 0));
              worst = Math.max(worst, d);
            }
          }
        }
        assert.ok(worst <= 4, `worst border mismatch ${worst}px`);
      });
    }
  }
}

function diff(p, q) {
  let d = 0;
  for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) d++;
  return d;
}

/** Can tile b sit directly to the right of tile a in a valid map? */
function compatibleH(a, b) {
  if (a.kind === 'corner') {
    const C = TBG.CORNER;
    return !!(a.mask & C.TR) === !!(b.mask & C.TL) && !!(a.mask & C.BR) === !!(b.mask & C.BL) && (a.mask & (C.TR | C.BR)) !== 0;
  }
  if (!(a.mask & B.E) || !(b.mask & B.W)) return false;
  // a's NE corner region is b's NW corner region (and SE / SW)
  return !!(a.mask & B.NE) === !!(b.mask & B.NW) && !!(a.mask & B.SE) === !!(b.mask & B.SW);
}

function compatibleV(a, b) {
  if (a.kind === 'corner') {
    const C = TBG.CORNER;
    return !!(a.mask & C.BL) === !!(b.mask & C.TL) && !!(a.mask & C.BR) === !!(b.mask & C.TR) && (a.mask & (C.BL | C.BR)) !== 0;
  }
  if (!(a.mask & B.S) || !(b.mask & B.N)) return false;
  return !!(a.mask & B.SW) === !!(b.mask & B.NW) && !!(a.mask & B.SE) === !!(b.mask & B.NE);
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
