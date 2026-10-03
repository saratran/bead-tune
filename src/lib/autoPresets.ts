/** Auto mode presets: built-in starting points plus the user's own, saved in this browser. */
import { DEFAULT_SEARCH_SPACE, SEARCH_OPTIONS, type RefineMethod, type SearchSpace, type Tone } from "./auto";

export interface RefineConfig {
  enabled: boolean;
  method: RefineMethod;
  /** Extra candidates to try per suggestion. */
  budget: number;
}

export const DEFAULT_REFINE: RefineConfig = { enabled: true, method: "pattern", budget: 40 };

export interface AutoConfig {
  space: SearchSpace;
  /** How many suggestions to show. */
  count: number;
  /** Most combinations to try; above this an evenly spread subset is used. */
  limit: number;
  /** Fine-tuning of each suggestion after the grid search. */
  refine: RefineConfig;
  /** Colour tones to find suggestions for. */
  tones: Tone[];
}

export interface AutoPreset extends AutoConfig {
  id: string;
  name: string;
  builtIn?: boolean;
}

const none = { mode: "none" as const, strength: 0 };

const BUILT_INS: (Omit<AutoPreset, "tones"> & { tones?: Tone[] })[] = [
  {
    // All three tones; no dithering or clean-up (both erase faint details); gentle
    // brightness/contrast/saturation either way; 12 suggestions.
    id: "builtin:balanced",
    name: "Balanced (default)",
    builtIn: true,
    space: {
      ...DEFAULT_SEARCH_SPACE,
      maxColors: [24, 40, 64],
      dither: [none],
      cleanup: [0],
      brightness: [-10, 0, 10],
      contrast: [-10, 0, 15],
      saturation: [-20, 0, 20],
    },
    count: 12,
    limit: 300,
    refine: DEFAULT_REFINE,
    tones: ["natural", "vivid", "muted"],
  },
  {
    id: "builtin:quick",
    name: "Quick",
    builtIn: true,
    space: { ...DEFAULT_SEARCH_SPACE, sampling: ["smooth"], maxColors: [12, 24, 40], dither: [none], cleanup: [0, 1], contrast: [0], saturation: [0] },
    count: 4,
    limit: 100,
    refine: { ...DEFAULT_REFINE, budget: 20 },
  },
  {
    id: "builtin:photo",
    name: "Photo",
    builtIn: true,
    space: {
      ...DEFAULT_SEARCH_SPACE,
      sampling: ["smooth"],
      denoise: [false, true],
      maxColors: [24, 40, 64, 100],
      dither: [none, { mode: "diffusion", strength: 40 }, { mode: "diffusion", strength: 60 }],
      cleanup: [0, 1],
      contrast: [0, 15],
      saturation: [0, 20],
    },
    count: 6,
    limit: 400,
    refine: DEFAULT_REFINE,
  },
  {
    id: "builtin:drawing",
    name: "Drawing / logo",
    builtIn: true,
    space: {
      ...DEFAULT_SEARCH_SPACE,
      sampling: ["sharp", "smooth"],
      maxColors: [6, 8, 12, 16, 24],
      dither: [none],
      cleanup: [0, 1, 2],
      minBeads: [0, 3],
      contrast: [0, 15],
      saturation: [0, 20],
    },
    count: 6,
    limit: 300,
    refine: DEFAULT_REFINE,
  },
  {
    id: "builtin:thorough",
    name: "Thorough (slow)",
    builtIn: true,
    space: {
      ...DEFAULT_SEARCH_SPACE,
      denoise: [false, true],
      maxColors: [12, 24, 40, 64, 100],
      dither: SEARCH_OPTIONS.dither,
      cleanup: [0, 1, 2],
      metric: ["standard", "accurate"],
      brightness: [-10, 0, 10],
      contrast: [0, 15, 30],
      saturation: [0, 20, 40],
    },
    count: 8,
    limit: 1000,
    refine: { ...DEFAULT_REFINE, budget: 80 },
  },
];

export const BUILT_IN_PRESETS: AutoPreset[] = BUILT_INS.map((p) => ({ ...p, tones: p.tones ?? ["natural"] }));

const PRESETS_KEY = "bead-pattern:auto-presets";
const CONFIG_KEY = "bead-pattern:auto-config";
const PRESET_ID_KEY = "bead-pattern:auto-preset";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** Fills in settings added after a preset was saved. */
function normalise(config: Partial<AutoConfig>): AutoConfig {
  return {
    count: config.count ?? 6,
    limit: config.limit ?? 300,
    space: { ...DEFAULT_SEARCH_SPACE, ...config.space },
    refine: { ...DEFAULT_REFINE, ...config.refine },
    tones: config.tones?.length ? config.tones : ["natural"],
  };
}

export function userPresets(): AutoPreset[] {
  return read<AutoPreset[]>(PRESETS_KEY, []).map((p) => ({ ...p, ...normalise(p), builtIn: false }));
}

export function allPresets(): AutoPreset[] {
  return [...BUILT_IN_PRESETS, ...userPresets()];
}

/** `name`, or "name (2)", "name (3)"… if another preset already uses it. */
function uniqueName(name: string, exceptId?: string): string {
  const clean = name.trim() || "My preset";
  const taken = new Set(allPresets().filter((p) => p.id !== exceptId).map((p) => p.name));
  if (!taken.has(clean)) return clean;
  let n = 2;
  while (taken.has(`${clean} (${n})`)) n++;
  return `${clean} (${n})`;
}

const newId = () => `user:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Create: saves the config as a new preset (the name is made unique). */
export function createPreset(name: string, config: AutoConfig): AutoPreset {
  const preset: AutoPreset = { id: newId(), name: uniqueName(name), ...normalise(config) };
  write(PRESETS_KEY, [...userPresets(), preset]);
  return preset;
}

/** @deprecated kept for older callers: same as createPreset. */
export const savePreset = createPreset;

function changeUserPreset(id: string, change: (p: AutoPreset) => AutoPreset): AutoPreset {
  const list = userPresets();
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) throw new Error(id.startsWith("builtin:") ? "Built-in presets can't be changed — duplicate it first." : "That preset no longer exists.");
  list[i] = change(list[i]!);
  write(PRESETS_KEY, list);
  return list[i]!;
}

/** Update: replaces a user preset's settings, keeping its name. */
export function updatePreset(id: string, config: AutoConfig): AutoPreset {
  return changeUserPreset(id, (p) => ({ ...p, ...normalise(config) }));
}

/** Update: renames a user preset (the name is made unique). */
export function renamePreset(id: string, name: string): AutoPreset {
  return changeUserPreset(id, (p) => ({ ...p, name: uniqueName(name, id) }));
}

/** Create from existing: an editable copy of any preset, built-in or not. */
export function duplicatePreset(id: string): AutoPreset {
  const source = allPresets().find((p) => p.id === id);
  if (!source) throw new Error("That preset no longer exists.");
  return createPreset(`${source.name.replace(/ \(default\)$/, "")} copy`, source);
}

export function deletePreset(id: string): void {
  write(
    PRESETS_KEY,
    userPresets().filter((p) => p.id !== id),
  );
}

/** Whether `config` matches the preset's settings. */
export function sameConfig(a: AutoConfig, b: AutoConfig): boolean {
  const pick = (c: AutoConfig) => JSON.stringify({ space: c.space, count: c.count, limit: c.limit, refine: c.refine, tones: [...c.tones].sort() });
  return pick(normalise(a)) === pick(normalise(b));
}

/** The configuration used last time (or the default preset). */
export function loadLastConfig(): AutoConfig {
  return normalise(read<Partial<AutoConfig>>(CONFIG_KEY, BUILT_IN_PRESETS[0]!));
}

export function saveLastConfig(config: AutoConfig): void {
  write(CONFIG_KEY, config);
}

/** The preset selected last time ("" for none). */
export function loadLastPresetId(): string {
  return read<string>(PRESET_ID_KEY, "builtin:balanced");
}

export function saveLastPresetId(id: string): void {
  write(PRESET_ID_KEY, id);
}
