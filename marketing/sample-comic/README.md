# Sample comic page: Halloween Cookies

Six-panel gag for the "Letter it in Varve" campaign. Flat-colour vector built from code-drawn shapes, OFL font only.

## Story

1. Baker in the kitchen with cookie cutters. Caption: *That morning...*
2. Overhead: hands decorating a ghost cookie and a pumpkin cookie.
3. Baker: **Perfect!** (speech balloon + pointed tail)
4. Empty kitchen, door ajar. Caption: *Later that night...*
5. Cookies glow and wake up. **WE'RE ALIVE!** (shout balloon + pointed tail)
6. Baker returns. *Did I use magic flour...?* (thought balloon + bubble chain)

## Files

| File | What |
| --- | --- |
| `halloween-cookies.varve` | Editable 2.33 design-canvas document |
| `halloween-cookies.png` | Page crop from the web editor canvas |
| `halloween-cookies-unlettered.png` | Same page with callouts hidden |
| `halloween-cookies.pdf` | Raster PDF 1.4 of the lettered PNG (not PDF/X) |
| `generate.ts` | Canonical generator (`createDocument` + `createDesignCanvas` + `createCallout`) |
| `generate.mjs` | tsx wrapper |
| `export.mjs` | Opens the file in the desktop Vite app and writes the rasters |

```
node marketing/sample-comic/generate.mjs
node marketing/sample-comic/export.mjs
```

## Lettering

Balloons are real `GroupNode.callout` recipes (scene `createCallout`). 0.5.0 can switch kind in the Inspector after a balloon exists. This page ships speech, thought, shout, and caption so the campaign can show those types without claiming a dedicated "add thought balloon" button.

## Caption and licence

- Caption (exact): "Built from Varve vector shapes; generated with code."
- The sample art files (`halloween-cookies.varve`, `halloween-cookies.png`, `halloween-cookies-unlettered.png` and `halloween-cookies.pdf`) are dedicated to the public domain under CC0 1.0 Universal. Fonts, the Varve name and logo, and any third-party assets are not included. See [`LICENSE-SAMPLE.md`](LICENSE-SAMPLE.md) for exactly what is covered.
- The scripts in this folder (such as `generate.ts`, `generate.mjs` and `export.mjs`) are not part of the dedication. They stay under the repository licence (FSL-1.1-MIT).
- This is a sample from the Varve team, not a challenge entry.

See `COMIC_FEATURES_AUDIT.md` and `STATUS.md`.
