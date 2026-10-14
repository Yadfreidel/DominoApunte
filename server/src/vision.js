// Conteo de fichas de dominó a partir de una foto, usando la visión de Claude.
// La imagen se procesa en memoria y no se guarda ni se registra en ningún log.
import Anthropic from '@anthropic-ai/sdk';

export const VISION_MODEL = 'claude-opus-5-5';

/** Conjuntos de dominó admitidos y su valor máximo por mitad. */
export const TILE_SETS = { doble6: 6, doble9: 9, doble12: 12 };

// Límites de imagen del nivel de alta resolución (modelos Claude 4.7 y posteriores).
// La app redimensiona la foto a un tamaño dentro de estos límites para que las coordenadas
// que devuelve el modelo coincidan píxel a píxel con la imagen enviada.
const MAX_EDGE = 2576;
const MAX_VISUAL_TOKENS = 4784;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class VisionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function fitsVisionLimits(width, height) {
  return (
    Math.ceil(width / 28) * 28 <= MAX_EDGE &&
    Math.ceil(height / 28) * 28 <= MAX_EDGE &&
    Math.ceil(width / 28) * Math.ceil(height / 28) <= MAX_VISUAL_TOKENS
  );
}

/** Lee ancho y alto reales de un JPEG (marcadores SOF), sin dependencias. */
export function jpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

const ISSUES = [
  'sin_fichas',
  'borrosa',
  'reflejos',
  'poca_luz',
  'fichas_tapadas',
  'fichas_superpuestas',
  'fichas_cortadas',
  'fichas_boca_abajo',
];

/** Esquema de salida estructurada: una entrada por ficha física detectada. */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    image_usable: {
      type: 'boolean',
      description: 'false si en la imagen no hay fichas de dominó o no se puede analizar.',
    },
    image_issues: { type: 'array', items: { type: 'string', enum: ISSUES } },
    tiles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          box: {
            type: 'object',
            description: 'Rectángulo de la ficha en píxeles de la imagen recibida: esquina superior izquierda (x1, y1) e inferior derecha (x2, y2).',
            properties: {
              x1: { type: 'integer' },
              y1: { type: 'integer' },
              x2: { type: 'integer' },
              y2: { type: 'integer' },
            },
            required: ['x1', 'y1', 'x2', 'y2'],
            additionalProperties: false,
          },
          first_half: {
            type: ['integer', 'null'],
            description: 'Puntos de la mitad izquierda (o superior si la ficha está vertical). 0 si la mitad está en blanco. null si no se puede leer con seguridad.',
          },
          second_half: {
            type: ['integer', 'null'],
            description: 'Puntos de la mitad derecha (o inferior). 0 si está en blanco. null si no se puede leer con seguridad.',
          },
          needs_review: { type: 'boolean' },
          review_reason: {
            type: 'string',
            description: 'Motivo breve en español si needs_review es true (p. ej. "mitad derecha tapada", "reflejo sobre los puntos"); cadena vacía si no.',
          },
        },
        required: ['box', 'first_half', 'second_half', 'needs_review', 'review_reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['image_usable', 'image_issues', 'tiles'],
  additionalProperties: false,
};

function buildPrompt(maxPips, width, height) {
  return `You are counting domino pips to score a game. The image is ${width}x${height} pixels.
The set in use is double-${maxPips}: each half of a tile shows between 0 and ${maxPips} pips.

For every physical domino tile that is face up in the image, return one entry in "tiles":
- "box": the tile's bounding box as absolute pixel coordinates in this image, [x1, y1] top-left and [x2, y2] bottom-right.
- "first_half" / "second_half": the number of pips on each half (left then right; top then bottom if the tile is vertical). A blank half counts as 0. Count the pips carefully one by one; do not infer values from patterns you expect.
- If a half is covered, cut off by the image edge, blurred, hidden by glare or otherwise not countable with confidence, set that half to null, set "needs_review" to true and explain briefly in Spanish in "review_reason". Never guess a value.
- Two physical tiles with the same values are two separate entries. Report each tile exactly once.
- Ignore tiles that are face down (report "fichas_boca_abajo" in image_issues if there are any).
Order the tiles left to right, top to bottom.

Set "image_usable" to false and return an empty "tiles" list if the image contains no domino tiles. Use "image_issues" for problems that affect the whole photo.`;
}

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Valida y normaliza la respuesta del modelo. Nunca inventa valores: lo que no es un entero
 * válido para el conjunto queda en null y la ficha pasa a revisión. El total se calcula aquí,
 * sumando mitades, y no se toma de ningún total del modelo.
 */
export function normalizeDetection(raw, { width, height, maxPips }) {
  const tiles = [];
  const rawTiles = Array.isArray(raw?.tiles) ? raw.tiles.slice(0, 60) : [];
  for (const t of rawTiles) {
    const reasons = [];
    const half = (v, label) => {
      if (v === null || v === undefined) return null;
      if (!Number.isInteger(v) || v < 0 || v > maxPips) {
        reasons.push(`${label}: ${v} no es válido en doble ${maxPips}`);
        return null;
      }
      return v;
    };
    const first = half(t?.first_half, 'mitad 1');
    const second = half(t?.second_half, 'mitad 2');
    let box = null;
    const b = t?.box;
    if (b && [b.x1, b.y1, b.x2, b.y2].every(Number.isFinite)) {
      const x1 = Math.max(0, Math.min(width, b.x1));
      const x2 = Math.max(0, Math.min(width, b.x2));
      const y1 = Math.max(0, Math.min(height, b.y1));
      const y2 = Math.max(0, Math.min(height, b.y2));
      if (x2 - x1 >= 2 && y2 - y1 >= 2) box = { x1, y1, x2, y2 };
    }
    if (!box) reasons.push('ubicación no válida');
    if ((first === null || second === null) && reasons.length === 0 && !t?.review_reason) {
      reasons.push('valor ilegible');
    }
    const modelReason = typeof t?.review_reason === 'string' ? t.review_reason.trim().slice(0, 140) : '';
    const needsReview = Boolean(t?.needs_review) || first === null || second === null || reasons.length > 0;
    tiles.push({
      first,
      second,
      box,
      needsReview,
      reviewReason: needsReview ? [modelReason, ...reasons].filter(Boolean).join('; ') : '',
    });
  }

  // Posibles detecciones duplicadas: rectángulos casi iguales. Dos fichas físicas con los mismos
  // valores en lugares distintos NO se marcan; solo se marca cuando se solapan casi por completo.
  for (let i = 0; i < tiles.length; i++) {
    for (let j = 0; j < i; j++) {
      if (tiles[i].box && tiles[j].box && iou(tiles[i].box, tiles[j].box) > 0.6) {
        tiles[i].needsReview = true;
        tiles[i].reviewReason = [tiles[i].reviewReason, `posible duplicado de la ficha ${j + 1}`].filter(Boolean).join('; ');
      }
    }
  }

  const result = tiles.map((t, i) => ({
    id: `f${i + 1}`,
    left: t.first,
    right: t.second,
    // Ubicación normalizada 0–1 respecto a la imagen enviada, para dibujarla sobre la foto.
    box: t.box
      ? { x: t.box.x1 / width, y: t.box.y1 / height, w: (t.box.x2 - t.box.x1) / width, h: (t.box.y2 - t.box.y1) / height }
      : null,
    status: t.needsReview ? 'revisar' : 'ok',
    reviewReason: t.reviewReason,
  }));
  const issues = Array.isArray(raw?.image_issues) ? raw.image_issues.filter((x) => ISSUES.includes(x)) : [];
  const usable = raw?.image_usable !== false && result.length > 0;
  if (!usable && !issues.includes('sin_fichas') && result.length === 0) issues.push('sin_fichas');
  return {
    imageUsable: usable,
    imageIssues: [...new Set(issues)],
    tiles: result,
    // Suma de mitades legibles; las fichas en revisión se resuelven en la app antes de confirmar.
    readableTotal: result.reduce((n, t) => n + (t.left ?? 0) + (t.right ?? 0), 0),
  };
}

/**
 * Crea la función de análisis. `client` se puede inyectar para pruebas;
 * por defecto usa el SDK oficial con ANTHROPIC_API_KEY del entorno del servidor.
 */
export function createDominoAnalyzer({ client, apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  const anthropic = client ?? (apiKey ? new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 }) : null);

  return {
    configured: Boolean(anthropic),
    async analyze({ imageBase64, width, height, set }, { signal } = {}) {
      if (!anthropic) {
        throw new VisionError(503, 'El conteo con cámara no está configurado en el servidor (falta ANTHROPIC_API_KEY).');
      }
      const maxPips = TILE_SETS[set];
      if (!maxPips) throw new VisionError(400, 'Elige el conjunto: doble seis, doble nueve o doble doce.');
      if (typeof imageBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
        throw new VisionError(400, 'La imagen no es válida.');
      }
      const bytes = Buffer.from(imageBase64, 'base64');
      if (bytes.length > MAX_IMAGE_BYTES) throw new VisionError(413, 'La imagen es demasiado grande.');
      const size = jpegSize(bytes);
      if (!size) throw new VisionError(400, 'La imagen debe ser JPEG.');
      if (size.width !== width || size.height !== height) {
        throw new VisionError(400, 'Las dimensiones de la imagen no coinciden.');
      }
      if (!fitsVisionLimits(width, height)) {
        throw new VisionError(400, 'La imagen supera el tamaño permitido; la app debe reducirla antes de enviarla.');
      }

      let response;
      try {
        response = await anthropic.beta.messages.create(
          {
            model: VISION_MODEL,
            max_tokens: 16000,
            // Si el modelo declina la solicitud, el servidor reintenta con el modelo alternativo predeterminado.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: {
              effort: 'high',
              format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
            },
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
                    // Si la imagen fuera a reescalarse, fallar en lugar de devolver coordenadas desalineadas.
                    transformations: { oversized_image: 'error' },
                  },
                  { type: 'text', text: buildPrompt(maxPips, width, height) },
                ],
              },
            ],
          },
          { signal },
        );
      } catch (err) {
        throw mapAnthropicError(err);
      }

      if (response.stop_reason === 'refusal') {
        throw new VisionError(422, 'El servicio no pudo analizar esta imagen. Prueba con otra foto o anota manualmente.');
      }
      if (response.stop_reason === 'max_tokens') {
        throw new VisionError(502, 'Hay demasiadas fichas en la foto. Cuenta por grupos más pequeños.');
      }
      const block = response.content.find((b) => b.type === 'text');
      if (!block) throw new VisionError(502, 'El servicio de visión no devolvió resultados.');
      let raw;
      try {
        raw = JSON.parse(block.text);
      } catch {
        throw new VisionError(502, 'El servicio de visión devolvió datos incompletos. Inténtalo de nuevo.');
      }
      return { ...normalizeDetection(raw, { width, height, maxPips }), set };
    },
  };
}

function mapAnthropicError(err) {
  if (err instanceof Anthropic.APIUserAbortError) return new VisionError(499, 'Análisis cancelado.');
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new VisionError(504, 'El servicio de visión tardó demasiado. Inténtalo de nuevo.');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new VisionError(503, 'El servidor no pudo conectarse al servicio de visión.');
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new VisionError(503, 'El servicio de visión no está bien configurado en el servidor.');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new VisionError(429, 'El servicio de visión está saturado. Espera un momento e inténtalo de nuevo.');
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new VisionError(422, 'La imagen no se pudo procesar. Toma otra foto.');
  }
  if (err instanceof Anthropic.APIError) {
    return new VisionError(503, 'El servicio de visión no está disponible en este momento.');
  }
  return err;
}
