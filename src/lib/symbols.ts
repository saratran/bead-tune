const SYMBOLS = "ABCDEFGHJKLMNPQRSTUVWXYZabdefghkmnqrtuy23456789@#$%&+=?*<>".split("");

/** Short symbol printed on each bead colour in the pattern key and PDF grid. */
export function symbolFor(i: number): string {
  return i < SYMBOLS.length ? SYMBOLS[i]! : String(i + 1);
}
