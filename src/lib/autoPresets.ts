/** Auto mode presets: built-in starting points plus the user's own, saved in this browser. */
import { DEFAULT_SEARCH_SPACE, SEARCH_OPTIONS, type SearchSpace } from "./auto";

export interface AutoConfig {
  space: SearchSpace;
  /** How many suggestions to show. */
  count: number;
  /** Most combinations to try; above this an evenly spread subset is used. */
  limit: number;
}

export interface AutoPreset extends AutoConfig {
  id: string;
  name: string;
  builtIn?: boolean;
}

const none = { mode: "none" as const, strength: 0 };

export const BUILT_IN_PRESETS: AutoPreset[] = [
  {
    id: "builtin:balanced",
    name: "Balanced (default)",
    builtIn: true,
    space: DEFAULT_SEARCH_SPACE,
    count: 6,
    limit: 300,
  },
  {
    id: "builtin:quick",
    name: "Quick",
    builtIn: true,
    space: { ...DEFAULT_SEARCH_SPACE, sampling: ["smooth"], maxColors: [12, 24, 40], dither: [none], cleanup: [0, 1], contrast: [0], saturation: [0] },
    count: 4,
    limit: 100,
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
  },
];

const PRESETS_KEY = "bead-pattern:auto-presets";
const CONFIG_KEY = "bead-pattern:auto-config";

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
function normalise(config: AutoConfig): AutoConfig {
  return { count: config.count ?? 6, limit: config.limit ?? 300, space: { ...DEFAULT_SEARCH_SPACE, ...config.space } };
}

export function userPresets(): AutoPreset[] {
  return read<AutoPreset[]>(PRESETS_KEY, []).map((p) => ({ ...p, ...normalise(p), builtIn: false }));
}

export function allPresets(): AutoPreset[] {
  return [...BUILT_IN_PRESETS, ...userPresets()];
}

/** Saves the config under `name`, replacing a user preset with the same name. */
export function savePreset(name: string, config: AutoConfig): AutoPreset {
  const clean = name.trim() || "My preset";
  const others = userPresets().filter((p) => p.name !== clean);
  const preset: AutoPreset = { id: `user:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: clean, ...normalise(config) };
  write(PRESETS_KEY, [...others, preset]);
  return preset;
}

export function deletePreset(id: string): void {
  write(
    PRESETS_KEY,
    userPresets().filter((p) => p.id !== id),
  );
}

/** The configuration used last time (or the default preset). */
export function loadLastConfig(): AutoConfig {
  return normalise(read<AutoConfig>(CONFIG_KEY, BUILT_IN_PRESETS[0]!));
}

export function saveLastConfig(config: AutoConfig): void {
  write(CONFIG_KEY, config);
}
