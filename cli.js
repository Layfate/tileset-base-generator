#!/usr/bin/env node
/*
 * Command-line tileset generator (no dependencies).
 *
 *   node cli.js --mode 47 --size 32 --out blob.png
 *   node cli.js --mode 15 --size 16 --preset sand --elevation --json
 *
 * Run `node cli.js --help` for every option.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const TBG = require('./src/layouts.js');
require('./src/generator.js');
const { PRESETS, defaultOptions } = require('./src/presets.js');

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[key] = true;
    else {
      a[key] = next;
      i++;
    }
  }
  return a;
}

const HELP = `tileset-base-generator CLI

Options:
  --mode <15|16|17|47>     tileset format              (default 17)
  --size <16|32|64>        tile size in px             (default 32)
  --seed <n>               random seed                 (default 31415)
  --style <rough|clean>    edge style                  (default rough)
  --radius <px>            corner radius
  --padding <px>           distance from an open edge (16/17/47)
  --offset <px>            15-piece: terrain reach past the tile centre
  --noise <px>             edge noise amplitude
  --noise-size <px>        edge noise feature size
  --jitter <0-90>          rough style: 1px raggedness (default 28)
  --preset <name>          ${Object.keys(PRESETS).join(', ')}
  --base/--edge/--rock/--rim-color <#hex>  colours
  --rim                    light rim just inside the outline
  --elevation              draw a rock wall under south edges
  --wall-height <px>       wall height
  --shades <n>             colours in base->edge ramp
  --fade <px>              edge fade width
  --texture <0-50>         texture noise
  --flecks <n>             fleck density (0 = off)
  --transparent            transparent background (default white)
  --no-grid                no grid lines
  --grid-width <px>        grid line thickness (default 1, same at any scale)
  --grid-color <#hex>      grid line colour (default #000000)
  --margin <px>            even padding around the sheet (default 0)
  --no-join                15-piece: don't join the two diagonal tiles
  --scale <n>              integer zoom for tile pixels (lines stay thin)
  --fit <px>               largest integer zoom that fits, long side exactly <px>
  --out <file.png>         output path (default tileset-<mode>-<size>.png)
  --json                   also write <out>.json tile metadata
`;

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || a.h) return console.log(HELP);
  const mode = TBG.MODES[String(a.mode || '17')];
  if (!mode) throw new Error('Unknown --mode, use 15, 16, 17 or 47');
  const size = Number(a.size || 32);
  if (![16, 32, 64].includes(size)) throw new Error('--size must be 16, 32 or 64');

  const o = defaultOptions(size);
  const preset = PRESETS[a.preset] || null;
  if (a.preset && !preset) throw new Error('Unknown --preset');
  if (preset) Object.assign(o, TBG.presetStyle(preset, o.tileSize), { colors: { ...o.colors, ...TBG.presetColors(preset) } });
  const num = (k, key) => {
    if (a[k] !== undefined) o[key] = Number(a[k]);
  };
  num('seed', 'seed');
  num('radius', 'radius');
  num('padding', 'padding');
  num('offset', 'cornerOffset');
  num('jitter', 'jitter');
  num('noise', 'noise');
  num('noise-size', 'noiseSize');
  num('wall-height', 'wallHeight');
  num('shades', 'shades');
  num('fade', 'fade');
  num('texture', 'texture');
  if (a.flecks !== undefined) {
    o.flecks = Number(a.flecks);
    o.flecksOn = o.flecks > 0;
  }
  if (a.style) o.rough = a.style !== 'clean';
  if (a.elevation) o.elevation = true;
  if (a.transparent) o.whiteBg = false;
  if (a['no-grid']) o.grid = false;
  for (const c of ['base', 'edge', 'rock']) if (a[c]) o.colors[c] = a[c];
  if (a['rim-color']) o.colors.rim = a['rim-color'];

  if (a['grid-width'] !== undefined) o.gridWidth = Number(a['grid-width']);
  if (a.margin !== undefined) o.margin = Number(a.margin);
  if (a['grid-color']) o.gridColor = a['grid-color'];
  if (a['no-join']) o.joinDiagonals = false;
  if (a.rim) o.rimLight = true;

  const tiles = TBG.renderTiles(mode, o);
  const layout = a.fit
    ? TBG.fitToSize(mode, o, Number(a.fit))
    : { scale: Math.max(1, Number(a.scale || 1) | 0) };
  const sheet = TBG.composeSheet(mode, tiles, o, layout);
  const out = path.resolve(a.out && a.out !== true ? a.out : `tileset-${mode.id}-${size}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, encodePNG(sheet.width, sheet.height, sheet.data));
  console.log(`wrote ${out} (${sheet.width}x${sheet.height})`);
  if (a.json) {
    const jsonPath = out.replace(/\.png$/i, '') + '.json';
    fs.writeFileSync(jsonPath, JSON.stringify(TBG.sheetMetadata(mode, o), null, 2));
    console.log(`wrote ${jsonPath}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error('error: ' + e.message);
    process.exit(1);
  }
}

module.exports = { encodePNG };
