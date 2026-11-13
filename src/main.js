/* UI wiring: settings panel <-> generator <-> canvases. */
(function () {
  'use strict';
  const TBG = window.TBG;
  const STORAGE_KEY = 'tbg-settings-v1';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // Slider limits that depend on tile size.
  const RANGE = {
    radius: (n) => n / 4,
    padding: (n) => n / 4,
    noise: (n) => n / 4,
    noiseSize: (n) => n / 2,
    wallHeight: (n) => Math.floor(n / 3),
    cornerOffset: (n) => n / 4,
  };
  const SIZE_SCALED = Object.keys(RANGE).concat(['fade']);

  function defaults(size = 32) {
    return { mode: '17', ...TBG.defaultOptions(size) };
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && TBG.MODES[saved.mode] && [16, 32, 64].includes(saved.tileSize)) {
        return { ...defaults(saved.tileSize), ...saved, colors: { ...defaults().colors, ...saved.colors } };
      }
    } catch (e) {
      /* storage unavailable */
    }
    return defaults();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable */
    }
  }

  /** Optional URL overrides, e.g. ?mode=47&size=16&seed=7&preset=sand&elevation=1&tab=preview */
  function applyQuery(st) {
    const q = new URLSearchParams(location.search);
    const size = Number(q.get('size'));
    if ([16, 32, 64].includes(size) && size !== st.tileSize) st = { ...defaults(size), mode: st.mode, colors: st.colors };
    if (TBG.MODES[q.get('mode')]) st.mode = q.get('mode');
    if (q.has('seed')) st.seed = Math.max(0, Number(q.get('seed')) | 0);
    const preset = TBG.PRESETS[q.get('preset')];
    if (preset) Object.assign(st, TBG.presetStyle(preset, st.tileSize), { colors: TBG.presetColors(preset) });
    if (q.has('style')) st.rough = q.get('style') !== 'clean';
    if (q.has('elevation')) st.elevation = q.get('elevation') !== '0';
    return st;
  }

  let state = applyQuery(load());
  let tiles = null;
  let sheetImage = null;
  let pending = 0;

  const sheetCanvas = $('#sheet');
  const preview = new TBG.Preview($('#preview'));

  // ------------------------------------------------------------ controls

  function syncControls() {
    const n = state.tileSize;
    $$('.seg').forEach((seg) => {
      const key = seg.dataset.key;
      $$('button', seg).forEach((b) => b.setAttribute('aria-pressed', String(String(state[key]) === b.dataset.value)));
    });
    $$('.slider').forEach((el) => {
      const key = el.dataset.key;
      const input = $('input', el);
      if (RANGE[key]) input.max = RANGE[key](n);
      state[key] = Math.min(state[key], Number(input.max));
      input.value = state[key];
      $('output', el).textContent = state[key];
      const pct = ((input.value - input.min) / (input.max - input.min || 1)) * 100;
      input.style.setProperty('--p', pct + '%');
      const dep = el.dataset.dep;
      let disabled = dep ? !state[dep] : false;
      el.classList.toggle('disabled', disabled);
    });
    $$('input[type=checkbox][data-key]').forEach((c) => (c.checked = !!state[c.dataset.key]));
    $$('[data-show-modes]').forEach((el) => (el.hidden = !el.dataset.showModes.split(',').includes(state.mode)));
    $('.gridcolor').classList.toggle('disabled', !state.grid);
    $('#gridColor').value = state.gridColor;
    $$('input[data-color]').forEach((c) => (c.value = state.colors[c.dataset.color]));
    $('#seed').value = state.seed;
  }

  function bind() {
    $$('.seg').forEach((seg) => {
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const key = seg.dataset.key;
        let v = b.dataset.value;
        if (key === 'tileSize') {
          const next = Number(v);
          const k = next / state.tileSize;
          for (const s of SIZE_SCALED) state[s] = Math.max(s === 'noiseSize' || s === 'wallHeight' ? 1 : 0, Math.round(state[s] * k));
          v = next;
        } else if (key === 'rough') v = v === 'true';
        state[key] = v;
        update();
      });
    });

    $$('.slider input').forEach((input) => {
      input.addEventListener('input', () => {
        state[input.parentElement.dataset.key] = Number(input.value);
        update();
      });
    });

    $$('input[type=checkbox][data-key]').forEach((c) =>
      c.addEventListener('change', () => {
        state[c.dataset.key] = c.checked;
        if (c.dataset.key === 'flecksOn' && c.checked && !state.flecks) state.flecks = 6;
        update();
      })
    );

    $$('input[data-color]').forEach((c) =>
      c.addEventListener('input', () => {
        state.colors[c.dataset.color] = c.value;
        update();
      })
    );

    const presets = $('.presets');
    for (const [name, p] of Object.entries(TBG.PRESETS)) {
      const b = document.createElement('button');
      b.title = name[0].toUpperCase() + name.slice(1);
      b.setAttribute('aria-label', b.title + ' preset');
      b.style.background = `linear-gradient(${p.base} 0 72%, ${p.edge} 72%)`;
      b.addEventListener('click', () => {
        state.colors = TBG.presetColors(p);
        Object.assign(state, TBG.presetStyle(p, state.tileSize));
        update();
      });
      presets.appendChild(b);
    }

    $('#gridColor').addEventListener('input', (e) => {
      state.gridColor = e.target.value;
      update();
    });

    $('#seed').addEventListener('change', (e) => {
      state.seed = Math.max(0, Math.floor(Number(e.target.value) || 0));
      update();
    });
    $('#newSeed').addEventListener('click', newSeed);
    $('#downloadPng').addEventListener('click', downloadPng);
    $('#downloadJson').addEventListener('click', downloadJson);
    $('#reset').addEventListener('click', () => {
      state = { ...defaults(state.tileSize), mode: state.mode };
      update();
    });

    $$('.tabs button').forEach((t) =>
      t.addEventListener('click', () => {
        $$('.tabs button').forEach((o) => o.setAttribute('aria-selected', String(o === t)));
        $('#sheetView').hidden = t.dataset.tab !== 'sheet';
        $('#previewView').hidden = t.dataset.tab !== 'preview';
        if (t.dataset.tab === 'preview') preview.draw();
        else drawSheet();
      })
    );
    $('#showGrids').addEventListener('change', (e) => {
      preview.showGrids = e.target.checked;
      preview.draw();
      updateLegend();
    });
    $('#randomMap').addEventListener('click', () => preview.randomize((Math.random() * 1e9) | 0));
    $('#clearMap').addEventListener('click', () => preview.clear());
    $('#downloadMap').addEventListener('click', () =>
      preview.nativeCanvas().toBlob((b) => saveBlob(b, `map-preview-${state.mode}-${state.tileSize}px.png`))
    );

    let resizeFrame = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        drawSheet();
        if (!$('#previewView').hidden) preview.draw();
      });
    });
    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input')) return;
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey) newSeed();
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        downloadPng();
      }
    });
  }

  function newSeed() {
    state.seed = Math.floor(Math.random() * 99999);
    update();
  }

  // ------------------------------------------------------------- render

  function update() {
    syncControls();
    save();
    $('#busy').hidden = false;
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => setTimeout(render, 0));
  }

  function render() {
    const mode = TBG.MODES[state.mode];
    const opts = { ...state };
    tiles = TBG.renderTiles(mode, opts);
    sheetImage = TBG.composeSheet(mode, tiles, opts); // native size, used for export
    drawSheet();
    preview.setTiles(mode, tiles, opts);
    updateLegend();

    $('#info').textContent = `${state.tileSize}px tiles - ${mode.title} - ${sheetImage.width}x${sheetImage.height}px native`;
    $('#seedInfo').textContent = `seed ${state.seed}`;
    $('#busy').hidden = true;
  }

  /**
   * Draw the on-screen sheet in *device* pixels: tiles get an integer zoom and
   * the grid is drawn at that resolution, so every line is equally thick even
   * with fractional Windows display scaling (125%, 150%).
   */
  function drawSheet() {
    const view = $('#sheetView');
    if (view.hidden || !tiles) return;
    const mode = TBG.MODES[state.mode];
    const dpr = window.devicePixelRatio || 1;
    const lineWidth = Math.max(1, Math.round(state.gridWidth * dpr));
    const margin = Math.round(state.margin * dpr);
    const g1 = TBG.sheetGeometry(mode, state, { scale: 1, lineWidth, margin });
    const fixedW = g1.width - mode.cols * state.tileSize;
    const fixedH = g1.height - mode.rows * state.tileSize;
    const availW = Math.max(200, view.clientWidth - 48) * dpr;
    const availH = Math.max(240, window.innerHeight - 220) * dpr;
    const scale = Math.max(
      1,
      Math.floor(Math.min((availW - fixedW) / (mode.cols * state.tileSize), (availH - fixedH) / (mode.rows * state.tileSize)))
    );
    const img = TBG.composeSheet(mode, tiles, state, { scale, lineWidth, margin });
    sheetCanvas.width = img.width;
    sheetCanvas.height = img.height;
    sheetCanvas.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    sheetCanvas.style.width = img.width / dpr + 'px';
    sheetCanvas.style.height = img.height / dpr + 'px';
  }

  function updateLegend() {
    const el = $('#gridLegend');
    if (!preview.showGrids) return (el.innerHTML = '');
    el.innerHTML =
      TBG.MODES[state.mode].kind === 'corner'
        ? 'Dual grid: <i style="background:#e8644e"></i>world cells you paint <i style="background:#4fd1c5"></i>tiles, offset by half a tile. Each tile reads its 4 world cells (2<sup>4</sup> = 16).'
        : 'Single grid: <i style="background:#4fd1c5"></i>each painted cell reads its 8 neighbours (2<sup>8</sup> = 256, reduced to 47).';
  }

  function toCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    return c;
  }

  // ------------------------------------------------------------ export

  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function baseName() {
    return `tileset-${state.mode}piece-${state.tileSize}px-${state.seed}`;
  }

  function downloadPng() {
    if (!sheetImage) return;
    let img = sheetImage;
    if (state.upscale1024) {
      // integer tile zoom + uniform grid lines, centred so the long side is exactly 1024
      const mode = TBG.MODES[state.mode];
      img = TBG.composeSheet(mode, tiles, state, TBG.fitToSize(mode, state, 1024));
    }
    toCanvas(img).toBlob((b) => saveBlob(b, baseName() + (state.upscale1024 ? '-1024' : '') + '.png'));
  }

  function downloadJson() {
    const meta = TBG.sheetMetadata(TBG.MODES[state.mode], state);
    meta.settings = state;
    saveBlob(new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }), baseName() + '.json');
  }

  bind();
  update();
  if (new URLSearchParams(location.search).get('tab') === 'preview') $('.tabs [data-tab="preview"]').click();
})();
