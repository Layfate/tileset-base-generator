# Tileset Base Generator

A free, open-source generator for **seamless autotile tileset bases**. Choose a format and a tile size, adjust the shape and colours, and download a PNG sprite sheet plus JSON tile metadata.

- **Formats:** 15-piece (Wang corner), 17-piece (top-down), 47-piece (blob)
- **Tile sizes:** 16, 32 and 64 px
- Rough or clean edges, corner radius, padding, edge noise, shading ramp, texture, flecks
- Optional **elevation edge** (a rock cliff face under south-facing edges)
- **Map preview:** paint terrain and watch the tiles autotile in real time
- PNG export (native or 1024 px nearest-neighbour upscale) and JSON metadata
- No build step and no dependencies: open `index.html` and it runs offline

**Live app:** https://layfate.github.io/tileset-base-generator/

![Generator UI](docs/images/ui.png)

## Formats

| 15-piece corner (Wang) | 17-piece top-down | 47-piece blob |
| :---: | :---: | :---: |
| ![15](docs/images/sheet-15.png) | ![17](docs/images/sheet-17.png) | ![47](docs/images/sheet-47.png) |

### 15-piece: corner / Wang 2-corner / marching squares

Each tile is defined by which of its **4 corners** are terrain. That gives 16 combinations: 15 tiles plus one empty tile. This is the cheapest set that handles any map, including diagonals and inner corners. The sheet is laid out so the 16 tiles also join into one continuous picture.

Corner bitmask: `TL = 1, TR = 2, BR = 4, BL = 8`. With this format you paint **grid vertices**, not cells.

### 17-piece: top-down

A classic hand-drawn top-down set:

- a 3×3 block (9 tiles)
- a vertical strip (3) and a horizontal strip (3)
- a single island (1)
- a cross tile with four inner corners (1)

It covers rectangular landmasses of any size. It has no T-junction tiles, so the map preview falls back to the closest tile when you paint shapes the set can't represent.

### 47-piece: blob

Each tile is defined by its **8 neighbours**. A corner only counts when both sides next to it are also terrain, which reduces 256 combinations to 47 unique tiles. This is the complete set: any painted shape tiles correctly.

Edge bitmask (clockwise from north): `N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128`.

The sheet uses the common **12×4 layout**. The left 4×4 block holds the 16 tiles with no filled corners: strips, a single island, and a 3×3 block whose inner corners are all notched. The middle and right blocks hold the tiles with mixed corners. There's one empty slot at row 1, column 10.

![47 stone elevation](docs/images/sheet-47-stone-elevation.png)

## Using the web app

Open the [live app](https://layfate.github.io/tileset-base-generator/), or clone the repo and double-click `index.html`. No server is needed.

| Control | What it does |
| --- | --- |
| Mode / Tile size | Tileset format and tile size in pixels |
| Edge style | **Rough**: pixel-jittered edges. **Clean**: smooth wobble only |
| Corner radius | Rounds outer and inner corners |
| Tile padding | Gap between the terrain and an open tile edge (17 / 47) |
| Edge noise / Noise size | Strength and feature size of the edge wobble |
| Base / Edge / Rock | Fill colour, outline colour, cliff colour |
| Elevation edge / Wall height | Draws a cliff face under south-facing edges |
| Shades / Edge fade | Number of colours from outline to fill, and how wide the fade is |
| Texture noise / Flecks | Interior variation and grass-style flecks |
| White bg / Black grid | Sheet background and 1 px separator lines |
| 1024 upscale | Exports with the longest side scaled to 1024 px (nearest neighbour) |

Shortcuts: <kbd>R</kbd> picks a new seed, <kbd>Ctrl</kbd>+<kbd>S</kbd> downloads the PNG.
Settings are saved in your browser. URL parameters work too, for example `?mode=47&size=16&seed=7&preset=sand&elevation=1&tab=preview`.

## Command line

Requires Node.js 16 or newer. No `npm install` needed.

```bash
node cli.js --mode 47 --size 32 --out blob.png --json
node cli.js --mode 15 --size 16 --preset sand --elevation --scale 4
node cli.js --help
```

`--json` also writes a metadata file containing each tile's position and bitmask.

## Importing into an engine

The JSON file lists every tile's `x`, `y`, `col`, `row` and `mask`, plus `margin` and `spacing`. Spacing is 1 when the black grid is on and 0 when it's off. For engine import, turn off **Black grid** and **White bg** so you get a clean, transparent sheet.

- **Godot 4:** create a TileSet atlas with the PNG. Use the terrain mode *Match Corners* for the 15-piece set and *Match Corners and Sides* for the 47-piece set, and set each tile's peering bits from `connects` in the JSON.
- **Tiled:** create a Terrain Set. Use *Corner* for 15-piece and *Mixed* for 47-piece.
- **Unity:** use a Rule Tile, with one rule per mask.
- **GameMaker:** the 47-piece mask order works with any standard blob autotile lookup.

## How it works

Every tile is rendered on an extended grid: the tile plus a margin on all sides.

1. Build a binary shape from the tile's connectivity mask, extending it into the margin.
2. Apply a morphological close and open (built on a Euclidean distance transform) to round the corners.
3. Build a signed distance field and offset it with value noise. The noise **repeats every tile width**, so any edge joins seamlessly with any compatible neighbour.
4. Remove stray single pixels, add the optional cliff face, then shade by distance to the edge.

`test/seams.test.js` checks every format, every tile size and several settings. It verifies that open edges stay empty and that connected edges line up across tiles:

```bash
npm test
```

## Project layout

```
index.html          web app
src/layouts.js      formats, bitmasks, sheet layouts
src/generator.js    tile renderer (shared by web + CLI)
src/presets.js      colour presets and defaults
src/preview.js      autotiled map preview
src/main.js         UI wiring
src/styles.css      UI styles
cli.js              Node CLI with a built-in PNG encoder
test/               seam tests
```

## Contributing

Issues and pull requests are welcome. Ideas: isometric 2:1 projection, more presets, Godot `.tres` / Tiled `.tsx` export, more sheet layouts.

## License

[MIT](LICENSE)
