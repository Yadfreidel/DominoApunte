// Tarjeta del ganador para compartir (imagen vertical 1080×1350). Se genera desde la partida
// terminada y guardada, así que sirve aunque el marcador ya se haya reiniciado para la siguiente.
// No incluye enlaces, códigos de invitación ni datos de cuentas.
import type { Game } from './game.ts';
import { formatDuration, gameDurationMs, victorySummary } from './game.ts';
import { colors, sideColor } from '../theme.ts';

export interface WinnerCardOptions {
  appName: string;
  /** Logo de la app (data URI) si el administrador definió uno. */
  logo?: string | null;
  /** Fotos de los jugadores (data URI) por nombre; los que no tienen foto muestran sus iniciales. */
  photoOf?: (name: string) => string | undefined;
  /** Racha de victorias seguidas del ganador, solo si está calculada (≥ 2 para mostrarse). */
  streak?: number;
  locale?: string;
}

const PHRASES = [
  '¡Partida de campeones!',
  '¡Imparable en la mesa!',
  '¡Victoria merecida!',
  '¡Qué manera de cerrar!',
  '¡Dominio total de la mesa!',
  '¡A celebrar!',
];

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';
const isPhoto = (uri: string | undefined): uri is string => !!uri && /^data:image\/(png|jpeg|webp);base64,/.test(uri);

/** Frase fija por partida (la misma tarjeta siempre muestra la misma frase). */
export function celebrationPhrase(gameId: string): string {
  let h = 0;
  for (const ch of gameId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PHRASES[h % PHRASES.length];
}

const FONT = "'Arial Black', 'Helvetica Neue', Arial, sans-serif";
const FONT_TEXT = "'Helvetica Neue', Arial, sans-serif";

export function buildWinnerCardSvg(game: Game, options: WinnerCardOptions): { svg: string; width: number; height: number } | null {
  const v = victorySummary(game);
  if (!v) return null;
  const W = 1080;
  const H = 1350;
  const pad = 70;
  const accent = sideColor(v.winnerIndex).main;
  const winner = game.sides[v.winnerIndex];
  const members = winner.participantIds.map((id) => game.participants.find((p) => p.id === id)?.name ?? '').filter(Boolean);
  const appName = options.appName.trim() || 'Dominó';
  const parts: string[] = [];

  // Encabezado: logo (si hay) y nombre de la app.
  const logo = isPhoto(options.logo ?? undefined) ? options.logo! : null;
  if (logo) {
    parts.push(`<image href="${logo}" x="${W / 2 - 160}" y="62" width="64" height="64" preserveAspectRatio="xMidYMid meet"/>`);
  }
  parts.push(
    `<text x="${logo ? W / 2 + 20 : W / 2}" y="112" text-anchor="middle" font-family="${FONT}" font-size="46" fill="${colors.title}" letter-spacing="5">${esc(fit(appName.toUpperCase(), 18))}</text>`,
  );

  // Trofeo.
  const tx = W / 2;
  const ty = 190;
  parts.push(`<g transform="translate(${tx - 90} ${ty})" fill="${colors.warning}">
    <path d="M30 0 h120 v40 a60 60 0 0 1 -120 0 z"/>
    <path d="M30 12 h-24 a24 24 0 0 0 24 44 z M150 12 h24 a24 24 0 0 1 -24 44 z" fill="none" stroke="${colors.warning}" stroke-width="10"/>
    <rect x="80" y="98" width="20" height="34"/>
    <rect x="50" y="132" width="80" height="16" rx="6"/>
  </g>`);

  // Ganador.
  const plural = members.length > 1;
  parts.push(
    `<text x="${W / 2}" y="420" text-anchor="middle" font-family="${FONT_TEXT}" font-size="34" font-weight="700" fill="${accent}" letter-spacing="8">${plural ? 'GANADORES' : 'GANADOR'}</text>`,
  );
  const name = winner.name;
  const nameSize = name.length > 22 ? 52 : name.length > 14 ? 66 : 84;
  parts.push(
    `<text x="${W / 2}" y="510" text-anchor="middle" font-family="${FONT}" font-size="${nameSize}" fill="${colors.text}">${esc(fit(name, 30))}</text>`,
  );
  if (v.members) {
    parts.push(`<text x="${W / 2}" y="560" text-anchor="middle" font-family="${FONT_TEXT}" font-size="32" fill="${colors.textMuted}">${esc(fit(v.members, 40))}</text>`);
  }

  // Fotos o iniciales de los ganadores.
  const r = 70;
  const gap = 40;
  const startX = W / 2 - ((members.length - 1) * (2 * r + gap)) / 2;
  members.forEach((m, i) => {
    const cx = startX + i * (2 * r + gap);
    const cy = 690;
    const photo = options.photoOf?.(m);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="${accent}" stroke-width="6"/>`);
    if (isPhoto(photo)) {
      parts.push(`<clipPath id="p${i}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`);
      parts.push(`<image href="${photo}" x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" clip-path="url(#p${i})" preserveAspectRatio="xMidYMid slice"/>`);
    } else {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colors.surfaceSolid}"/>`);
      parts.push(`<text x="${cx}" y="${cy + 22}" text-anchor="middle" font-family="${FONT}" font-size="58" fill="${accent}">${esc(initials(m))}</text>`);
    }
  });

  // Resultado y meta.
  parts.push(`<text x="${W / 2}" y="880" text-anchor="middle" font-family="${FONT}" font-size="120" fill="${accent}">${v.points}</text>`);
  parts.push(`<text x="${W / 2}" y="940" text-anchor="middle" font-family="${FONT_TEXT}" font-size="34" font-weight="700" fill="${colors.text}">${esc(v.exact ? `¡Meta exacta: ${v.target} puntos!` : `Meta ${v.target} · ${v.detail.split(' · ')[1] ?? ''}`)}</text>`);

  // Marcador final de todos los lados.
  let y = 1000;
  const rowH = 58;
  v.scores.forEach((sc, i) => {
    const c = sideColor(i).main;
    parts.push(`<rect x="${pad + 80}" y="${y}" width="${W - 2 * pad - 160}" height="${rowH - 10}" rx="16" fill="${c}" fill-opacity="${sc.winner ? 0.18 : 0.07}" stroke="${c}" stroke-opacity="${sc.winner ? 1 : 0.35}" stroke-width="2"/>`);
    parts.push(`<text x="${pad + 110}" y="${y + 33}" font-family="${FONT_TEXT}" font-size="28" font-weight="700" fill="${c}">${esc(fit(sc.name, 26))}</text>`);
    parts.push(`<text x="${W - pad - 110}" y="${y + 35}" text-anchor="end" font-family="${FONT}" font-size="32" fill="${colors.text}">${sc.points}</text>`);
    y += rowH;
  });

  // Racha (solo si está calculada), frase, fecha y duración real.
  y += 30;
  if (options.streak && options.streak >= 2) {
    parts.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${FONT_TEXT}" font-size="32" font-weight="700" fill="${colors.warning}">Racha: ${options.streak} victorias seguidas</text>`);
    y += 46;
  }
  parts.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="38" fill="${colors.text}">${esc(celebrationPhrase(game.id))}</text>`);
  const height = Math.max(H, y + 110);
  const facts: string[] = [];
  const when = new Date(game.finishedAt ?? game.createdAt);
  if (!Number.isNaN(when.getTime())) facts.push(when.toLocaleDateString(options.locale ?? 'es', { day: '2-digit', month: 'long', year: 'numeric' }));
  const duration = gameDurationMs(game);
  if (duration != null) facts.push(`Duración: ${formatDuration(duration)}`);
  if (facts.length) {
    parts.push(`<text x="${W / 2}" y="${height - 50}" text-anchor="middle" font-family="${FONT_TEXT}" font-size="26" fill="${colors.textDim}">${esc(facts.join('  ·  '))}</text>`);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colors.bgTop}"/><stop offset="0.4" stop-color="${colors.bgMid}"/><stop offset="1" stop-color="${colors.bg}"/></linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.22" r="0.5"><stop offset="0" stop-color="${accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${height}" fill="url(#bg)"/>
<rect width="${W}" height="${height}" fill="url(#glow)"/>
<rect x="24" y="24" width="${W - 48}" height="${height - 48}" rx="40" fill="none" stroke="${accent}" stroke-opacity="0.6" stroke-width="4"/>
${parts.join('\n')}
</svg>`;
  return { svg, width: W, height };
}
