# Bead Pattern Maker

Turn any image into a fuse bead pattern (MARD, Perler — any bead size). Everything runs in the browser — images are never uploaded.

## Run

```bash
bun install
bun dev          # http://localhost:3000 (hot reload)
bun test         # unit tests for the pattern pipeline
bun run typecheck
bun run build    # static site in dist/
```

## Features

- Drop, pick or paste an image (or try the built-in sample)
- Colour presets: MARD 221 (A–M, default), MARD 291, Perler — works for any bead size
- Width in beads (presets 52 / 78 / 104) and adjustable pegboard size
- Colour limit, dithering, background removal, "only colours I have"
- Brightness / contrast / saturation
- Bead shopping list; click a bead or colour to highlight, swap or remove colours
- Export PNG, or a PDF with a cover page + one symbol grid page per pegboard

## How it works

`src/lib/pattern.ts` — downscale → adjust → background flood-fill from the border →
nearest bead colour in CIELAB → reduce to N colours by greedily merging the colour that is
cheapest to repaint → optional Floyd–Steinberg dithering.

## Colour data

Presets come from [maxcleme/beadcolors](https://github.com/maxcleme/beadcolors) (MIT).
`bun run palettes` regenerates `src/lib/beadcolors.gen.ts`; presets are defined in `src/lib/palettes.ts`.
