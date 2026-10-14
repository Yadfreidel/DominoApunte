// Pruebas con un servicio de visión SIMULADO: validan la lógica del servidor (validación,
// normalización, total calculado en código, errores), no la precisión del reconocimiento real.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDatabase } from '../src/db.js';
import { createDominoAnalyzer, jpegSize, normalizeDetection, VisionError } from '../src/vision.js';

/** JPEG mínimo con un marcador SOF0 que declara width x height (suficiente para validar tamaño). */
function fakeJpeg(width, height) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), sof, Buffer.from([0xff, 0xd9])]);
}

function mockClient(respond) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params, options) => {
          calls.push({ params, options });
          return respond(params);
        },
      },
    },
  };
}

const okResponse = (data, stop_reason = 'end_turn') => ({
  stop_reason,
  content: [{ type: 'text', text: JSON.stringify(data) }],
});

describe('normalización de detecciones', () => {
  const opts = { width: 1000, height: 800, maxPips: 6 };

  test('mitades en blanco cuentan 0 y el total se calcula sumando mitades', () => {
    const r = normalizeDetection(
      {
        image_usable: true,
        image_issues: [],
        total: 999, // un total del modelo nunca se usa
        tiles: [
          { box: { x1: 10, y1: 10, x2: 110, y2: 60 }, first_half: 0, second_half: 0, needs_review: false, review_reason: '' },
          { box: { x1: 200, y1: 10, x2: 300, y2: 60 }, first_half: 6, second_half: 4, needs_review: false, review_reason: '' },
        ],
      },
      opts,
    );
    assert.deepEqual(r.tiles.map((t) => [t.left, t.right, t.status]), [[0, 0, 'ok'], [6, 4, 'ok']]);
    assert.equal(r.readableTotal, 10);
    assert.deepEqual(r.tiles[1].box, { x: 0.2, y: 0.0125, w: 0.1, h: 0.0625 });
  });

  test('valores fuera del conjunto o ilegibles quedan en null y en revisión (no se inventan)', () => {
    const r = normalizeDetection(
      {
        image_usable: true,
        image_issues: ['reflejos'],
        tiles: [
          { box: { x1: 0, y1: 0, x2: 100, y2: 50 }, first_half: 9, second_half: 3, needs_review: false, review_reason: '' },
          { box: { x1: 300, y1: 0, x2: 400, y2: 50 }, first_half: null, second_half: 2, needs_review: true, review_reason: 'reflejo sobre los puntos' },
          { box: { x1: 500, y1: 0, x2: 600, y2: 50 }, first_half: 2.5, second_half: 1, needs_review: false, review_reason: '' },
        ],
      },
      opts,
    );
    assert.deepEqual(r.tiles.map((t) => [t.left, t.right, t.status]), [[null, 3, 'revisar'], [null, 2, 'revisar'], [null, 1, 'revisar']]);
    assert.match(r.tiles[0].reviewReason, /no es válido en doble 6/);
    assert.match(r.tiles[1].reviewReason, /reflejo/);
    assert.equal(r.readableTotal, 6);
    assert.deepEqual(r.imageIssues, ['reflejos']);
  });

  test('dos fichas físicas iguales no se marcan como duplicadas; un rectángulo casi idéntico sí', () => {
    const same = { first_half: 5, second_half: 5, needs_review: false, review_reason: '' };
    const r = normalizeDetection(
      {
        image_usable: true,
        image_issues: [],
        tiles: [
          { ...same, box: { x1: 0, y1: 0, x2: 100, y2: 50 } },
          { ...same, box: { x1: 400, y1: 0, x2: 500, y2: 50 } },
          { ...same, box: { x1: 402, y1: 2, x2: 501, y2: 51 } },
        ],
      },
      opts,
    );
    assert.equal(r.tiles[1].status, 'ok');
    assert.equal(r.tiles[2].status, 'revisar');
    assert.match(r.tiles[2].reviewReason, /posible duplicado de la ficha 2/);
  });

  test('foto sin dominó', () => {
    const r = normalizeDetection({ image_usable: false, image_issues: [], tiles: [] }, opts);
    assert.equal(r.imageUsable, false);
    assert.deepEqual(r.imageIssues, ['sin_fichas']);
    assert.equal(r.readableTotal, 0);
  });
});

describe('análisis con servicio simulado', () => {
  const jpeg = fakeJpeg(1200, 900).toString('base64');

  test('lee dimensiones reales del JPEG', () => {
    assert.deepEqual(jpegSize(fakeJpeg(1200, 900)), { width: 1200, height: 900 });
    assert.equal(jpegSize(Buffer.from('no es jpeg')), null);
  });

  test('envía la imagen con transformations=error, salida estructurada y el modelo correcto', async () => {
    const client = mockClient(() =>
      okResponse({ image_usable: true, image_issues: [], tiles: [{ box: { x1: 1, y1: 1, x2: 100, y2: 60 }, first_half: 3, second_half: 1, needs_review: false, review_reason: '' }] }),
    );
    const r = await createDominoAnalyzer({ client }).analyze({ imageBase64: jpeg, width: 1200, height: 900, set: 'doble9' });
    const p = client.calls[0].params;
    assert.equal(p.model, 'claude-opus-5-5');
    assert.equal(p.messages[0].content[0].transformations.oversized_image, 'error');
    assert.equal(p.output_config.format.type, 'json_schema');
    assert.match(p.messages[0].content[1].text, /double-9/);
    assert.equal(r.readableTotal, 4);
    assert.equal(r.set, 'doble9');
  });

  test('rechaza dimensiones falsas, imágenes no JPEG y tamaños que el modelo reescalaría', async () => {
    const a = createDominoAnalyzer({ client: mockClient(() => okResponse({})) });
    await assert.rejects(a.analyze({ imageBase64: jpeg, width: 1000, height: 900, set: 'doble6' }), /no coinciden/);
    await assert.rejects(a.analyze({ imageBase64: Buffer.from('hola').toString('base64'), width: 1, height: 1, set: 'doble6' }), /JPEG/);
    const big = fakeJpeg(4000, 3000).toString('base64');
    await assert.rejects(a.analyze({ imageBase64: big, width: 4000, height: 3000, set: 'doble6' }), /tamaño permitido/);
    await assert.rejects(a.analyze({ imageBase64: jpeg, width: 1200, height: 900, set: 'doble7' }), /conjunto/);
  });

  test('negativa del modelo, respuesta truncada y errores del servicio se traducen a mensajes claros', async () => {
    const refusal = createDominoAnalyzer({ client: mockClient(() => ({ stop_reason: 'refusal', content: [] })) });
    await assert.rejects(refusal.analyze({ imageBase64: jpeg, width: 1200, height: 900, set: 'doble6' }), (e) => e instanceof VisionError && e.status === 422);
    const truncated = createDominoAnalyzer({ client: mockClient(() => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"tiles":[' }] })) });
    await assert.rejects(truncated.analyze({ imageBase64: jpeg, width: 1200, height: 900, set: 'doble6' }), (e) => e.status === 502);
    const limited = createDominoAnalyzer({
      client: mockClient(() => {
        throw new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', new Headers());
      }),
    });
    await assert.rejects(limited.analyze({ imageBase64: jpeg, width: 1200, height: 900, set: 'doble6' }), (e) => e.status === 429);
    const offline = createDominoAnalyzer({
      client: mockClient(() => {
        throw new Anthropic.APIConnectionError({ message: 'sin red' });
      }),
    });
    await assert.rejects(offline.analyze({ imageBase64: jpeg, width: 1200, height: 900, set: 'doble6' }), (e) => e.status === 503);
  });

  test('sin clave configurada responde 503 sin llamar a ningún servicio', async () => {
    const a = createDominoAnalyzer({ apiKey: '' });
    assert.equal(a.configured, false);
    await assert.rejects(a.analyze({ imageBase64: jpeg, width: 1200, height: 900, set: 'doble6' }), (e) => e.status === 503);
  });
});

describe('ruta /api/vision/dominoes', () => {
  let server;
  let base;
  let token;
  const jpeg = fakeJpeg(800, 600).toString('base64');
  const client = mockClient(() =>
    okResponse({ image_usable: true, image_issues: [], tiles: [{ box: { x1: 10, y1: 10, x2: 100, y2: 60 }, first_half: 6, second_half: 6, needs_review: false, review_reason: '' }] }),
  );

  before(async () => {
    const db = openDatabase(':memory:');
    const pass = randomBytes(12).toString('hex');
    db.prepare("INSERT INTO users (username, password_hash, role, active, created_at) VALUES ('mesa', ?, 'anotador', 1, ?)").run(
      hashPassword(pass),
      new Date().toISOString(),
    );
    const app = createApp({ db, jwtSecret: randomBytes(48).toString('hex'), visionAnalyzer: createDominoAnalyzer({ client }) });
    await new Promise((r) => {
      server = app.listen(0, '127.0.0.1', r);
    });
    base = `http://127.0.0.1:${server.address().port}/api`;
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'mesa', password: pass }),
    });
    token = (await login.json()).token;
  });
  after(() => server?.close());

  const post = (body, auth = true) =>
    fetch(`${base}/vision/dominoes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  test('exige sesión', async () => {
    assert.equal((await post({ image: jpeg, width: 800, height: 600, set: 'doble6' }, false)).status, 401);
  });

  test('analiza y devuelve fichas estructuradas', async () => {
    const res = await post({ image: jpeg, width: 800, height: 600, set: 'doble6' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.tiles[0], {
      id: 'f1',
      left: 6,
      right: 6,
      box: { x: 0.0125, y: 1 / 60, w: 0.1125, h: 50 / 600 },
      status: 'ok',
      reviewReason: '',
    });
    assert.equal(data.readableTotal, 12);
  });

  test('acepta fotos mayores a 2 MB solo en esta ruta', async () => {
    const res = await post({ image: 'A'.repeat(3 * 1024 * 1024), width: 800, height: 600, set: 'doble6' });
    assert.equal(res.status, 400); // pasa el límite de tamaño y la rechaza la validación de JPEG
  });
});
