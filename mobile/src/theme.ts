// Paleta y tipografía tomadas del diseño de referencia "Competitivo":
// fondo azul marino con luces de estadio, verde lima para el primer lado y morado para el segundo.

export const colors = {
  bg: '#050A24',
  bgTop: '#0C1A5C',
  bgMid: '#081038',
  surface: 'rgba(16, 24, 66, 0.86)',
  surfaceSolid: '#0E1640',
  surfaceRaised: '#141E52',
  border: '#28346F',
  borderSoft: 'rgba(120, 140, 220, 0.22)',
  text: '#FFFFFF',
  textMuted: '#AEB6DA',
  textDim: '#7C86B5',
  lime: '#C6F432',
  limeDeep: '#9BD20F',
  onLime: '#0A1030',
  purple: '#A06BFF',
  purpleDeep: '#7B3FF2',
  danger: '#FF5C7A',
  dangerBg: 'rgba(255, 92, 122, 0.12)',
  success: '#3BE38B',
  warning: '#FFC145',
  overlay: 'rgba(2, 5, 20, 0.78)',
};

/** Color de cada lado (jugador o equipo) según su posición. */
export const sideColors = [
  { main: colors.lime, soft: 'rgba(198, 244, 50, 0.14)', track: 'rgba(198, 244, 50, 0.18)' },
  { main: colors.purple, soft: 'rgba(160, 107, 255, 0.16)', track: 'rgba(160, 107, 255, 0.2)' },
  { main: '#35D6F5', soft: 'rgba(53, 214, 245, 0.14)', track: 'rgba(53, 214, 245, 0.18)' },
  { main: '#FF9F45', soft: 'rgba(255, 159, 69, 0.14)', track: 'rgba(255, 159, 69, 0.18)' },
];

export const sideColor = (index: number) => sideColors[index % sideColors.length];

export const fonts = {
  display: 'BarlowCondensed_800ExtraBold',
  black: 'BarlowCondensed_900Black',
  heading: 'BarlowCondensed_700Bold',
  semibold: 'BarlowCondensed_600SemiBold',
};

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

/** Ancho máximo del contenido en pantallas grandes (tabletas / escritorio). */
export const CONTENT_MAX_WIDTH = 560;
