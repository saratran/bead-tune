# Bead Pattern Maker

Turn any image into a fuse bead (Perler / Hama) pattern. Everything runs in the browser — images are never uploaded.

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
- Bead brand palettes (Perler, Hama), width in beads with 1–4 pegboard presets (29 × 29)
- Colour limit, dithering, background removal, clear/glitter/neon toggle, "only colours I have"
- Brightness / contrast / saturation
- Bead shopping list; click a bead or colour to highlight, swap or remove colours
- Export PNG, or a PDF with a cover page + one symbol grid page per pegboard

## How it works

`src/lib/pattern.ts` — downscale → adjust → background flood-fill from the border →
nearest bead colour in CIELAB → reduce to N colours by greedily merging the colour that is
cheapest to repaint → optional Floyd–Steinberg dithering.

Palette hex values in `src/lib/palettes.ts` are approximations; add brands there.
