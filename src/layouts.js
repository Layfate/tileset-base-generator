/*
 * Tileset layouts for the three supported autotile formats.
 *
 * Edge / blob bitmask (17-piece and 47-piece), clockwise from north:
 *   N=1  NE=2  E=4  SE=8  S=16  SW=32  W=64  NW=128
 * A corner bit is only meaningful when both neighbouring sides are set
 * (the usual "blob" reduction), which is what gives 47 unique tiles.
 *
 * Corner bitmask (15-piece / Wang 2-corner / marching squares):
 *   TL=1  TR=2  BR=4  BL=8
 */
(function (root) {
  'use strict';
  const TBG = (root.TBG = root.TBG || {});

  const BIT = { N: 1, NE: 2, E: 4, SE: 8, S: 16, SW: 32, W: 64, NW: 128 };
  const CORNER = { TL: 1, TR: 2, BR: 4, BL: 8 };

  /** Drop corner bits whose two adjacent sides are not both set. */
  function reduceMask(m) {
    let r = m & (BIT.N | BIT.E | BIT.S | BIT.W);
    if (m & BIT.N && m & BIT.E && m & BIT.NE) r |= BIT.NE;
    if (m & BIT.E && m & BIT.S && m & BIT.SE) r |= BIT.SE;
    if (m & BIT.S && m & BIT.W && m & BIT.SW) r |= BIT.SW;
    if (m & BIT.W && m & BIT.N && m & BIT.NW) r |= BIT.NW;
    return r;
  }

  function blobMasks() {
    const set = new Set();
    for (let m = 0; m < 256; m++) set.add(reduceMask(m));
    return [...set].sort((a, b) => a - b);
  }

  function grid(rows, kind) {
    const cells = [];
    rows.forEach((row, r) =>
      row.forEach((mask, c) => {
        if (mask !== null) cells.push({ col: c, row: r, kind, mask });
      })
    );
    return { cols: rows[0].length, rows: rows.length, cells };
  }

  // 15-piece: 4x4 sheet whose tiles join into one continuous picture.
  // Contains all 16 corner combinations (mask 0 is the empty tile).
  const LAYOUT_15 = [
    [8, 6, 13, 12],
    [5, 14, 15, 11],
    [2, 3, 7, 9],
    [0, 4, 10, 1],
  ];

  // 17-piece top-down: 3x3 block, vertical strip, horizontal strip,
  // single island and a cross piece with four inner corners.
  // 16 subset: the 17-piece set without the cross tile, in a 4x4 sheet.
  const LAYOUT_16 = [
    [16, 28, 124, 112],
    [17, 31, 255, 241],
    [1, 7, 199, 193],
    [0, 4, 68, 64],
  ];

  const LAYOUT_17 = [
    [16, 28, 124, 112, 85],
    [17, 31, 255, 241, null],
    [1, 7, 199, 193, null],
    [0, 4, 68, 64, null],
  ];

  // 47-piece blob: the common 12x4 sheet (as used by Godot's "3x3 minimal"
  // style templates). Left 4x4: the 16 side-only tiles (strips, island and a
  // 3x3 block with every inner corner notched). Middle 4x4 and right 4x4:
  // the mixed corner tiles. One empty slot at row 1, column 10.
  const LAYOUT_47 = [
    [16, 20, 84, 80, 213, 92, 116, 87, 28, 125, 124, 112],
    [17, 21, 85, 81, 29, 127, 253, 113, 31, 119, null, 245],
    [1, 5, 69, 65, 23, 223, 247, 209, 95, 255, 221, 241],
    [0, 4, 68, 64, 117, 71, 197, 93, 7, 199, 215, 193],
  ];
  const layout47 = () => LAYOUT_47;

  const MODES = {
    '15': {
      id: '15',
      label: '15-piece',
      title: '15-piece corner (Wang)',
      kind: 'corner',
      ...grid(LAYOUT_15, 'corner'),
    },
    '16': {
      id: '16',
      label: '16 subset',
      title: '16 subset',
      kind: 'edge',
      ...grid(LAYOUT_16, 'edge'),
    },
    '17': {
      id: '17',
      label: '17-piece',
      title: '17-piece top-down',
      kind: 'edge',
      ...grid(LAYOUT_17, 'edge'),
    },
    '47': {
      id: '47',
      label: '47-piece',
      title: '47-piece blob',
      kind: 'edge',
      ...grid(layout47(), 'edge'),
    },
  };

  // The corner-mode empty tile (mask 0) is a real tile slot in the sheet.
  MODES['15'].cells.forEach((c) => {
    if (c.mask === 0) c.empty = true;
  });

  function describeMask(kind, mask) {
    if (kind === 'corner') {
      return {
        tl: !!(mask & CORNER.TL),
        tr: !!(mask & CORNER.TR),
        br: !!(mask & CORNER.BR),
        bl: !!(mask & CORNER.BL),
      };
    }
    const o = {};
    for (const k of Object.keys(BIT)) o[k.toLowerCase()] = !!(mask & BIT[k]);
    return o;
  }

  TBG.BIT = BIT;
  TBG.CORNER = CORNER;
  TBG.reduceMask = reduceMask;
  TBG.blobMasks = blobMasks;
  TBG.MODES = MODES;
  TBG.describeMask = describeMask;

  if (typeof module !== 'undefined' && module.exports) module.exports = TBG;
})(typeof window !== 'undefined' ? window : globalThis);
