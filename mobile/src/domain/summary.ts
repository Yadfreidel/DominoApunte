// Imagen de resumen de una partida (para compartir por WhatsApp). Se genera como SVG con los
// colores de la app; la conversión a PNG se hace en services/shareSummary.ts.
import type { Game } from './game.ts';
import { formatDuration, gameDurationMs, sideLabel, totals } from './game.ts';
import { colors, sideColor } from '../theme.ts';

export const APP_NAME = 'Dominó';

export interface SummaryOptions {
  /** Texto adicional bajo el título, p. ej. "Torneo Verano · Semifinal". */
  context?: string;
  /** Nombre de la app (identidad visual definida por el administrador). */
  appName?: string;
  /** Fecha/hora en que se genera (para el pie). */
  generatedAt?: string;
  locale?: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const FONT = "'Arial Black', 'Helvetica Neue', Arial, sans-serif";
const FONT_TEXT = "'Helvetica Neue', Arial, sans-serif";

function formatDate(iso: string, locale: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Recorta textos largos para que no se salgan de su columna. */
const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function buildSummarySvg(game: Game, options: SummaryOptions = {}): { svg: string; width: number; height: number } {
  const locale = options.locale ?? 'es';
  const appName = options.appName?.trim() || APP_NAME;
  const W = 1080;
  const pad = 64;
  const t = totals(game);
  const winner = game.sides.find((s) => s.id === game.winnerSideId);
  const duration = gameDurationMs(game);
  const n = game.sides.length;
  const colW = (W - pad * 2) / n;

  const parts: string[] = [];
  let y = 0;

  // Encabezado
  y += 110;
  parts.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="84" fill="${colors.title}" letter-spacing="6">${esc(appName.toUpperCase())}</text>`);
  y += 52;
  const subtitle = options.context ? `Resumen de partida · ${options.context}` : 'Resumen de partida';
  parts.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${FONT_TEXT}" font-size="30" fill="${colors.textMuted}">${esc(fit(subtitle, 60))}</text>`);
  y += 40;
  const when = formatDate(game.finishedAt ?? game.createdAt, locale);
  if (when) parts.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${FONT_TEXT}" font-size="26" fill="${colors.textDim}">${esc(when)}</text>`);

  // Ganador
  y += 50;
  if (winner) {
    const c = sideColor(game.sides.indexOf(winner)).main;
    parts.push(`<rect x="${pad}" y="${y}" width="${W - pad * 2}" height="120" rx="28" fill="${c}" fill-opacity="0.14" stroke="${c}" stroke-width="4"/>`);
    parts.push(`<text x="${W / 2}" y="${y + 48}" text-anchor="middle" font-family="${FONT_TEXT}" font-size="26" font-weight="700" fill="${c}" letter-spacing="4">GANADOR</text>`);
    parts.push(`<text x="${W / 2}" y="${y + 96}" text-anchor="middle" font-family="${FONT}" font-size="44" fill="${colors.text}">${esc(fit(winner.name, 34))}</text>`);
  } else {
    const label = game.status === 'cancelada' ? 'Partida cancelada' : 'Partida sin terminar';
    parts.push(`<rect x="${pad}" y="${y}" width="${W - pad * 2}" height="120" rx="28" fill="${colors.text}" fill-opacity="0.05" stroke="${colors.border}" stroke-width="3"/>`);
    parts.push(`<text x="${W / 2}" y="${y + 74}" text-anchor="middle" font-family="${FONT}" font-size="40" fill="${colors.textMuted}">${label}</text>`);
  }
  y += 120;

  // Marcador final
  y += 40;
  const cardH = game.mode === 'parejas' ? 270 : 240;
  game.sides.forEach((side, i) => {
    const c = sideColor(i).main;
    const x = pad + colW * i + 8;
    const w = colW - 16;
    const isWinner = side.id === game.winnerSideId;
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${cardH}" rx="26" fill="${colors.surfaceSolid}" stroke="${c}" stroke-opacity="${isWinner ? 1 : 0.45}" stroke-width="${isWinner ? 5 : 3}"/>`);
    const cx = x + w / 2;
    const nameSize = n > 2 ? 28 : 36;
    parts.push(`<text x="${cx}" y="${y + 58}" text-anchor="middle" font-family="${FONT_TEXT}" font-size="${nameSize}" font-weight="700" fill="${colors.text}">${esc(fit(side.name, n > 2 ? 14 : 22))}</text>`);
    let scoreY = y + 180;
    if (game.mode === 'parejas' && sideLabel(game, side) !== side.name) {
      parts.push(`<text x="${cx}" y="${y + 96}" text-anchor="middle" font-family="${FONT_TEXT}" font-size="24" fill="${colors.textMuted}">${esc(fit(sideLabel(game, side), 30))}</text>`);
      scoreY = y + 205;
    }
    parts.push(`<text x="${cx}" y="${scoreY}" text-anchor="middle" font-family="${FONT}" font-size="${n > 2 ? 84 : 110}" fill="${c}">${t[side.id] ?? 0}</text>`);
  });
  y += cardH;

  // Datos de la partida
  y += 60;
  const facts = [`Meta: ${game.target} puntos`, `${game.hands.length} ${game.hands.length === 1 ? 'mano' : 'manos'}`];
  if (duration != null) facts.push(`Duración: ${formatDuration(duration)}`);
  facts.push(game.mode === 'parejas' ? 'Por parejas' : 'Individual');
  parts.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${FONT_TEXT}" font-size="28" fill="${colors.textMuted}">${esc(facts.join('  ·  '))}</text>`);

  // Desglose por mano
  y += 60;
  const rowH = 46;
  const numW = 120;
  const handColW = (W - pad * 2 - numW) / n;
  parts.push(`<text x="${pad}" y="${y}" font-family="${FONT_TEXT}" font-size="30" font-weight="700" fill="${colors.text}">Puntos por mano</text>`);
  y += 26;
  parts.push(`<rect x="${pad}" y="${y}" width="${W - pad * 2}" height="${rowH}" rx="12" fill="${colors.text}" fill-opacity="0.05"/>`);
  parts.push(`<text x="${pad + 24}" y="${y + 31}" font-family="${FONT_TEXT}" font-size="22" font-weight="700" fill="${colors.textDim}">MANO</text>`);
  game.sides.forEach((side, i) => {
    parts.push(`<text x="${pad + numW + handColW * i + handColW / 2}" y="${y + 31}" text-anchor="middle" font-family="${FONT_TEXT}" font-size="22" font-weight="700" fill="${sideColor(i).main}">${esc(fit(side.name.toUpperCase(), n > 2 ? 10 : 18))}</text>`);
  });
  y += rowH;
  if (game.hands.length === 0) {
    y += rowH;
    parts.push(`<text x="${W / 2}" y="${y - 14}" text-anchor="middle" font-family="${FONT_TEXT}" font-size="24" fill="${colors.textDim}">Sin manos registradas</text>`);
  }
  game.hands.forEach((h, idx) => {
    const top = y;
    y += rowH;
    parts.push(`<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="${colors.purple}" stroke-opacity="0.35" stroke-width="2"/>`);
    parts.push(`<text x="${pad + 24}" y="${top + 32}" font-family="${FONT_TEXT}" font-size="24" fill="${colors.textDim}">${idx + 1}</text>`);
    game.sides.forEach((side, i) => {
      const scored = h.sideId === side.id;
      parts.push(`<text x="${pad + numW + handColW * i + handColW / 2}" y="${top + 33}" text-anchor="middle" font-family="${FONT}" font-size="28" fill="${scored ? sideColor(i).main : colors.textDim}" fill-opacity="${scored ? 1 : 0.5}">${scored ? h.points : 0}</text>`);
    });
  });
  // Totales
  y += 12;
  parts.push(`<rect x="${pad}" y="${y}" width="${W - pad * 2}" height="${rowH + 6}" rx="12" fill="${colors.text}" fill-opacity="0.07"/>`);
  parts.push(`<text x="${pad + 24}" y="${y + 35}" font-family="${FONT_TEXT}" font-size="22" font-weight="700" fill="${colors.textMuted}">TOTAL</text>`);
  game.sides.forEach((side, i) => {
    parts.push(`<text x="${pad + numW + handColW * i + handColW / 2}" y="${y + 37}" text-anchor="middle" font-family="${FONT}" font-size="32" fill="${sideColor(i).main}">${t[side.id] ?? 0}</text>`);
  });
  y += rowH + 6;

  // Pie
  y += 70;
  parts.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${FONT_TEXT}" font-size="24" fill="${colors.textDim}">Anotado con ${esc(appName)}</text>`);
  y += 50;
  const H = Math.ceil(y);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colors.bgTop}"/><stop offset="0.35" stop-color="${colors.bgMid}"/><stop offset="1" stop-color="${colors.bg}"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
${parts.join('\n')}
</svg>`;
  return { svg, width: W, height: H };
}
