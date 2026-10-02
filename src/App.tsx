import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BeadList } from "./components/BeadList";
import { ColorPicker } from "./components/ColorPicker";
import { Dropzone } from "./components/Dropzone";
import { DEFAULT_IMAGE_SETTINGS, ImageOptions, type ImageSettings } from "./components/ImageOptions";
import { PatternView, type EditTool } from "./components/PatternView";
import { ProjectsDialog, type OpenProject } from "./components/ProjectsDialog";
import { CropDialog } from "./components/CropDialog";
import { AutoDialog, type AutoTab } from "./components/AutoDialog";
import { effortCost, featureCost, likenessCost, makeEvaluator, type Candidate, type RefinedSuggestion } from "./lib/auto";
import { imageFingerprint, loadBookmarks, mergeBookmarks, sameCandidate, saveBookmarks, type Bookmark } from "./lib/bookmarks";
import { OriginalView } from "./components/OriginalView";
import { cropPixels, isFullCrop } from "./lib/crop";
import { applyEdits, outlineRing, padPattern, shiftEdits, type Edits } from "./lib/cleanup";
import { BRANDS, colorLabel, DEFAULT_BRAND_ID, getBrand, type BeadColor } from "./lib/palettes";
import { applySwaps, type Pattern } from "./lib/pattern";
import { buildPattern, type PipelineSettings } from "./lib/pipeline";
import { requestPersistentStorage, type ProjectLocation, type ProjectMeta, type ProjectState } from "./lib/projects";
import { storeFor } from "./lib/projectStores";
import { canvasSource, FULL_CROP, type Crop } from "./lib/sampling";
import { ExportDialog } from "./components/ExportDialog";
import { DisplayControls, EditBar, type DisplaySettings } from "./components/PatternControls";
import { Toggle } from "./components/Toggle";
import { DEFAULT_EXPORT, type ExportSettings } from "./lib/export";
import { patternThumbnail } from "./lib/render";
import { makeSampleImage } from "./lib/sample";

const WIDTH_PRESETS = [52, 78, 104];
const OWNED_KEY = "bead-pattern:owned";
const THEME_KEY = "bead-pattern:theme";
const DISPLAY_KEY = "bead-pattern:display";
const EXPORT_KEY = "bead-pattern:export";

const DEFAULT_DISPLAY: DisplaySettings = { shape: "square", codes: false, original: false };

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

type Modal = { kind: "owned" } | { kind: "swap"; from: BeadColor } | { kind: "outline" } | { kind: "brush" } | { kind: "crop" } | { kind: "auto"; tab?: AutoTab } | null;

const MAX_UNDO = 50;

// Stable ids for decoded images, so cached results can tell images apart.
const imageIds = new WeakMap<HTMLImageElement, number>();
let nextImageId = 1;
function imageId(img: HTMLImageElement): number {
  let id = imageIds.get(img);
  if (!id) imageIds.set(img, (id = nextImageId++));
  return id;
}

/** Re-encodes an image as PNG (for images that don't come from a file, like the sample). */
function imageToBlob(img: HTMLImageElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't save the image."))), "image/png"));
}



/** Darkest colour in a palette — the natural default for outlines. */
function darkest(colors: BeadColor[]): BeadColor {
  return colors.reduce((a, b) => (b.lab[0] < a.lab[0] ? b : a));
}

export function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState("pattern");
  const [project, setProject] = useState<OpenProject | null>(null);
  const [savedJson, setSavedJson] = useState<string | null>(null);
  // "save" for the normal dialog, "saveAs" to start with a new version name; false when closed.
  const [projectsOpen, setProjectsOpenState] = useState<false | "save" | "saveAs">(false);
  const setProjectsOpen = (open: boolean) => setProjectsOpenState(open ? "save" : false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
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
  const [crop, setCrop] = useState<Crop>(FULL_CROP);
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

  // Hand edits (including added outlines), keyed by cell index for a pattern of size `w` × `h`.
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
    setEditsAck(false);
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
      setCrop(FULL_CROP);
      resetEdits();
      clearHandEdits();
    },
    [resetEdits, clearHandEdits],
  );

  const onFile = async (file: File) => {
    if (!(await confirmDiscard())) return;
    try {
      setError(null);
      // Copy the bytes now: on Android, a picked photo can become unreadable later
      // (e.g. Google Photos revokes access), which would make saving fail.
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || "image/png" });
      startImage(await loadImage(blob), blob, file.name.replace(/\.[^.]+$/, "") || "pattern");
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

  const pipelineSettings = useCallback(
    (settings: ImageSettings, w: number): PipelineSettings => {
      const { sampling, denoise, trim, cleanup, edgeMargin: _margin, ...options } = settings;
      return {
        width: Math.max(2, Math.min(300, w || 1)),
        crop,
        sampling,
        denoise,
        trim,
        cleanup,
        // Outlines are added by hand (Edit → Add outline); the edge margin is added after swaps.
        outline: null,
        options: { ...options, palette },
      };
    },
    [crop, palette],
  );

  const result = useMemo(
    () => (source ? buildPattern(source, pipelineSettings(dSettings, dWidth)) : null),
    [source, dSettings, dWidth, pipelineSettings],
  );

  // Auto suggestions belong to the settings Auto doesn't change; reopening shows them until those change.
  const [autoResults, setAutoResults] = useState<{ key: string; list: RefinedSuggestion[] } | null>(null);

  // Bookmarked suggestions belong to the image (by fingerprint), across scans and reloads.
  const fingerprint = useMemo(() => (source ? imageFingerprint(source) : null), [source]);
  const [bookmarks, setBookmarksState] = useState<Bookmark[]>([]);
  // Bookmarks from a project being opened, merged in once its image is ready.
  const pendingBookmarks = useRef<Bookmark[] | null>(null);
  useEffect(() => {
    if (!fingerprint) return setBookmarksState([]);
    let list = loadBookmarks(fingerprint);
    if (pendingBookmarks.current) {
      list = mergeBookmarks(list, pendingBookmarks.current);
      pendingBookmarks.current = null;
      saveBookmarks(fingerprint, list);
    }
    setBookmarksState(list);
  }, [fingerprint]);
  const setBookmarks = (list: Bookmark[]) => {
    setBookmarksState(list);
    if (fingerprint) saveBookmarks(fingerprint, list);
  };
  const autoKey = useMemo(() => {
    const { sampling, denoise, cleanup, maxColors, minBeads, metric, dither, ditherStrength, adjustments, ...fixed } = imageSettings;
    return JSON.stringify({ image: image ? imageId(image) : 0, brandId, width, crop, ownedOnly, excluded: [...excluded], fixed });
  }, [image, brandId, width, crop, ownedOnly, excluded, imageSettings]);

  const applySuggestion = (sg: { label: string; candidate: Candidate }) => {
    const c = sg.candidate;
    setImageSettings({
      ...imageSettings,
      sampling: c.sampling,
      denoise: c.denoise,
      maxColors: c.maxColors,
      minBeads: c.minBeads,
      metric: c.metric,
      dither: c.dither.mode,
      ditherStrength: c.dither.strength || imageSettings.ditherStrength,
      cleanup: c.cleanup,
      adjustments: { brightness: c.brightness, contrast: c.contrast, saturation: c.saturation },
    });
    setModal(null);
    setNotice({ text: `Applied “${sg.label}”` });
  };

  // The edge margin pads the finished pattern, so turning it on or off keeps hand edits (shifted by one).
  const edgeMargin = imageSettings.edgeMargin;
  const swapped = useMemo(() => {
    if (!result) return null;
    const p = applySwaps(result.pattern, swaps);
    return edgeMargin ? padPattern(p, 1) : p;
  }, [result, swaps, edgeMargin]);

  // Hand edits only apply to a grid of the size they were made on; they're set
  // aside (not lost) while the size differs, and replaced by the next stroke.
  const editsFit = swapped && edits.w === swapped.width && edits.h === swapped.height;

  const pattern = useMemo(() => (swapped && editsFit ? applyEdits(swapped, edits.map) : swapped), [swapped, editsFit, edits]);
  const handEditCount = editsFit ? edits.map.size : 0;

  // An older project with a live outline: once its pattern is rebuilt, draw the
  // outline in as hand edits, then reapply the edits it had on outline beads.
  const pendingOutline = useRef<{ w: number; h: number; over: Edits } | null>(null);
  useEffect(() => {
    const p = pendingOutline.current;
    if (!p || !pattern || dSettings !== imageSettings || dWidth !== width) return;
    // Edits saved for another size were set aside anyway.
    const fits = pattern.width === p.w && pattern.height === p.h;
    pendingOutline.current = null;
    const ring = outlineRing(pattern).cells;
    setEdits((prev) => {
      const map = new Map(fits ? prev.map : undefined);
      for (const i of ring) map.set(i, outlineColor);
      if (fits) for (const [i, c] of p.over) map.set(i, c);
      return { w: pattern.width, h: pattern.height, map };
    });
  }, [pattern, dSettings, imageSettings, dWidth, width, outlineColor]);

  // Settings that rebuild the pattern can leave hand edits misaligned or set aside:
  // ask first. "Change anyway" isn't asked again until the next brush stroke.
  const [editsAck, setEditsAck] = useState(false);
  const [editsPrompt, setEditsPrompt] = useState<(() => void) | null>(null);
  const guardEdits = (apply: () => void) => {
    if (handEditCount === 0 || editsAck) apply();
    else setEditsPrompt(() => apply);
  };
  const changeImageSettings = (next: ImageSettings) => guardEdits(() => setImageSettings(next));

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
      setEditsAck(false);
      // One undo step per stroke.
      pushUndo();
    }
    setEdits((prev) => {
      const fits = prev.w === pattern.width && prev.h === pattern.height;
      const map = new Map(fits ? prev.map : undefined);
      map.set(index, value);
      return { w: pattern.width, h: pattern.height, map };
    });
  };

  /** Adds or removes the empty ring round the pattern, moving hand edits (and undo steps) with it. */
  const setEdgeMargin = (on: boolean) => {
    if (on === edgeMargin) return;
    const d = on ? 1 : -1;
    if (edits.w > 0) {
      const shift = (m: Edits) => shiftEdits(m, edits.w, d, d, edits.w + 2 * d, edits.h + 2 * d);
      setEdits({ w: edits.w + 2 * d, h: edits.h + 2 * d, map: shift(edits.map) });
      setUndoStack((u) => u.map(shift));
    }
    setImageSettings({ ...imageSettings, edgeMargin: on });
  };

  const pushUndo = () => setUndoStack((u) => [...u.slice(-MAX_UNDO + 1), editsFit ? edits.map : new Map()]);

  /** Adds a one-bead outline round the shape as it is now, as hand edits (one undo step). */
  const addOutlineNow = () => {
    if (!pattern) return;
    const ring = outlineRing(pattern);
    if (!ring.cells.length) {
      setNotice({ text: "Nothing to outline: there's no empty space round the shape. Turn on Edge margin or Remove background.", error: true });
      return;
    }
    setEditsAck(false);
    pushUndo();
    setEdits((prev) => {
      const fits = prev.w === pattern.width && prev.h === pattern.height;
      const map = new Map(fits ? prev.map : undefined);
      for (const i of ring.cells) map.set(i, outlineColor);
      return { w: pattern.width, h: pattern.height, map };
    });
    setNotice({ text: ring.clipped && !edgeMargin ? "Outline added. It's cut off where the shape touches the edge: turn on Edge margin to leave room." : "Outline added" });
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
    const bgColor: [number, number, number] = [native.data[i]!, native.data[i + 1]!, native.data[i + 2]!];
    guardEdits(() => setImageSettings({ ...imageSettings, bgColor }));
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
      crop,
      outlineId,
      ownedOnly,
      excluded: [...excluded],
      swaps: [...swaps].map(([from, to]) => [from, to.id]),
      edits: {
        w: edits.w,
        h: edits.h,
        cells: [...edits.map].map(([i, c]) => [i, c?.id ?? null]),
      },
      bookmarks,
    }),
    [brandId, width, boardSize, imageSettings, crop, outlineId, ownedOnly, excluded, swaps, edits, bookmarks],
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
        setNotice({ text: `Couldn't save: ${(e as Error).message}`, error: true });
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
    const t = setTimeout(() => setNotice(null), notice.error ? 8000 : 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const save = async (name: string, asNew = false, location: ProjectLocation = project?.location ?? "local") => {
    if (!imageBlob || !pattern) throw new Error("Add an image first.");
    // Only overwrite the open project when saving back to where it came from.
    const overwrite = !asNew && project?.location === location;
    const saved = await storeFor(location).save({
      id: overwrite ? project.id : undefined,
      name,
      image: imageBlob,
      imageName: fileName,
      thumbnail: patternThumbnail(pattern),
      state: projectState,
    });
    if (location === "local") requestPersistentStorage();
    setProject({ id: saved.id, name: saved.name, location });
    setSavedJson(projectJson);
    setNotice({ text: `Saved “${saved.name}”${location === "server" ? " to the server" : ""}` });
  };

  const quickSave = () => {
    if (project) save(project.name).catch((e) => setNotice({ text: `Couldn't save: ${(e as Error).message}`, error: true }));
    else setProjectsOpen(true);
  };

  /** Returns false if the user chose to keep their unsaved work instead. */
  const openProject = async (meta: ProjectMeta): Promise<boolean> => {
    if (!(await confirmDiscard())) return false;
    const location = meta.location ?? "local";
    const blob = await storeFor(location).loadImage(meta.id);
    if (!blob) throw new Error("This project's image is missing.");
    const img = await loadImage(blob);
    const st = meta.state;
    const b = getBrand(st.brandId);
    const byId = new Map(b.colors.map((c) => [c.id, c]));
    setImage(img);
    setImageBlob(blob);
    setFileName(meta.imageName || meta.name);
    setBrandId(b.id);
    // Older projects kept the outline's margin inside the width (a live "outline" setting, then
    // "outlineMargin"): the same grid is now width − 2 plus the edge margin. A live outline is redrawn once.
    const { outline: liveOutline, outlineMargin: oldMargin, ...savedImage } = st.image as ImageSettings & { outline?: boolean; outlineMargin?: boolean };
    const insideMargin = !!(liveOutline || oldMargin);
    setWidth(insideMargin ? Math.max(2, st.width - 2) : st.width);
    setBoardInput(st.boardSize);
    setImageSettings({ ...DEFAULT_IMAGE_SETTINGS, ...savedImage, ...(insideMargin ? { edgeMargin: true } : {}) });
    setCrop(st.crop ?? FULL_CROP);
    pendingBookmarks.current = st.bookmarks ?? null;
    setOutlineId(st.outlineId);
    setOwnedOnly(st.ownedOnly);
    setExcluded(new Set(st.excluded));
    setSwaps(new Map(st.swaps.flatMap(([from, to]) => (byId.has(to) ? [[from, byId.get(to)!] as const] : []))));
    const restore = (cells: [number, string | null][] = []) =>
      new Map(cells.flatMap(([i, id]): [number, BeadColor | null][] => (id === null ? [[i, null]] : byId.has(id) ? [[i, byId.get(id)!]] : [])));
    setEdits({ w: st.edits.w, h: st.edits.h, map: restore(st.edits.cells) });
    pendingOutline.current = liveOutline ? { w: st.edits.w, h: st.edits.h, over: restore(st.edits.outlineCells) } : null;
    setUndoStack([]);
    setHighlightId(null);
    setTool(null);
    setPickingBg(false);
    setError(null);
    setProject({ id: meta.id, name: meta.name, location });
    markSaved.current = true;
    setNotice({ text: `Opened “${meta.name}”` });
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
  const showOriginal = display.original && !!image;
  const cropPx = image && !isFullCrop(crop) ? cropPixels(crop, image.naturalWidth || image.width, image.naturalHeight || image.height) : null;
  const brushOrDefault = brush ?? pattern?.colors[0] ?? null;
  const editBar = tool && (
    <EditBar
      tool={tool}
      onTool={setTool}
      brush={brushOrDefault}
      onChooseBrush={() => setModal({ kind: "brush" })}
      canUndo={undoStack.length > 0}
      onUndo={undo}
      canClear={handEditCount > 0}
      outline={{
        color: outlineColor,
        onAdd: addOutlineNow,
        onChooseColor: () => setModal({ kind: "outline" }),
        margin: edgeMargin,
        onMargin: setEdgeMargin,
      }}
      onClear={clearHandEdits}
    />
  );

  /** The current image settings as an Auto candidate (null in pixel art mode). */
  const currentCandidate = (): Candidate | null => {
    const s = imageSettings;
    if (s.sampling === "pixelart") return null;
    return {
      sampling: s.sampling,
      denoise: s.denoise,
      maxColors: s.maxColors,
      dither: { mode: s.dither, strength: s.dither === "none" ? 0 : s.ditherStrength },
      cleanup: s.cleanup,
      metric: s.metric,
      minBeads: s.minBeads,
      brightness: s.adjustments.brightness,
      contrast: s.adjustments.contrast,
      saturation: s.adjustments.saturation,
    };
  };

  /** Saves the current settings as a bookmark (scored on a fixed scale). Returns an error, or null. */
  const bookmarkCurrent = (): string | null => {
    if (!source || !fingerprint) return "Add an image first.";
    const c = currentCandidate();
    if (!c) return "Pixel art settings can't be bookmarked — Auto doesn't search pixel art.";
    if (bookmarks.some((b) => sameCandidate(b.candidate, c))) return "These settings are already bookmarked.";
    const r = makeEvaluator(source, pipelineSettings(imageSettings, width))(c);
    if (!r) return "Nothing to bookmark: the pattern is empty.";
    const pct = (cost: number) => Math.round(100 * Math.min(1, Math.max(0, 1 - cost)));
    const n = bookmarks.filter((b) => /^My settings \d+$/.test(b.label)).length + 1;
    const label = `My settings ${n}`;
    setBookmarks([
      ...bookmarks,
      {
        id: `bm-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        label,
        candidate: c,
        thumbnail: patternThumbnail(r.pattern),
        features: pct(featureCost(r.metrics)),
        likeness: pct(likenessCost(r.metrics)),
        ease: pct(effortCost(r.metrics)),
        colors: r.metrics.colors,
        beads: r.metrics.beads,
        strays: r.metrics.strays,
        createdAt: Date.now(),
        tone: "natural",
        fixedScale: true,
        context: { width, brandId },
      },
    ]);
    setNotice({ text: `Bookmarked “${label}”` });
    return null;
  };

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
              {project.location === "server" && (
                <span className="location-badge" title="Saved on the server" aria-label="Stored on the server">
                  ⛁
                </span>
              )}
              {project.name}
              {dirty && <span className="unsaved-dot" aria-label="Unsaved changes" />}
            </span>
          )}
          <button className="theme-btn" disabled={!image} onClick={quickSave}>
            Save
          </button>
          <button className="theme-btn" disabled={!image || !project} onClick={() => setProjectsOpenState("saveAs")} title="Save as a new version with a different name">
            Save as…
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
            <>
            <div className="source">
              <img
                src={image.src}
                alt="Source"
                className={pickingBg ? "picking" : ""}
                title={pickingBg ? "Click the background colour" : undefined}
                onClick={pickBackground}
              />
              <div className="source-actions">
                <Dropzone onFile={onFile} compact />
                <button className="btn btn-ghost" onClick={() => setModal({ kind: "crop" })}>
                  ✂ Crop
                </button>
              </div>
            </div>
            {cropPx && (
              <p className="hint crop-status">
                Cropped to {cropPx.w} × {cropPx.h} px ·{" "}
                <button className="link-btn" onClick={() => guardEdits(() => setCrop(FULL_CROP))}>
                  Remove crop
                </button>
              </p>
            )}
            </>
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
            <select id="brand" className="input" value={brandId} onChange={(e) => {
                const id = e.target.value;
                guardEdits(() => changeBrand(id));
              }}>
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
                onChange={(e) => {
                  const v = Number(e.target.value);
                  guardEdits(() => setWidth(v));
                }}
              />
              <div className="segmented">
                {WIDTH_PRESETS.map((n) => (
                  <button key={n} className={width === n ? "on" : ""} onClick={() => guardEdits(() => setWidth(n))}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            {pattern && (
              <p className="hint">
                {pattern.width} × {pattern.height} beads{edgeMargin ? " (with edge margin)" : ""} · {boardsX} × {boardsY} boards of {boardSize} × {boardSize}
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
              <Toggle label="Only colours I have" checked={ownedOnly} onChange={(v) => guardEdits(() => setOwnedOnly(v))} />
              <button className="link-btn" onClick={() => setModal({ kind: "owned" })}>
                Choose ({ownedSet.size})
              </button>
            </div>
            {ownedEmpty && <p className="hint warn">Choose the colours you own to use this option.</p>}
          </div>

          <button className="btn btn-auto full" disabled={!pattern} onClick={() => setModal({ kind: "auto", tab: "search" })}>
            ✨ Auto suggestions
          </button>
          <div className="row results-row">
            <button className="btn btn-ghost" disabled={!pattern} onClick={() => setModal({ kind: "auto", tab: "results" })}>
              ★ Results{(autoResults?.key === autoKey ? autoResults.list.length : 0) + bookmarks.length > 0 ? ` (${(autoResults?.key === autoKey ? autoResults.list.length : 0) + bookmarks.length})` : ""}
            </button>
            <button
              className="btn btn-ghost"
              disabled={!pattern}
              title="Save your current image settings as a bookmark, to compare or fine-tune later"
              onClick={() => {
                const err = bookmarkCurrent();
                if (err) setNotice({ text: err, error: true });
              }}
            >
              ★ Bookmark current settings
            </button>
          </div>

          <ImageOptions
            settings={imageSettings}
            onChange={changeImageSettings}
            result={result}
            pickingBackground={pickingBg}
            onPickBackground={setPickingBg}
          />
        </aside>

        <section className="preview-col">
          <div className="card preview">
            <div className="card-head">
              <h2>
                Pattern
                {pattern && pattern.total > 0 && (
                  <span className="pattern-size" title="Width × height in beads">
                    {pattern.width} × {pattern.height} beads
                  </span>
                )}
              </h2>
              <div className="actions">
                <DisplayControls display={display} onDisplay={setDisplay} showBoards={showBoards} onShowBoards={setShowBoards} canShowOriginal={!!image} />
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
              <div className={`compare ${showOriginal ? "with-original" : ""}`}>
                {showOriginal && !fullscreen && image && (
                  <OriginalView image={image} crop={crop} onHide={() => setDisplay({ ...display, original: false })} />
                )}
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
              </div>
            ) : (
              <div className="empty">
                {ownedEmpty
                  ? "No colours selected — pick the beads you own."
                  : pattern
                    ? "Everything was removed. Try lowering the background tolerance or turning off background removal."
                    : "Your pattern appears here."}
              </div>
            )}
            {handEditCount > 0 && (
              <div className="edited">
                <span>
                  {handEditCount} bead{handEditCount === 1 ? "" : "s"} edited by hand
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
            onRemove={(c) => guardEdits(() => removeColor(c))}
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
              <DisplayControls display={display} onDisplay={setDisplay} showBoards={showBoards} onShowBoards={setShowBoards} canShowOriginal={!!image} />
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
          <div className={`fs-body ${showOriginal ? "with-original" : ""}`}>
            {showOriginal && image && <OriginalView image={image} crop={crop} onHide={() => setDisplay({ ...display, original: false })} />}
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
        </div>
      )}
      {notice && (
        <div className={`toast ${notice.error ? "toast-error" : ""}`} role={notice.error ? "alert" : "status"}>
          {notice.text}
        </div>
      )}
      {projectsOpen && (
        <ProjectsDialog
          current={project}
          canSave={!!imageBlob && !!pattern}
          defaultName={fileName}
          mode={projectsOpen}
          onSave={save}
          onOpen={openProject}
          onCurrentChanged={(p) => {
            setProject(p);
            if (!p) setSavedJson(null);
          }}
          onClose={() => setProjectsOpen(false)}
        />
      )}
      {editsPrompt && (
        <div className="modal-backdrop confirm-backdrop" onClick={() => setEditsPrompt(null)}>
          <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-label="Hand edits may be lost" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Change settings with hand edits?</h3>
            </div>
            <p className="confirm-text">
              You've edited {handEditCount} bead{handEditCount === 1 ? "" : "s"} by hand. This change rebuilds the pattern underneath: your edits stay at the same bead positions, so they may
              no longer line up — and if the pattern's size changes they're set aside, and lost once you edit again.
            </p>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setEditsPrompt(null)} autoFocus>
                Cancel
              </button>
              <div className="actions">
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    const apply = editsPrompt;
                    setEditsPrompt(null);
                    clearHandEdits();
                    apply();
                  }}
                >
                  Clear edits and change
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const apply = editsPrompt;
                    setEditsPrompt(null);
                    setEditsAck(true);
                    apply();
                  }}
                >
                  Change anyway
                </button>
              </div>
            </div>
          </div>
        </div>
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
      {modal?.kind === "auto" && source && (
        <AutoDialog
          source={source}
          base={pipelineSettings(imageSettings, width)}
          results={autoResults?.key === autoKey ? autoResults.list : null}
          onResults={(list) => setAutoResults({ key: autoKey, list })}
          onApply={(sg) => guardEdits(() => applySuggestion(sg))}
          bookmarks={bookmarks}
          onBookmarksChange={setBookmarks}
          onClose={() => setModal(null)}
          image={image}
          crop={crop}
          boardSize={boardSize}
          theme={theme}
          initialTab={modal.tab}
          onBookmarkCurrent={bookmarkCurrent}
        />
      )}
      {modal?.kind === "crop" && image && (
        <CropDialog
          image={image}
          crop={crop}
          onApply={(c) => {
            guardEdits(() => setCrop(c));
            setModal(null);
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

