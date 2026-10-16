// Validaciones de imágenes (logo, fotos de jugadores) y de la apariencia (colores del tema).

export class ValidationError extends Error {}

const IMAGE_TYPES = {
  'image/png': (b) => b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a,
  'image/jpeg': (b) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

/** Ancho y alto leídos de la cabecera del archivo (PNG, JPEG o WebP). */
export function imageSize(type, b) {
  if (type === 'image/png') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (type === 'image/webp') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    return null;
  }
  // JPEG: recorrer los segmentos hasta el marcador SOF.
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * Valida una imagen enviada como data URI. Comprueba el tipo declarado contra el contenido real,
 * el tamaño en bytes y las dimensiones. Devuelve { dataUri, type, bytes, width, height }.
 */
export function validateImage(value, { maxBytes, minSide = 16, maxSide = 2048, label = 'La imagen' }) {
  if (typeof value !== 'string') throw new ValidationError(`${label} no es válida.`);
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!m) throw new ValidationError(`${label} debe ser PNG, JPEG o WebP.`);
  const type = m[1];
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > maxBytes) {
    throw new ValidationError(`${label} pesa ${Math.ceil(bytes.length / 1024)} KB; el máximo es ${Math.floor(maxBytes / 1024)} KB.`);
  }
  if (!IMAGE_TYPES[type](bytes)) throw new ValidationError(`${label} no es un archivo ${type.split('/')[1].toUpperCase()} válido.`);
  const size = imageSize(type, bytes);
  if (!size || !size.width || !size.height) throw new ValidationError(`${label} no se pudo leer.`);
  if (size.width < minSide || size.height < minSide) throw new ValidationError(`${label} es demasiado pequeña (mínimo ${minSide} px).`);
  if (size.width > maxSide || size.height > maxSide) throw new ValidationError(`${label} es demasiado grande (máximo ${maxSide} px por lado).`);
  return { dataUri: value, type, bytes: bytes.length, ...size };
}

/** Resumen de una imagen para la auditoría (nunca se guarda la imagen completa en el registro). */
export const describeImage = (img) => (img ? `${img.type ?? 'imagen'} · ${Math.ceil((img.bytes ?? 0) / 1024)} KB` : null);

// ---------------------------------------------------------------- Apariencia

export const PALETTE_KEYS = ['primary', 'secondary', 'background', 'card', 'text', 'button'];
const HEX = /^#[0-9A-Fa-f]{6}$/;

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Color de texto legible sobre un fondo (el mismo criterio que en la app). */
export const readableOn = (hex) => (contrastRatio(hex, '#0A1030') >= contrastRatio(hex, '#FFFFFF') ? '#0A1030' : '#FFFFFF');

/** Problemas de contraste de una paleta; lista vacía si es legible. Ver mobile/src/domain/appearance.ts. */
export function contrastProblems(p) {
  const out = [];
  const check = (a, b, min, label) => {
    const ratio = contrastRatio(a, b);
    if (ratio < min) out.push(`${label}: contraste ${ratio.toFixed(1)}:1 (mínimo ${min}:1).`);
  };
  check(p.text, p.background, 4.5, 'Texto sobre el fondo');
  check(p.text, p.card, 4.5, 'Texto sobre las tarjetas');
  check(p.primary, p.background, 3, 'Color principal sobre el fondo');
  check(p.secondary, p.background, 3, 'Color secundario sobre el fondo');
  check(readableOn(p.button), p.button, 4.5, 'Texto de los botones');
  return out;
}

export function validateAppearance(body) {
  const preset = typeof body?.preset === 'string' && /^[a-z0-9-]{1,30}$/.test(body.preset) ? body.preset : 'personalizado';
  const colors = {};
  for (const key of PALETTE_KEYS) {
    const v = body?.colors?.[key];
    if (typeof v !== 'string' || !HEX.test(v)) throw new ValidationError(`El color "${key}" debe tener el formato #RRGGBB.`);
    colors[key] = v.toUpperCase();
  }
  const problems = contrastProblems(colors);
  if (problems.length) throw new ValidationError(`Los colores no son legibles. ${problems.join(' ')}`);
  return { preset, colors };
}

// ---------------------------------------------------------------- CSV

/** Celda CSV segura: escapa comillas y evita que una hoja de cálculo la interprete como fórmula. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, rows) {
  // BOM para que Excel reconozca los acentos.
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
