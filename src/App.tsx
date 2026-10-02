import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BeadList } from "./components/BeadList";
import { ColorPicker } from "./components/ColorPicker";
import { Dropzone } from "./components/Dropzone";
import { DEFAULT_IMAGE_SETTINGS, ImageOptions, type ImageSettings } from "./components/ImageOptions";
import { PatternView, type EditTool } from "./components/PatternView";
import { ProjectsDialog } from "./components/ProjectsDialog";
import { applyEdits, type Edits } from "./lib/cleanup";
import { BRANDS, colorLabel, DEFAULT_BRAND_ID, getBrand, type BeadColor } from "./lib/palettes";
import { applySwaps, type Pattern } from "./lib/pattern";
import { buildPattern } from "./lib/pipeline";
import { loadProjectImage, requestPersistentStorage, saveProject, type ProjectMeta, type ProjectState } from "./lib/projects";
import { canvasSource } from "./lib/sampling";
import { ExportDialog } from "./components/ExportDialog";
import { DisplayControls, EditBar, type DisplaySettings } from "./components/PatternControls";
import { Toggle } from "./components/Toggle";
import { DEFAULT_EXPORT, type ExportSettings } from "./lib/export";
import { drawPattern } from "./lib/render";
import { makeSampleImage } from "./lib/sample";

const WIDTH_PRESETS = [52, 78, 104];
const OWNED_KEY = "bead-pattern:owned";
const THEME_KEY = "bead-pattern:theme";
const DISPLAY_KEY = "bead-pattern:display";
const EXPORT_KEY = "bead-pattern:export";

const DEFAULT_DISPLAY: DisplaySettings = { shape: "square", codes: false };

/** Stored settings merged over defaults, so new fields get sensible values. */
function loadStored<T extends object>(key: string, defaults: T): T {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? "{}") };
  } catch {
    return defaults;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

type Theme = "dark" | "light";

function loadTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function loadOwned(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(OWNED_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveOwned(v: Record<string, string[]>) {
  try {
    localStorage.setItem(OWNED_KEY, JSON.stringify(v));
  } catch {}
}

/** Decodes an image file. Uses a data URL so there's no object URL to revoke later. */
function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("Couldn't read that image."));
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = fail;
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

type Modal = { kind: "owned" } | { kind: "swap"; from: BeadColor } | { kind: "outline" } | { kind: "brush" } | null;

const MAX_UNDO = 50;
const THUMB_SIZE = 160;

/** Re-encodes an image as PNG (for images that don't come from a file, like the sample). */
function imageToBlob(img: HTMLImageElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't save the image."))), "image/png"));
}

/** Small square-cell picture of the pattern for the project list. */
function makeThumbnail(p: Pattern): string {
  const cell = Math.max(1, Math.floor(THUMB_SIZE / Math.max(p.width, p.height)));
  const canvas = document.createElement("canvas");
  canvas.width = p.width * cell;
  canvas.height = p.height * cell;
  drawPattern(canvas.getContext("2d")!, p, {
    cell,
    shape: "square",
    codes: false,
    boardSize: p.width,
    showBoards: false,
    background: "#ffffff",
    gridColor: "rgba(0, 0, 0, 0)",
  });
  return canvas.toDataURL("image/png");
}

/** Darkest colour in a palette — the natural default for outlines. */
function darkest(colors: BeadColor[]): BeadColor {
  return colors.reduce((a, b) => (b.lab[0] < a.lab[0] ? b : a));
}

export function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState("pattern");
  const [project, setProject] = useState<{ id: string; name: string } | null>(null);
  const [savedJson, setSavedJson] = useState<string | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  // Resolves the pending "discard unsaved changes?" question.
  const [discardPrompt, setDiscardPrompt] = useState<((proceed: boolean) => void) | null>(null);
  // Set when a project was just opened: the next state snapshot is its "saved" state.
  const markSaved = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const [brandId, setBrandId] = useState(DEFAULT_BRAND_ID);
  const [width, setWidth] = useState(WIDTH_PRESETS[0]!);
  const [boardInput, setBoardInput] = useState(26);
  const [imageSettings, setImageSettings] = useState<ImageSettings>(DEFAULT_IMAGE_SETTINGS);
  const [outlineId, setOutlineId] = useState<string | null>(null);
  const [pickingBg, setPickingBg] = useState(false);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [owned, setOwned] = useState(loadOwned);
  const [showBoards, setShowBoards] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [display, setDisplayState] = useState(() => loadStored(DISPLAY_KEY, DEFAULT_DISPLAY));
  const [exportSettings, setExportState] = useState(() => loadStored(EXPORT_KEY, DEFAULT_EXPORT));
  const [exportOpen, setExportOpen] = useState(false);
  const setDisplay = (d: DisplaySettings) => {
    setDisplayState(d);
    store(DISPLAY_KEY, d);
  };
  const setExportSettings = (s: ExportSettings) => {
    setExportState(s);
    store(EXPORT_KEY, s);
  };

  // Layout effect so the theme is applied before children draw the canvas.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);

  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [swaps, setSwaps] = useState<Map<string, BeadColor>>(new Map());
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);

  // Hand edits, keyed by cell index for a pattern of size `w` × `h`.
  const [edits, setEdits] = useState<{ w: number; h: number; map: Edits }>({ w: 0, h: 0, map: new Map() });
  const [undoStack, setUndoStack] = useState<Edits[]>([]);
  const [tool, setTool] = useState<EditTool | null>(null);
  const [brush, setBrush] = useState<BeadColor | null>(null);

  const brand = getBrand(brandId);
  const ownedSet = useMemo(() => new Set(owned[brand.source] ?? []), [owned, brand.source]);

  const resetEdits = useCallback(() => {
    setExcluded(new Set());
    setSwaps(new Map());
    setHighlightId(null);
  }, []);

  const clearHandEdits = useCallback(() => {
    setEdits({ w: 0, h: 0, map: new Map() });
    setUndoStack([]);
  }, []);

  /** A new image starts a new, unsaved project with no colour or hand edits. */
  const startImage = useCallback(
    (img: HTMLImageElement, blob: Blob, name: string) => {
      setImage(img);
      setImageBlob(blob);
      setFileName(name);
      setProject(null);
      setSavedJson(null);
      setPickingBg(false);
      resetEdits();
      clearHandEdits();
    },
    [resetEdits, clearHandEdits],
  );

  const onFile = async (file: File) => {
    if (!(await confirmDiscard())) return;
    try {
      setError(null);
      startImage(await loadImage(file), file, file.name.replace(/\.[^.]+$/, "") || "pattern");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const changeBrand = (id: string) => {
    setBrandId(id);
    resetEdits();
    clearHandEdits();
  };

  const palette = useMemo(
    () =>
      brand.colors.filter(
        (c) => (!ownedOnly || ownedSet.has(c.id)) && !excluded.has(c.id),
      ),
    [brand, ownedOnly, ownedSet, excluded],
  );

  const outlineColor = brand.colors.find((c) => c.id === outlineId) ?? darkest(brand.colors);
  const source = useMemo(() => (image ? canvasSource(image) : null), [image]);

  // Defer the expensive inputs so sliders stay smooth while dragging.
  const dWidth = useDeferredValue(width);
  const dSettings = useDeferredValue(imageSettings);

  const result = useMemo(() => {
    if (!source) return null;
    const { sampling, denoise, trim, cleanup, outline, ...options } = dSettings;
    return buildPattern(source, {
      width: Math.max(2, Math.min(300, dWidth || 1)),
      sampling,
      denoise,
      trim,
      cleanup,
      outline: outline ? outlineColor : null,
      options: { ...options, palette },
    });
  }, [source, dWidth, dSettings, palette, outlineColor]);

  const swapped = useMemo(() => (result ? applySwaps(result.pattern, swaps) : null), [result, swaps]);

  // Hand edits only apply to a grid of the size they were made on; they're set
  // aside (not lost) while the size differs, and replaced by the next stroke.
  const editsFit = swapped && edits.w === swapped.width && edits.h === swapped.height;

  const pattern = useMemo(() => (swapped && editsFit ? applyEdits(swapped, edits.map) : swapped), [swapped, editsFit, edits]);

  const onEdit = (index: number, phase: "start" | "move") => {
    if (!pattern) return;
    if (tool === "pick") {
      const idx = pattern.cells[index]!;
      if (idx >= 0) {
        setBrush(pattern.colors[idx]!);
        setTool("paint");
      }
      return;
    }
    const value = tool === "erase" ? null : (brush ?? pattern.colors[0] ?? null);
    if (tool === "paint" && !value) return;
    if (phase === "start") {
      // One undo step per stroke.
      const snapshot = editsFit ? edits.map : new Map();
      setUndoStack((u) => [...u.slice(-MAX_UNDO + 1), snapshot]);
    }
    setEdits((prev) => {
      const fits = prev.w === pattern.width && prev.h === pattern.height;
      const map = new Map(fits ? prev.map : undefined);
      map.set(index, value);
      return { w: pattern.width, h: pattern.height, map };
    });
  };

  const undo = () => {
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    setUndoStack(undoStack.slice(0, -1));
    setEdits((e) => ({ ...e, map: prev }));
  };

  /** Eyedropper on the source thumbnail: sample the clicked pixel as the background colour. */
  const pickBackground = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!pickingBg || !source) return;
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    // The thumbnail uses object-fit: contain, so account for letterboxing.
    const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
    const ox = (rect.width - img.naturalWidth * scale) / 2;
    const oy = (rect.height - img.naturalHeight * scale) / 2;
    const native = source.native();
    const fx = (e.clientX - rect.left - ox) / (img.naturalWidth * scale);
    const fy = (e.clientY - rect.top - oy) / (img.naturalHeight * scale);
    if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) return;
    const i = (Math.floor(fy * native.height) * native.width + Math.floor(fx * native.width)) * 4;
    setImageSettings({ ...imageSettings, bgColor: [native.data[i]!, native.data[i + 1]!, native.data[i + 2]!] });
    setPickingBg(false);
  };

  // Clamp so a blank or zero input can't break the board math.
  const boardSize = Math.max(5, Math.min(100, Math.round(boardInput) || 26));
  const boardsX = pattern ? Math.ceil(pattern.width / boardSize) : 0;
  const boardsY = pattern ? Math.ceil(pattern.height / boardSize) : 0;

  const swapColor = (from: BeadColor, to: BeadColor) => {
    const next = new Map<string, BeadColor>();
    for (const [k, v] of swaps) next.set(k, v.id === from.id ? to : v);
    if (from.id !== to.id) next.set(from.id, to);
    else next.delete(from.id);
    setSwaps(next);
    setHighlightId(to.id);
    setModal(null);
  };

  const removeColor = (c: BeadColor) => {
    const nextExcluded = new Set(excluded).add(c.id);
    const nextSwaps = new Map(swaps);
    for (const [k, v] of swaps) {
      if (v.id === c.id) {
        nextSwaps.delete(k);
        nextExcluded.add(k);
      }
    }
    setExcluded(nextExcluded);
    setSwaps(nextSwaps);
    if (highlightId === c.id) setHighlightId(null);
  };

  const projectState: ProjectState = useMemo(
    () => ({
      version: 1,
      brandId,
      width,
      boardSize,
      image: imageSettings,
      outlineId,
      ownedOnly,
      excluded: [...excluded],
      swaps: [...swaps].map(([from, to]) => [from, to.id]),
      edits: { w: edits.w, h: edits.h, cells: [...edits.map].map(([i, c]) => [i, c?.id ?? null]) },
    }),
    [brandId, width, boardSize, imageSettings, outlineId, ownedOnly, excluded, swaps, edits],
  );
  const projectJson = useMemo(() => JSON.stringify(projectState), [projectState]);
  const dirty = !!project && projectJson !== savedJson;
  // Work that would be lost: changes to an open project, or hand/colour edits on an unsaved image.
  const unsavedWork = project ? dirty : !!image && (edits.map.size > 0 || swaps.size > 0 || excluded.size > 0);

  /** Asks before replacing unsaved work; resolves true to go ahead. */
  const confirmDiscard = (): Promise<boolean> =>
    unsavedWork ? new Promise((resolve) => setDiscardPrompt(() => resolve)) : Promise.resolve(true);

  const answerDiscard = async (choice: "save" | "discard" | "cancel") => {
    const resolve = discardPrompt;
    setDiscardPrompt(null);
    if (!resolve) return;
    if (choice === "save") {
      if (!project) {
        // Needs a name first: open the save dialog and stop here.
        resolve(false);
        setProjectsOpen(true);
        return;
      }
      try {
        await save(project.name);
      } catch (e) {
        setError((e as Error).message);
        resolve(false);
        return;
      }
    }
    resolve(choice !== "cancel");
  };

  // The browser's own "leave site?" warning while there's unsaved work.
  useEffect(() => {
    if (!unsavedWork) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsavedWork]);

  useEffect(() => {
    if (!markSaved.current) return;
    markSaved.current = false;
    setSavedJson(projectJson);
  }, [projectJson]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const save = async (name: string, asNew = false) => {
    if (!imageBlob || !pattern) throw new Error("Add an image first.");
    const saved = await saveProject({
      id: asNew ? undefined : project?.id,
      name,
      image: imageBlob,
      imageName: fileName,
      thumbnail: makeThumbnail(pattern),
      state: projectState,
    });
    requestPersistentStorage();
    setProject({ id: saved.id, name: saved.name });
    setSavedJson(projectJson);
    setNotice(`Saved “${saved.name}”`);
  };

  const quickSave = () => {
    if (project) save(project.name).catch((e) => setError((e as Error).message));
    else setProjectsOpen(true);
  };

  /** Returns false if the user chose to keep their unsaved work instead. */
  const openProject = async (meta: ProjectMeta): Promise<boolean> => {
    if (!(await confirmDiscard())) return false;
    const blob = await loadProjectImage(meta.id);
    if (!blob) throw new Error("This project's image is missing.");
    const img = await loadImage(blob);
    const st = meta.state;
    const b = getBrand(st.brandId);
    const byId = new Map(b.colors.map((c) => [c.id, c]));
    setImage(img);
    setImageBlob(blob);
    setFileName(meta.imageName || meta.name);
    setBrandId(b.id);
    setWidth(st.width);
    setBoardInput(st.boardSize);
    setImageSettings({ ...DEFAULT_IMAGE_SETTINGS, ...st.image });
    setOutlineId(st.outlineId);
    setOwnedOnly(st.ownedOnly);
    setExcluded(new Set(st.excluded));
    setSwaps(new Map(st.swaps.flatMap(([from, to]) => (byId.has(to) ? [[from, byId.get(to)!] as const] : []))));
    setEdits({
      w: st.edits.w,
      h: st.edits.h,
      map: new Map(
        st.edits.cells.flatMap(([i, id]): [number, BeadColor | null][] => (id === null ? [[i, null]] : byId.has(id) ? [[i, byId.get(id)!]] : [])),
      ),
    });
    setUndoStack([]);
    setHighlightId(null);
    setTool(null);
    setPickingBg(false);
    setError(null);
    setProject({ id: meta.id, name: meta.name });
    markSaved.current = true;
    setNotice(`Opened “${meta.name}”`);
    return true;
  };

  const clampZoom = (z: number) => Math.min(8, Math.max(1, z));
  const zoomBy = useCallback((factor: number) => setZoom((z) => clampZoom(z * factor)), []);

  const enterFullscreen = () => {
    setZoom(1);
    setFullscreen(true);
    // Real fullscreen where supported (not on iPhone); the overlay covers the window either way.
    // The whole page goes fullscreen so dialogs (brush colour etc.) still show on top.
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const exitFullscreen = useCallback(() => {
    setFullscreen(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);

  // Leaving browser fullscreen (e.g. its own Esc handling) also closes the overlay.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Fullscreen keys: Esc exits, + / − / 0 zoom, Ctrl/⌘+Z undoes. Ignored while typing or in a dialog.
  const undoRef = useRef(() => {});
  useEffect(() => {
    if (!fullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      // Key events can target the window itself, which has no closest().
      const typing = e.target instanceof Element && e.target.closest("input, textarea, select");
      if (typing || document.querySelector(".modal-backdrop")) return;
      if (e.key === "Escape") exitFullscreen();
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoRef.current();
      } else if (e.metaKey || e.ctrlKey || e.altKey) return;
      else if (e.key === "+" || e.key === "=") zoomBy(1.25);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.25);
      else if (e.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [fullscreen, exitFullscreen, zoomBy]);

  // Ctrl/⌘+S saves the open project (or opens the save dialog).
  const quickSaveRef = useRef(quickSave);
  quickSaveRef.current = quickSave;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        quickSaveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  undoRef.current = undo;
  const brushOrDefault = brush ?? pattern?.colors[0] ?? null;
  const editBar = tool && (
    <EditBar
      tool={tool}
      onTool={setTool}
      brush={brushOrDefault}
      onChooseBrush={() => setModal({ kind: "brush" })}
      canUndo={undoStack.length > 0}
      onUndo={undo}
      canClear={!!editsFit && edits.map.size > 0}
      onClear={clearHandEdits}
    />
  );

  const edited = excluded.size > 0 || swaps.size > 0;
  const ownedEmpty = ownedOnly && ownedSet.size === 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            <i /> <i /> <i /> <i />
          </span>
          Bead Pattern Maker
        </div>
        <div className="topbar-right">
          <span className="muted small privacy-note">Your image never leaves your browser</span>
          {project && (
            <span className="project-status small" title={dirty ? "Unsaved changes" : "Saved"}>
              {project.name}
              {dirty && <span className="unsaved-dot" aria-label="Unsaved changes" />}
            </span>
          )}
          <button className="theme-btn" disabled={!image} onClick={quickSave}>
            Save
          </button>
          <button className="theme-btn" onClick={() => setProjectsOpen(true)}>
            Projects
          </button>
          <button className="theme-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </header>

      <section className="hero">
        <h1>Turn any image into a bead pattern</h1>
        <p>Pick a photo or drawing, choose your beads and board size, and get a printable pattern with a shopping list.</p>
      </section>

      <main className="layout">
        <aside className="card controls">
          {image ? (
            <div className="source">
              <img
                src={image.src}
                alt="Source"
                className={pickingBg ? "picking" : ""}
                title={pickingBg ? "Click the background colour" : undefined}
                onClick={pickBackground}
              />
              <Dropzone onFile={onFile} compact />
            </div>
          ) : (
            <>
              <Dropzone onFile={onFile} />
              <button
                className="btn btn-ghost full"
                onClick={async () => {
                  const img = await makeSampleImage();
                  startImage(img, await imageToBlob(img), "sample");
                }}
              >
                Try a sample image
              </button>
            </>
          )}
          {error && <p className="error">{error}</p>}

          <div className="field">
            <label htmlFor="brand">Beads</label>
            <select id="brand" className="input" value={brandId} onChange={(e) => changeBrand(e.target.value)}>
              {BRANDS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="width">
              Width <span className="muted">in beads</span>
            </label>
            <div className="row">
              <input
                id="width"
                className="input num"
                type="number"
                min={2}
                max={300}
                disabled={imageSettings.sampling === "pixelart" && !!result?.pixelGrid && !result.pixelArtFallback}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
              />
              <div className="segmented">
                {WIDTH_PRESETS.map((n) => (
                  <button key={n} className={width === n ? "on" : ""} onClick={() => setWidth(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            {pattern && (
              <p className="hint">
                {pattern.width} × {pattern.height} beads · {boardsX} × {boardsY} boards of {boardSize} × {boardSize}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="board">
              Pegboard size <span className="muted">pegs per side</span>
            </label>
            <input
              id="board"
              className="input num"
              type="number"
              min={5}
              max={100}
              value={boardInput}
              onChange={(e) => setBoardInput(Number(e.target.value))}
            />
          </div>

          <div className="toggles">
            <div className="toggle-row">
              <Toggle label="Only colours I have" checked={ownedOnly} onChange={setOwnedOnly} />
              <button className="link-btn" onClick={() => setModal({ kind: "owned" })}>
                Choose ({ownedSet.size})
              </button>
            </div>
            {ownedEmpty && <p className="hint warn">Choose the colours you own to use this option.</p>}
          </div>

          <ImageOptions
            settings={imageSettings}
            onChange={setImageSettings}
            result={result}
            outlineColor={outlineColor}
            onChooseOutline={() => setModal({ kind: "outline" })}
            pickingBackground={pickingBg}
            onPickBackground={setPickingBg}
          />
        </aside>

        <section className="preview-col">
          <div className="card preview">
            <div className="card-head">
              <h2>Pattern</h2>
              <div className="actions">
                <DisplayControls display={display} onDisplay={setDisplay} showBoards={showBoards} onShowBoards={setShowBoards} />
                <button className="btn btn-ghost" disabled={!pattern?.total} onClick={enterFullscreen} title="View and edit fullscreen">
                  ⤢ Fullscreen
                </button>
                <button
                  className={`btn ${tool ? "btn-primary" : "btn-ghost"}`}
                  aria-pressed={!!tool}
                  disabled={!pattern}
                  onClick={() => setTool(tool ? null : "paint")}
                >
                  {tool ? "Done editing" : "Edit beads"}
                </button>
                <button className="btn btn-primary" disabled={!pattern?.total} onClick={() => setExportOpen(true)}>
                  Export
                </button>
              </div>
            </div>
            {tool && pattern && !fullscreen && editBar}
            {pattern && pattern.total > 0 ? (
              <PatternView
                pattern={pattern}
                boardSize={boardSize}
                showBoards={showBoards}
                highlightId={highlightId}
                theme={theme}
                shape={display.shape}
                codes={display.codes}
                tool={tool}
                onEdit={onEdit}
                onPickColor={setHighlightId}
              />
            ) : (
              <div className="empty">
                {ownedEmpty
                  ? "No colours selected — pick the beads you own."
                  : pattern
                    ? "Everything was removed. Try lowering the background tolerance or turning off background removal."
                    : "Your pattern appears here."}
              </div>
            )}
            {editsFit && edits.map.size > 0 && (
              <div className="edited">
                <span>
                  {edits.map.size} bead{edits.map.size === 1 ? "" : "s"} edited by hand
                </span>
              </div>
            )}
            {edited && (
              <div className="edited">
                <span>
                  {swaps.size > 0 && `${swaps.size} swapped`}
                  {swaps.size > 0 && excluded.size > 0 && " · "}
                  {excluded.size > 0 && `${excluded.size} removed`}
                </span>
                <button className="link-btn" onClick={resetEdits}>
                  Undo colour edits
                </button>
              </div>
            )}
          </div>

          <BeadList
            pattern={pattern}
            highlightId={highlightId}
            onHighlight={setHighlightId}
            onSwap={(c) => setModal({ kind: "swap", from: c })}
            onRemove={removeColor}
            canRemove={(pattern?.colors.length ?? 0) > 1}
          />
        </section>
      </main>

      <footer className="footer muted small">
        Colours on screen are approximate — check against your actual beads. Colour data from maxcleme/beadcolors (MIT). Images are processed locally and never uploaded.
      </footer>

      {fullscreen && pattern && (
        <div className="fullscreen" role="dialog" aria-modal="true" aria-label="Fullscreen pattern">
          <div className="fs-bar">
            <div className="fs-title">
              <strong>{project?.name ?? "Pattern"}</strong>
              <span className="muted small">
                {pattern.width} × {pattern.height} · {pattern.total.toLocaleString()} beads
              </span>
            </div>
            <div className="actions">
              <DisplayControls display={display} onDisplay={setDisplay} showBoards={showBoards} onShowBoards={setShowBoards} />
              <div className="zoom" role="group" aria-label="Zoom">
                <button className="btn btn-ghost" onClick={() => zoomBy(1 / 1.25)} disabled={zoom <= 1} aria-label="Zoom out">
                  −
                </button>
                <span className="zoom-level" aria-live="polite">
                  {Math.round(zoom * 100)}%
                </span>
                <button className="btn btn-ghost" onClick={() => zoomBy(1.25)} disabled={zoom >= 8} aria-label="Zoom in">
                  +
                </button>
                <button className="btn btn-ghost" onClick={() => setZoom(1)} disabled={zoom === 1}>
                  Fit
                </button>
              </div>
              <button
                className={`btn ${tool ? "btn-primary" : "btn-ghost"}`}
                aria-pressed={!!tool}
                onClick={() => setTool(tool ? null : "paint")}
              >
                {tool ? "Done editing" : "Edit beads"}
              </button>
              <button className="btn btn-primary" onClick={exitFullscreen} aria-label="Exit fullscreen">
                ✕ Exit
              </button>
            </div>
          </div>
          {editBar}
          <PatternView
            pattern={pattern}
            boardSize={boardSize}
            showBoards={showBoards}
            highlightId={highlightId}
            theme={theme}
            shape={display.shape}
            codes={display.codes}
            tool={tool}
            onEdit={onEdit}
            onPickColor={setHighlightId}
            fullscreen
            zoom={zoom}
            onZoom={zoomBy}
          />
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {projectsOpen && (
        <ProjectsDialog
          current={project}
          canSave={!!imageBlob && !!pattern}
          defaultName={fileName}
          onSave={save}
          onOpen={openProject}
          onCurrentChanged={(p) => {
            setProject(p);
            if (!p) setSavedJson(null);
          }}
          onClose={() => setProjectsOpen(false)}
        />
      )}
      {discardPrompt && (
        <div className="modal-backdrop confirm-backdrop" onClick={() => void answerDiscard("cancel")}>
          <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-label="Unsaved changes" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Discard unsaved changes?</h3>
            </div>
            <p className="confirm-text">
              {project
                ? `“${project.name}” has changes that haven't been saved.`
                : "This pattern has edits and hasn't been saved as a project."}
            </p>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => void answerDiscard("cancel")} autoFocus>
                Cancel
              </button>
              <div className="actions">
                <button className="btn btn-danger" onClick={() => void answerDiscard("discard")}>
                  Discard
                </button>
                <button className="btn btn-primary" onClick={() => void answerDiscard("save")}>
                  {project ? "Save first" : "Save as project…"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {exportOpen && pattern && (
        <ExportDialog
          pattern={pattern}
          boardSize={boardSize}
          baseName={`${project?.name ?? fileName}-bead-pattern`}
          settings={exportSettings}
          onChange={setExportSettings}
          onClose={() => setExportOpen(false)}
        />
      )}
      {modal?.kind === "owned" && (
        <ColorPicker
          mode="multi"
          title={`Colours I have · ${brand.name}`}
          colors={brand.colors}
          selected={ownedSet}
          onChange={(s) => {
            const next = { ...owned, [brand.source]: [...s] };
            setOwned(next);
            saveOwned(next);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "outline" && (
        <ColorPicker
          mode="single"
          title="Outline colour"
          colors={brand.colors}
          current={outlineColor.id}
          onPick={(c) => {
            setOutlineId(c.id);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "brush" && (
        <ColorPicker
          mode="single"
          title="Brush colour"
          colors={brand.colors}
          current={brush?.id}
          onPick={(c) => {
            setBrush(c);
            setTool("paint");
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "swap" && (
        <ColorPicker
          mode="single"
          title={`Swap ${colorLabel(modal.from)} for…`}
          colors={brand.colors}
          current={modal.from.id}
          onPick={(to) => swapColor(modal.from, to)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

