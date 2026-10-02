import { hexToRgb, rgbToLab, type Lab, type RGB } from "./color";

/**
 * Bead colour charts. Hex values are approximations of each brand's published
 * colours — verify codes against an official chart before buying.
 */

export type BeadKind = "solid" | "clear" | "glitter" | "neon" | "pearl";

export interface BeadColor {
  id: string; // brand-unique, e.g. "perler:P05"
  code: string;
  name: string;
  hex: string;
  kind: BeadKind;
  rgb: RGB;
  lab: Lab;
}

export interface Brand {
  id: string;
  name: string;
  boardSize: number;
  colors: BeadColor[];
}

type Row = [code: string, name: string, hex: string, kind?: BeadKind];

function makeBrand(id: string, name: string, boardSize: number, rows: Row[]): Brand {
  return {
    id,
    name,
    boardSize,
    colors: rows.map(([code, colorName, hex, kind = "solid"]) => {
      const rgb = hexToRgb(hex);
      return { id: `${id}:${code}`, code, name: colorName, hex, kind, rgb, lab: rgbToLab(...rgb) };
    }),
  };
}

const perler: Row[] = [
  ["P01", "White", "#F1F1F1"],
  ["P02", "Cream", "#E3DCB0"],
  ["P03", "Yellow", "#ECD800"],
  ["P04", "Orange", "#ED6120"],
  ["P05", "Red", "#BF2E40"],
  ["P06", "Bubblegum", "#DD6698"],
  ["P07", "Purple", "#604089"],
  ["P08", "Dark Blue", "#2B3F87"],
  ["P09", "Light Blue", "#3370C0"],
  ["P10", "Dark Green", "#1C753E"],
  ["P11", "Light Green", "#56BA9F"],
  ["P12", "Brown", "#513931"],
  ["P17", "Grey", "#8A8D91"],
  ["P18", "Black", "#2E2F32"],
  ["P19", "Clear", "#D8D8D8", "clear"],
  ["P20", "Rust", "#8C372A"],
  ["P21", "Light Brown", "#815D34"],
  ["P33", "Peach", "#EEBAB2"],
  ["P35", "Tan", "#CDA578"],
  ["P38", "Magenta", "#F22B8C"],
  ["P52", "Pastel Blue", "#5A8AE4"],
  ["P53", "Pastel Green", "#75D172"],
  ["P54", "Pastel Lavender", "#8A72C1"],
  ["P56", "Pastel Yellow", "#F8EA80"],
  ["P57", "Cheddar", "#F1AA0C"],
  ["P58", "Toothpaste", "#93C8D4"],
  ["P59", "Hot Coral", "#FF3756"],
  ["P60", "Plum", "#A24B9C"],
  ["P61", "Kiwi Lime", "#6CBE13"],
  ["P62", "Turquoise", "#2B89C6"],
  ["P63", "Blush", "#FF8396"],
  ["P70", "Periwinkle", "#6C88BF"],
  ["P79", "Light Pink", "#F6B3DD"],
  ["P80", "Bright Green", "#4FAD42"],
  ["P83", "Pink", "#E44F9B"],
  ["P88", "Raspberry", "#A5344F"],
  ["P90", "Butterscotch", "#D58D31"],
  ["P91", "Parrot Green", "#00866E"],
  ["P92", "Dark Grey", "#515459"],
  ["P93", "Blueberry Cream", "#8BA5DC"],
  ["P96", "Cranapple", "#7E2A3B"],
  ["P97", "Prickly Pear", "#BDDA5B"],
  ["P98", "Sand", "#E4C69F"],
  ["P101", "Midnight", "#1E2B4F"],
  ["P102", "Sky", "#5DC2E8"],
  ["P103", "Light Grey", "#C1C3C5"],
  ["P104", "Eggplant", "#4A2D52"],
  ["P105", "Spice", "#B5532E"],
  ["P106", "Fern", "#3E8E3A"],
  ["P107", "Evergreen", "#24423A"],
  ["P108", "Fawn", "#B78C68"],
  ["P109", "Gold", "#C99A2C"],
  ["P110", "Pewter", "#9C9A9C"],
  ["P111", "Mint", "#A6E3C6"],
  ["P112", "Salmon", "#F28C78"],
  ["P113", "Cobalt", "#1F57A4"],
  ["P114", "Lilac", "#C2A6DC"],
  ["P115", "Mulberry", "#7F2860"],
  ["P116", "Charcoal", "#3A3A3E"],
  ["P117", "Ivory", "#F4ECD6"],
  ["N01", "Neon Yellow", "#E9F21D", "neon"],
  ["N02", "Neon Orange", "#FF7E2E", "neon"],
  ["N03", "Neon Pink", "#FF4FB2", "neon"],
  ["N04", "Neon Green", "#3FEA4F", "neon"],
  ["N05", "Neon Blue", "#2C8CFF", "neon"],
  ["G01", "Glitter Silver", "#B9BCC2", "glitter"],
  ["G02", "Glitter Gold", "#D2B04C", "glitter"],
  ["C01", "Clear Blue", "#7FA8D8", "clear"],
  ["C02", "Clear Red", "#D8667A", "clear"],
];

const hama: Row[] = [
  ["H01", "White", "#ECEDED"],
  ["H02", "Cream", "#F0E8B9"],
  ["H03", "Yellow", "#F0B901"],
  ["H04", "Orange", "#E64F27"],
  ["H05", "Red", "#B63136"],
  ["H06", "Pink", "#E1889F"],
  ["H07", "Purple", "#694A82"],
  ["H08", "Blue", "#2C4690"],
  ["H09", "Light Blue", "#305CB0"],
  ["H10", "Green", "#256847"],
  ["H11", "Light Green", "#49AE89"],
  ["H12", "Brown", "#534137"],
  ["H17", "Grey", "#83888A"],
  ["H18", "Black", "#2E2F31"],
  ["H19", "Clear", "#D9D9D9", "clear"],
  ["H20", "Reddish Brown", "#7F332A"],
  ["H21", "Light Brown", "#A5693F"],
  ["H22", "Dark Red", "#A52D36"],
  ["H26", "Flesh", "#DE9B90"],
  ["H27", "Beige", "#DEB48B"],
  ["H28", "Dark Green", "#363F38"],
  ["H29", "Claret", "#B9395E"],
  ["H30", "Burgundy", "#682E3B"],
  ["H31", "Turquoise", "#6797AE"],
  ["H32", "Neon Fuchsia", "#FF3D9A", "neon"],
  ["H33", "Cerise", "#D23362"],
  ["H34", "Neon Yellow", "#E8F030", "neon"],
  ["H35", "Neon Red", "#FF4545", "neon"],
  ["H36", "Neon Blue", "#3A8DFF", "neon"],
  ["H37", "Neon Green", "#3EE05A", "neon"],
  ["H38", "Neon Orange", "#FF8A2A", "neon"],
  ["H43", "Pastel Yellow", "#F3EA6B"],
  ["H44", "Pastel Red", "#F2836D"],
  ["H45", "Pastel Purple", "#9E89C7"],
  ["H46", "Pastel Blue", "#6FB4DF"],
  ["H47", "Pastel Green", "#7DD088"],
  ["H48", "Pastel Pink", "#DA87C1"],
  ["H49", "Azure", "#34A9CF"],
  ["H60", "Teddy Bear", "#B58E3A"],
  ["H61", "Gold Glitter", "#C9A646", "glitter"],
  ["H62", "Silver Glitter", "#B3B7BC", "glitter"],
  ["H70", "Light Grey", "#BABEC1"],
  ["H71", "Dark Grey", "#4A4F52"],
  ["H75", "Tan", "#886E5D"],
  ["H76", "Nougat", "#A9785D"],
  ["H77", "Pearl White", "#F1EFE6", "pearl"],
  ["H78", "Light Peach", "#F5C8A8"],
  ["H79", "Apricot", "#EFA37C"],
  ["H82", "Plum", "#96335F"],
  ["H83", "Petrol", "#23899E"],
  ["H84", "Olive", "#6C8A4F"],
  ["H95", "Pastel Rose", "#F2B6C2"],
  ["H96", "Pastel Lilac", "#C6B4E2"],
  ["H97", "Pastel Ice Blue", "#B8DCEB"],
  ["H98", "Pastel Mint", "#B6E5C8"],
  ["H101", "Clear Red", "#D6687A", "clear"],
  ["H102", "Clear Blue", "#7AA4D6", "clear"],
];

export const BRANDS: Brand[] = [
  makeBrand("perler", "Perler Midi 5mm", 29, perler),
  makeBrand("hama", "Hama Midi 5mm", 29, hama),
];

export function getBrand(id: string): Brand {
  return BRANDS.find((b) => b.id === id) ?? BRANDS[0]!;
}

export function isSpecial(c: BeadColor): boolean {
  return c.kind !== "solid";
}
