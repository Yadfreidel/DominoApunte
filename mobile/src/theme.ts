// Paleta y tipografía. El diseño original es "Competitivo": fondo azul marino con luces de
// estadio, verde lima para el primer lado y morado para el segundo. El administrador puede elegir
// otro tema global (ver domain/appearance.ts); se lee al arrancar (src/bootTheme), antes de crear
// cualquier estilo, así que todas las pantallas lo usan desde el primer cuadro y sin destellos.
import { alpha, deriveTokens, isValidAppearance, ORIGINAL_APPEARANCE, type Appearance } from './domain/appearance.ts';

/** Tema con el que arrancó la app (guardado en el dispositivo). */
export const activeAppearance: Appearance = (() => {
  const stored = (globalThis as { __DOMINO_APPEARANCE__?: unknown }).__DOMINO_APPEARANCE__;
  return isValidAppearance(stored) ? stored : ORIGINAL_APPEARANCE;
})();

export const colors = deriveTokens(activeAppearance);

/** Color de cada lado (jugador o equipo) según su posición. */
export const sideColors = [colors.lime, colors.purple, '#35D6F5', '#FF9F45'].map((main) => ({
  main,
  soft: alpha(main, main === colors.purple ? 0.16 : 0.14),
  track: alpha(main, main === colors.purple ? 0.2 : 0.18),
}));

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
