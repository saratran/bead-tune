# Bead Pattern Maker

Turn any image into a fuse bead pattern (MARD, Perler — any bead size). Everything runs in the browser — images are never uploaded.

## Run

```bash
bun install
bun dev          # http://localhost:3000 (hot reload)
bun test         # all tests (logic, canvas drawing, export, UI components)
bun test --coverage
bun run typecheck
bun run build    # static site in dist/
```

## Features

- Drop, pick or paste an image (or try the built-in sample)
- Colour presets: MARD 221 (A–M, default), MARD 291, Perler — works for any bead size
- Width in beads (presets 52 / 78 / 104) and adjustable pegboard size
- Sampling: Smooth (photos), Sharp (crisp edges for drawings/logos) or Pixel art (detects the
  grid of enlarged pixel art and reproduces it bead for bead); optional noise smoothing
- Background removal with tolerance and a pick-from-image colour; auto-trim to the subject
- Colour limit, minimum beads per colour, Standard (CIE76) or Accurate (CIEDE2000) matching,
  diffusion or ordered dithering with strength, "only colours I have"
- Clean-up: remove stray beads/small groups, one-bead outline in any colour
- Brightness / contrast / saturation
- Hand editing: paint, erase and pick colours bead by bead, with undo
- Works on phones: fits narrow screens, touch-sized controls, drag-to-paint on touch
- Bead shopping list; click a bead or colour to highlight, swap or remove colours
- Display as squares (default), beads, crosses or dots, with optional colour codes
- Export dialog with live preview: PNG or PDF, size L/M/S, cell shape, grid, analysis
  diagram (coordinates + guide lines every 5/10), count summary, title, watermark, shadow,
  colour codes, and (PDF) one page per pegboard

## Tests

- `src/lib/*.test.ts` — colour maths, palettes, pattern pipeline, drawing, export layout and PNG/PDF files
- `src/components/*.test.tsx` — React components and App defaults, rendered with Testing Library
- Tests run in happy-dom (preloaded via `bunfig.toml`). It has no canvas, so `src/test/canvas-mock.ts`
  records drawing calls and tests assert on what was drawn.

## How it works

`src/lib/pipeline.ts` runs the steps in order:

1. `sampling.ts` — sample the image at 4× per bead, optionally median-filter, then average
   (Smooth) or take each block's dominant colour (Sharp); or detect a pixel-art grid
2. `pattern.ts` — adjust → flood-fill background from the border → match bead colours in
   CIELAB → reduce to N colours by merging the cheapest-to-repaint colour → dithering →
   drop colours below the minimum bead count
3. `cleanup.ts` — trim (re-sampling just the subject), remove strays, add outline
4. In the app: colour swaps, then hand edits

## Colour data

Presets come from [maxcleme/beadcolors](https://github.com/maxcleme/beadcolors) (MIT).
`bun run palettes` regenerates `src/lib/beadcolors.gen.ts`; presets are defined in `src/lib/palettes.ts`.
