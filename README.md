# BeadTune

**Auto-tuned bead patterns from any image.** Drop in a photo or drawing, pick your beads and
board size, and BeadTune turns it into a fuse bead pattern with a shopping list — then ✨ Auto
tries hundreds of setting combinations and fine-tunes the best ones, so you can pick the look
you like instead of fiddling with sliders.

Everything runs in your browser: images are never uploaded.

## Features

- **✨ Auto suggestions and tuning** — searches sampling, colour count, dithering, clean-up,
  colour matching and brightness / contrast / saturation, then fine-tunes each suggestion
  (pattern search or simulated annealing). Picks include *Most faithful*, *Most detailed*,
  *Balanced*, *Simplest*, *Smooth shading* and *Crisp*, for natural, vivid or muted colour tones.
  Every result is scored out of 100 on the same scale for the image — **Features** (outlines,
  eyes and faint details kept), **Likeness** (colour) and **Ease** (fewer colours and strays).
  Bookmark results or your own settings, and ask for *More like this*.
- **Image → pattern** — Smooth, Sharp or Pixel art sampling, noise smoothing, crop, background
  removal and trimming, colour limit, minimum beads per colour, Standard or Accurate (CIEDE2000)
  matching, diffusion or ordered dithering, stray-bead clean-up that keeps eyes and sparkles.
- **Beads** — MARD, Perler, Hama, Artkal and Nabbi colour charts in mini (2.6 mm), midi (5 mm)
  and maxi (10 mm) sizes; mix brands of the same size in one pattern; "only colours I have".
- **Editing** — paint and erase with brush sizes 1–5, fill, replace a colour, straight lines
  (Shift-click), pick (Alt-click), undo / redo, keyboard shortcuts, outline ring, swap or remove
  colours.
- **Build mode** — one pegboard at a time: pick a colour to see only its beads, tick beads off
  as you place them, progress saved with the project.
- **Projects** — save, reopen, version (“Save as…”) and search projects in the browser, or on
  your own server when self-hosted with it.
- **Export** — PNG or PDF (one page per pegboard), with colour codes, grid, coordinates and a
  bead count.
- Works on phones; dark and light themes.

## Use it

Open the hosted app, or run it yourself (below). The **Guide** (`guide.html`, linked from the
app) explains each step, the scores, the editing shortcuts and build mode.

## Self-hosting

BeadTune is a static web app. There are two ways to host it.

### 1. Static files (any web host, GitHub Pages)

```bash
bun install
bun run build        # → dist/
```

Upload `dist/` to any static host (GitHub Pages, Cloudflare Pages, Netlify, nginx, an S3
bucket…). Paths are relative, so it also works from a sub-path like `/beadtune/`.
Projects are saved in each visitor's browser (IndexedDB).

**GitHub Pages:** the repo includes `.github/workflows/pages.yml`.

1. Repository *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
   (Pages on a private repository needs a paid GitHub plan.)
2. *Actions → Deploy to GitHub Pages → Run workflow*. It runs the tests, builds and publishes
   to `https://<user>.github.io/<repo>/`.
3. To deploy on every push, add `push: { branches: [main] }` under `on:` in the workflow.

### 2. With the server (adds shared projects)

`server.ts` serves the app and a small projects API backed by SQLite, so projects saved
"on the server" are shared by every device on your network. **It has no login — keep it on a
private network**, don't expose it to the internet as is.

With [Bun](https://bun.sh):

```bash
bun install
bun start            # http://localhost:3000, projects in ./data (set DATA_DIR / PORT to change)
```

With Docker (restarts automatically, also after a reboot):

```bash
docker compose up -d --build                # http://localhost:3000
git pull && docker compose up -d --build    # update
```

Projects live on the `bead-data` volume (`/app/data`); `docker compose down -v` deletes them.
When the server isn't there (static hosting), the app simply saves in the browser and doesn't
offer server storage.

## Development

```bash
bun install
bun dev              # http://localhost:3000 with hot reload
bun test             # logic, drawing, export and UI tests (happy-dom)
bun run typecheck
bun run build        # static site in dist/
bun run palettes     # re-import bead colours from maxcleme/beadcolors
```

Tuning scripts (macOS, they decode images with `sips`):

- `bun scripts/eval-auto.ts [images…] [--width 52] [--tones natural,vivid] [--metric accurate]` —
  runs Auto exactly as the app does and writes contact sheets.
- `bun scripts/bench-auto.ts <image>` — main thread vs the worker pool.
- `bun scripts/tune-auto.ts <image>` — grid-search metrics and refinement comparisons.

## How it works

`src/lib/pipeline.ts` runs: sampling (`sampling.ts`) → colour matching in CIELAB, palette
reduction, dithering (`pattern.ts`) → trim and clean-up (`cleanup.ts`); the app then applies
colour swaps and hand edits. Auto (`src/lib/auto.ts`) builds and scores candidates on a pool of
Web Workers (`autoPool.ts`, `autoWorker.ts`).

## Credits and references

- **Inspiration:** [EasyBeadPattern](https://easybeadpattern.com/) — BeadTune started as a
  re-creation of its "turn any image into a bead pattern" tool, then grew the Auto suggestions
  and tuning. Layout ideas (beads-to-buy panel, per-board PDF pages, build mode) follow it.
- **Bead colours:** [maxcleme/beadcolors](https://github.com/maxcleme/beadcolors) (MIT) —
  colour charts for MARD, Perler, Hama, Artkal, Nabbi and more. Colours on screen are
  approximate; check against your real beads.
- **Colour science:** CIELAB and the CIEDE2000 colour difference (Sharma, Wu & Dalal, 2005);
  Floyd–Steinberg error diffusion and Bayer ordered dithering.
- **Libraries:** [React](https://react.dev/), [jsPDF](https://github.com/parallax/jsPDF),
  [Bun](https://bun.sh/) (runtime, bundler, test runner, SQLite); tests use
  [happy-dom](https://github.com/capricorn86/happy-dom) and
  [Testing Library](https://testing-library.com/).
- **Font:** [Nunito](https://fonts.google.com/specimen/Nunito) (SIL Open Font License).

## Licence

[MIT](LICENSE) © 2026 Sara Tran. Bead colour data from maxcleme/beadcolors is also MIT
(its licence is kept in `src/lib/beadcolors.gen.ts`).
