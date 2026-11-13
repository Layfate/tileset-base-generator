/* Colour presets and default options shared by the web UI and the CLI. */
(function (root) {
  'use strict';
  const TBG = (root.TBG = root.TBG || {});

  // `style` (optional) is applied along with the colours.
  const PRESETS = {
    grass: { base: '#72ab3a', edge: '#2f6a32', rock: '#6f5a43', rim: '#9cc96a' },
    stone: { base: '#94989a', edge: '#4f565d', rock: '#5a5148', rim: '#b8bcbd' },
    dirt: { base: '#ad7745', edge: '#6a4127', rock: '#5c4535', rim: '#c99a6a' },
    water: { base: '#4a87a8', edge: '#22506f', rock: '#3d5566', rim: '#7fb3cf' },
    sand: { base: '#d3bd7d', edge: '#a0844a', rock: '#8a6f4e', rim: '#e8d8a4' },
    // flat fill, dark outline and a light rim, as in dual-grid tileset tutorials
    olive: {
      base: '#a1a562',
      edge: '#384424',
      rock: '#5b4a32',
      rim: '#bac373',
      // rounder corners and ragged 1px steps, scaled to the tile size
      style: (n) => ({
        rimLight: true,
        shades: 2,
        texture: 0,
        flecksOn: false,
        rough: true,
        radius: Math.round(n / 4),
        // raggedness stays pixel-sized: grows slower than the tile
        noise: Math.round(4 * Math.sqrt(n / 16)),
        noiseSize: Math.max(1, Math.round(n * 0.19)),
        jitter: Math.round(60 - 12.5 * Math.log2(n / 16)),
      }),
    },
  };

  /** Settings a preset applies besides colours (may depend on tile size). */
  function presetStyle(p, n) {
    if (!p.style) return {};
    return typeof p.style === 'function' ? p.style(n) : p.style;
  }

  /** Colours only (without the optional style block). */
  function presetColors(p) {
    return { base: p.base, edge: p.edge, rock: p.rock, rim: p.rim };
  }

  /** Defaults tuned at 32px and scaled for 16 / 64. */
  function defaultOptions(tileSize) {
    const k = tileSize / 32;
    return {
      tileSize,
      seed: 31415,
      rough: true,
      radius: Math.round(2 * k),
      padding: Math.max(1, Math.round(2 * k)),
      cornerOffset: Math.round(3 * k),
      noise: Math.round(4 * k),
      noiseSize: Math.max(1, Math.round(5 * k)),
      jitter: 28,
      elevation: false,
      wallHeight: Math.max(2, Math.round(6 * k)),
      shades: 4,
      fade: Math.max(1, Math.round(3 * k)),
      texture: 12,
      flecks: 6,
      flecksOn: false,
      rimLight: false,
      joinDiagonals: true,
      whiteBg: true,
      grid: true,
      gridWidth: 1,
      gridColor: '#000000',
      margin: 0,
      upscale1024: false,
      colors: presetColors(PRESETS.grass),
    };
  }

  // ------------------------------------------------------------ randomizer

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;
    const f = (k) => {
      const n = (k + h / 30) % 12;
      const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(n - 3, 9 - n, 1));
      return Math.round(c * 255).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  /** A fill / outline / rim / rock palette built around one random hue. */
  function randomPalette(rnd) {
    const h = rnd() * 360;
    const s = 30 + rnd() * 35;
    const l = 45 + rnd() * 17;
    const shift = rnd() * 24 - 12; // outline leans a little warmer or cooler
    return {
      base: hsl(h, s, l),
      edge: hsl(h + shift, s + 10, l - 24 - rnd() * 8),
      rim: hsl(h - shift / 2, s - 4, Math.min(85, l + 13 + rnd() * 6)),
      rock: hsl(20 + rnd() * 25, 12 + rnd() * 18, 24 + rnd() * 14),
    };
  }

  /**
   * Random style settings scaled to the tile size. Output settings (mode, size,
   * background, grid, margin, export size) are left alone. Same seed, same result.
   */
  function randomSettings(tileSize, seed) {
    const rnd = rng(seed);
    const n = tileSize;
    const k = n / 32;
    const int = (a, b) => Math.round(a + rnd() * (b - a));
    const lim = (v, max, min = 0) => Math.max(min, Math.min(max, v));
    const rough = rnd() < 0.7;
    const names = Object.keys(PRESETS);
    // half the time start from a preset's colours, otherwise invent a palette
    const colors = rnd() < 0.5 ? presetColors(PRESETS[names[Math.floor(rnd() * names.length)]]) : randomPalette(rnd);
    return {
      seed: Math.floor(rnd() * 99999),
      rough,
      radius: lim(int(0, Math.round(6 * k)), Math.floor(n / 4)),
      padding: lim(int(1, Math.round(4 * k)), Math.floor(n / 4), 1),
      cornerOffset: lim(int(0, Math.round(4 * k)), Math.floor(n / 4)),
      noise: lim(int(0, Math.round(6 * k)), Math.floor(n / 4)),
      noiseSize: lim(int(Math.round(2 * k), Math.round(10 * k)), Math.floor(n / 2), 1),
      jitter: rough ? int(10, 60) : 28,
      elevation: rnd() < 0.3,
      wallHeight: lim(int(Math.round(4 * k), Math.round(8 * k)), Math.floor(n / 3), 2),
      shades: int(2, 6),
      fade: lim(int(Math.round(1 * k), Math.round(5 * k)), 12, 1),
      texture: int(0, 30),
      flecksOn: rnd() < 0.5,
      flecks: int(2, 14),
      rimLight: rnd() < 0.35,
      colors,
    };
  }

  TBG.PRESETS = PRESETS;
  TBG.presetColors = presetColors;
  TBG.presetStyle = presetStyle;
  TBG.defaultOptions = defaultOptions;
  TBG.randomSettings = randomSettings;
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { PRESETS, presetColors, presetStyle, defaultOptions, randomSettings };
})(typeof window !== 'undefined' ? window : globalThis);
