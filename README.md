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

## Run with Docker

```bash
docker compose up -d --build   # http://localhost:3000, restarts automatically (also after reboots)
docker compose logs -f         # logs
git pull && docker compose up -d --build   # update
```

## Features

- Drop, pick or paste an image (or try the built-in sample)
- Crop the image (free or square, change it any time); the crop is saved with projects
- Show the original image beside the pattern (cropped area or whole image), with its own zoom —
  also in fullscreen
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
- ✨ Auto suggestions: tries combinations of sampling, colour limit (up to 120), dithering,
  clean-up, matching and brightness/contrast/saturation; scores likeness to the original
  (colour, fine detail, viewing distance, edges, speckle) and ease (fewer colours, fewer stray
  beads); shows a varied list (most faithful, balanced, simplest, smooth shading, crisp…).
  Configurable search space with built-in and saved presets. After the grid search each
  suggestion is fine-tuned on its continuous settings (brightness, contrast, saturation, exact
  colour count, dither strength) by pattern search (default) or simulated annealing, within a
  likeness guard rail. Bookmark (★) suggestions: kept per image across runs and reloads, and
  saved inside projects. Scores: Features (outlines/fine detail kept), Likeness (colour) and
  Ease; fine-tuning aims mainly at keeping features. "Prefer" / "More like this" tunes around
  your picks at the same simplicity. Colour tone (Natural / Vivid / Muted, multi-select)
  targets a richer or softer look. Presets: create, rename, save changes, duplicate, delete
- Fullscreen viewer/editor: fit-to-screen, zoom (buttons, +/−/0, Ctrl/⌘+wheel, pinch), drag to
  pan, all display and edit tools, Esc to exit, Ctrl/⌘+Z to undo
- Works on phones: fits narrow screens, touch-sized controls, drag-to-paint on touch
- Projects: save the image and every setting (including colour swaps and hand edits) under a
  name, then reopen, rename, copy or delete them from a list. Stored in this browser's
  IndexedDB, or on the server (SQLite, shared by every device on the network). "Save as…"
  saves a new version ("Name v2"); projects can be copied between device and server.
  Ctrl/⌘+S saves. Asks before discarding unsaved changes (new image, opening another
  project, leaving the page)
- Bead shopping list; click a bead or colour to highlight, swap or remove colours
- Display as squares (default), beads, crosses or dots, with optional colour codes
- Export dialog with live preview: PNG or PDF, size L/M/S, cell shape, grid, analysis
  diagram (coordinates + guide lines every 5/10), count summary, title, watermark, shadow,
  colour codes, and (PDF) one page per pegboard

## Server storage

`server.ts` serves the app and a small projects API (`src/server/projectsApi.ts`) backed by
SQLite in `$DATA_DIR` (default `./data`; `/app/data` in Docker, on the `bead-data` volume).
There is no authentication — it's meant for a home network.

## Tuning Auto mode

`bun scripts/tune-auto.ts <image> [--width 52] [--wide] [--accurate]` (macOS) prints each
suggestion's metrics and writes a contact sheet PNG.

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
