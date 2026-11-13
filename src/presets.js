/* Colour presets and default options shared by the web UI and the CLI. */
(function (root) {
  'use strict';
  const TBG = (root.TBG = root.TBG || {});

  const PRESETS = {
    grass: { base: '#72ab3a', edge: '#2f6a32', rock: '#6f5a43' },
    stone: { base: '#94989a', edge: '#4f565d', rock: '#5a5148' },
    dirt: { base: '#ad7745', edge: '#6a4127', rock: '#5c4535' },
    water: { base: '#4a87a8', edge: '#22506f', rock: '#3d5566' },
    sand: { base: '#d3bd7d', edge: '#a0844a', rock: '#8a6f4e' },
  };

  /** Defaults tuned at 32px and scaled for 16 / 64. */
  function defaultOptions(tileSize) {
    const k = tileSize / 32;
    return {
      tileSize,
      seed: 31415,
      rough: true,
      radius: Math.round(2 * k),
      padding: Math.max(1, Math.round(2 * k)),
      noise: Math.round(4 * k),
      noiseSize: Math.max(1, Math.round(5 * k)),
      elevation: false,
      wallHeight: Math.max(2, Math.round(6 * k)),
      shades: 4,
      fade: Math.max(1, Math.round(3 * k)),
      texture: 12,
      flecks: 6,
      flecksOn: false,
      whiteBg: true,
      grid: true,
      upscale1024: false,
      colors: { ...PRESETS.grass },
    };
  }

  TBG.PRESETS = PRESETS;
  TBG.defaultOptions = defaultOptions;
  if (typeof module !== 'undefined' && module.exports) module.exports = { PRESETS, defaultOptions };
})(typeof window !== 'undefined' ? window : globalThis);
