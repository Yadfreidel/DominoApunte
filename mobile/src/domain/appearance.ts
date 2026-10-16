// Apariencia (tema global). El administrador elige un tema prediseñado o personaliza seis colores;
// el resto de la paleta (fondos, bordes, textos secundarios, estados) se deriva de ellos.
// Las reglas de contraste son las mismas que valida el servidor (server/src/validation.js).

export type PaletteKey = 'primary' | 'secondary' | 'background' | 'card' | 'text' | 'button';
export type Palette = Record<PaletteKey, string>;

export interface Appearance {
  preset: string;
  colors: Palette;
}

export const PALETTE_FIELDS: { key: PaletteKey; label: string; hint: string }[] = [
  { key: 'primary', label: 'Principal', hint: 'Primer lado, selección y acentos' },
  { key: 'secondary', label: 'Secundario', hint: 'Segundo lado y enlaces' },
  { key: 'background', label: 'Fondo', hint: 'Fondo de todas las pantallas' },
  { key: 'card', label: 'Tarjetas', hint: 'Tarjetas, menús y ventanas' },
  { key: 'text', label: 'Texto', hint: 'Texto principal' },
  { key: 'button', label: 'Botones', hint: 'Botón principal' },
];

export const PRESETS: { id: string; name: string; colors: Palette }[] = [
  {
    id: 'original',
    name: 'Original',
    colors: { primary: '#C6F432', secondary: '#A06BFF', background: '#050A24', card: '#0E1640', text: '#FFFFFF', button: '#C6F432' },
  },
  {
    id: 'verde',
    name: 'Verde dominó',
    colors: { primary: '#3BE38B', secondary: '#F5D547', background: '#04150D', card: '#0B2A1B', text: '#FFFFFF', button: '#3BE38B' },
  },
  {
    id: 'azul',
    name: 'Azul',
    colors: { primary: '#4FC3FF', secondary: '#8FA8FF', background: '#03101F', card: '#0A2140', text: '#FFFFFF', button: '#4FC3FF' },
  },
  {
    id: 'morado',
    name: 'Morado',
    colors: { primary: '#D08CFF', secondary: '#FF8FCB', background: '#12061F', card: '#24103A', text: '#FFFFFF', button: '#D08CFF' },
  },
  {
    id: 'rojo',
    name: 'Rojo',
    colors: { primary: '#FF5A4E', secondary: '#FFC145', background: '#1A0608', card: '#2E0D11', text: '#FFFFFF', button: '#FF5A4E' },
  },
  {
    id: 'oscuro',
    name: 'Oscuro',
    colors: { primary: '#E6E6E6', secondary: '#9AA4B2', background: '#000000', card: '#16181C', text: '#FFFFFF', button: '#E6E6E6' },
  },
];

export const ORIGINAL_APPEARANCE: Appearance = { preset: 'original', colors: PRESETS[0].colors };

const HEX = /^#[0-9A-Fa-f]{6}$/;
export const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** Mezcla `a` con `b` (t = 0 → a, t = 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

export const alpha = (hex: string, a: number) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const DARK_INK = '#0A1030';
/** Color de texto legible (oscuro o blanco) sobre un fondo. */
export const readableOn = (hex: string) => (contrastRatio(hex, DARK_INK) >= contrastRatio(hex, '#FFFFFF') ? DARK_INK : '#FFFFFF');

export interface ContrastCheck {
  label: string;
  ratio: number;
  min: number;
  ok: boolean;
}

/** Comprobaciones de contraste (WCAG): texto 4.5:1; acentos grandes 3:1. */
export function contrastChecks(p: Palette): ContrastCheck[] {
  const check = (a: string, b: string, min: number, label: string) => {
    const ratio = contrastRatio(a, b);
    return { label, ratio, min, ok: ratio >= min };
  };
  return [
    check(p.text, p.background, 4.5, 'Texto sobre el fondo'),
    check(p.text, p.card, 4.5, 'Texto sobre las tarjetas'),
    check(p.primary, p.background, 3, 'Color principal sobre el fondo'),
    check(p.secondary, p.background, 3, 'Color secundario sobre el fondo'),
    check(readableOn(p.button), p.button, 4.5, 'Texto de los botones'),
  ];
}

export function isValidAppearance(value: unknown): value is Appearance {
  const a = value as Appearance;
  return !!a && typeof a.preset === 'string' && !!a.colors && PALETTE_FIELDS.every((f) => isHex(a.colors[f.key]));
}

export const sameAppearance = (a: Appearance, b: Appearance) =>
  a.preset === b.preset && PALETTE_FIELDS.every((f) => a.colors[f.key].toUpperCase() === b.colors[f.key].toUpperCase());

// Valores exactos del diseño original "Competitivo" (se conservan tal cual en el tema original).
const ORIGINAL_TOKENS = {
  bg: '#050A24',
  bgTop: '#0C1A5C',
  bgMid: '#081038',
  surface: 'rgba(16, 24, 66, 0.86)',
  surfaceSolid: '#0E1640',
  surfaceRaised: '#141E52',
  border: '#28346F',
  borderSoft: 'rgba(120, 140, 220, 0.22)',
  borderStrong: '#3A4A9A',
  text: '#FFFFFF',
  title: '#F4F6FF',
  titleGlow: 'rgba(140, 160, 255, 0.85)',
  textMuted: '#AEB6DA',
  textDim: '#7C86B5',
  textFaint: 'rgba(174, 182, 218, 0.45)',
  divider: 'rgba(174, 182, 218, 0.35)',
  line: 'rgba(96, 124, 255, 0.38)',
  lime: '#C6F432',
  limeDeep: '#9BD20F',
  onLime: '#0A1030',
  limeSoft: 'rgba(198, 244, 50, 0.1)',
  limeFaint: 'rgba(198, 244, 50, 0.06)',
  purple: '#A06BFF',
  purpleDeep: '#7B3FF2',
  purpleSoft: 'rgba(160, 107, 255, 0.12)',
  purpleTrack: 'rgba(160, 107, 255, 0.2)',
  button: '#C6F432',
  onButton: '#0A1030',
  field: 'rgba(8, 14, 48, 0.7)',
  fieldStrong: 'rgba(8, 14, 48, 0.9)',
  outlineBg: 'rgba(20, 30, 82, 0.7)',
  keyAlt: 'rgba(20, 30, 82, 0.5)',
  keyPressed: '#22307A',
  sheet: 'rgba(5, 10, 36, 0.9)',
  sheetSoft: 'rgba(5, 10, 36, 0.75)',
  ledger: 'rgba(8, 13, 44, 0.92)',
  scoreCard: 'rgba(10, 16, 52, 0.85)',
  scoreFade: 'rgba(10, 16, 52, 0.2)',
  avatarBase: 'rgba(10, 16, 52, 0.95)',
  pressed: 'rgba(255, 255, 255, 0.06)',
  pressedFaint: 'rgba(255, 255, 255, 0.04)',
  thumbOff: '#C9CEE6',
  glow: 'rgba(120, 150, 255, 0.22)',
  glowClear: 'rgba(120, 150, 255, 0)',
  bgClear: 'rgba(8, 16, 56, 0)',
  danger: '#FF5C7A',
  dangerBg: 'rgba(255, 92, 122, 0.12)',
  success: '#3BE38B',
  warning: '#FFC145',
  warningSoft: 'rgba(255, 193, 69, 0.1)',
  info: '#35D6F5',
  overlay: 'rgba(2, 5, 20, 0.78)',
  light: '#E8F0FF',
  lightGlow: '#BFD3FF',
};

export type ThemeTokens = typeof ORIGINAL_TOKENS;

/** Paleta completa de la app a partir de los seis colores elegidos. */
export function deriveTokens(a: Appearance): ThemeTokens {
  const p = a.colors;
  if (sameAppearance({ preset: 'original', colors: p }, ORIGINAL_APPEARANCE)) return { ...ORIGINAL_TOKENS };
  const bg = p.background;
  const card = p.card;
  const raised = mix(card, p.text, 0.06);
  return {
    ...ORIGINAL_TOKENS,
    bg,
    bgTop: mix(bg, p.primary, 0.16),
    bgMid: mix(bg, p.primary, 0.06),
    surface: alpha(card, 0.88),
    surfaceSolid: card,
    surfaceRaised: raised,
    border: mix(card, p.text, 0.2),
    borderSoft: alpha(mix(card, p.text, 0.5), 0.22),
    borderStrong: mix(card, p.text, 0.32),
    text: p.text,
    title: p.text,
    titleGlow: alpha(mix(p.secondary, p.text, 0.4), 0.7),
    textMuted: mix(p.text, bg, 0.28),
    textDim: mix(p.text, bg, 0.45),
    textFaint: alpha(mix(p.text, bg, 0.3), 0.45),
    divider: alpha(mix(p.text, bg, 0.3), 0.35),
    line: alpha(mix(p.secondary, p.text, 0.2), 0.38),
    lime: p.primary,
    limeDeep: mix(p.primary, bg, 0.25),
    onLime: readableOn(p.primary),
    limeSoft: alpha(p.primary, 0.1),
    limeFaint: alpha(p.primary, 0.06),
    purple: p.secondary,
    purpleDeep: mix(p.secondary, bg, 0.25),
    purpleSoft: alpha(p.secondary, 0.12),
    purpleTrack: alpha(p.secondary, 0.2),
    button: p.button,
    onButton: readableOn(p.button),
    field: alpha(mix(card, bg, 0.5), 0.75),
    fieldStrong: alpha(mix(card, bg, 0.5), 0.92),
    outlineBg: alpha(raised, 0.7),
    keyAlt: alpha(raised, 0.5),
    keyPressed: mix(card, p.text, 0.16),
    sheet: alpha(bg, 0.92),
    sheetSoft: alpha(bg, 0.78),
    ledger: alpha(mix(card, bg, 0.4), 0.94),
    scoreCard: alpha(card, 0.86),
    scoreFade: alpha(card, 0.2),
    avatarBase: alpha(card, 0.95),
    pressed: alpha(p.text, 0.07),
    pressedFaint: alpha(p.text, 0.04),
    thumbOff: mix(p.text, bg, 0.2),
    glow: alpha(mix(p.secondary, p.text, 0.3), 0.2),
    glowClear: alpha(mix(p.secondary, p.text, 0.3), 0),
    bgClear: alpha(bg, 0),
    overlay: alpha(mix(bg, '#000000', 0.5), 0.8),
  };
}
