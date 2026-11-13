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
    // light from above: light rim on top/side edges, dark line under bottom
    // edges, smooth round curves and sparse dark specks
    meadow: {
      base: '#a2a65e',
      edge: '#4b633a',
      rock: '#5b4a32',
      rim: '#c3be6a',
      fleck: '#919b5e',
      style: (n) => ({
        lighting: 'top',
        rimLight: false,
        shades: 2,
        texture: 0,
        flecksOn: true,
        flecks: 3,
        rough: false,
        radius: Math.round((n * 5) / 16),
        noise: Math.max(1, Math.round(Math.sqrt(n / 16))),
        noiseSize: Math.max(1, Math.round(n / 4)),
        cornerOffset: Math.max(1, Math.round(n / 16)),
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
    const c = { base: p.base, edge: p.edge, rock: p.rock, rim: p.rim };
    if (p.fleck) c.fleck = p.fleck;
    return c;
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
      lighting: 'outline',
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

  TBG.PRESETS = PRESETS;
  TBG.presetColors = presetColors;
  TBG.presetStyle = presetStyle;
  TBG.defaultOptions = defaultOptions;
  if (typeof module !== 'undefined' && module.exports) module.exports = { PRESETS, presetColors, presetStyle, defaultOptions };
})(typeof window !== 'undefined' ? window : globalThis);
