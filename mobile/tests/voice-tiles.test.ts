/// <reference types="node" />
// Pruebas de la lógica de voz y conteo de fichas. Usan transcripciones escritas y datos de
// detección simulados: NO miden la precisión del reconocimiento de voz ni de la cámara reales.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createGame } from '../src/domain/game.ts';
import {
  addManualTile,
  confirmGroup,
  editTile,
  groupProblems,
  groupTotal,
  handTotal,
  markReviewed,
  removeTile,
  upsertGroup,
  visionSize,
  type TileGroup,
} from '../src/domain/tiles.ts';
import { extractNumbers, normalizeSpeech, parseVoiceCommand } from '../src/domain/voice.ts';

const T = '2026-10-14T20:00:00.000Z';
let n = 0;
const ids = () => `i${++n}`;

const individual = createGame({ playerCount: 3, names: ['Juan', 'Juana', 'María José'], mode: 'individual', target: 200 }, T, ids);
const couples = createGame({ playerCount: 4, names: ['Ana', 'Luis', 'Marta', 'Pedro'], mode: 'parejas', target: 200 }, T, ids);
const sideOf = (g: typeof individual, name: string) => g.sides.find((s) => s.name === name)!.id;

describe('números en español', () => {
  test('cifras y palabras', () => {
    const cases: [string, number[]][] = [
      ['23', [23]],
      ['veintitrés', [23]],
      ['treinta y cinco', [35]],
      ['ciento cuarenta y dos', [142]],
      ['cero', [0]],
      ['cien', [100]],
      ['quince y veinte', [15, 20]],
      ['mil', [1000]],
      ['doscientos cinco', [205]],
    ];
    for (const [text, expected] of cases) assert.deepEqual(extractNumbers(normalizeSpeech(text)), expected, text);
  });
});

describe('órdenes de voz', () => {
  test('"23 puntos para Juan" no se confunde con Juana', () => {
    const p = parseVoiceCommand('23 puntos para Juan', individual);
    assert.equal(p.points, 23);
    assert.equal(p.sideId, sideOf(individual, 'Juan'));
    assert.equal(p.ready, true);
  });

  test('"Juan ganó veintitrés"', () => {
    const p = parseVoiceCommand('Juan ganó veintitrés', individual);
    assert.deepEqual([p.points, p.sideId, p.ready], [23, sideOf(individual, 'Juan'), true]);
  });

  test('"Juana ganó 10" elige a Juana', () => {
    assert.equal(parseVoiceCommand('Juana ganó 10', individual).sideId, sideOf(individual, 'Juana'));
  });

  test('nombre compuesto y primer nombre', () => {
    assert.equal(parseVoiceCommand('quince para María José', individual).sideId, sideOf(individual, 'María José'));
    assert.equal(parseVoiceCommand('maria gano 8', individual).sideId, sideOf(individual, 'María José'));
  });

  test('"35 para el equipo azul": en una partida sin equipo azul pide elegir', () => {
    const p = parseVoiceCommand('35 para el equipo azul', couples);
    assert.equal(p.points, 35);
    assert.equal(p.sideId, null);
    assert.equal(p.ready, false);
    assert.match(p.issues.join(' '), /No reconocí a quién/);
  });

  test('equipos por color, número o integrante', () => {
    const [a, b] = couples.sides;
    assert.equal(parseVoiceCommand('35 para el equipo verde', couples).sideId, a.id);
    assert.equal(parseVoiceCommand('veinte para la pareja dos', couples).sideId, b.id);
    assert.equal(parseVoiceCommand('veinte para la pareja 2', couples).points, 20);
    assert.equal(parseVoiceCommand('Luis ganó 12', couples).sideId, a.id);
    assert.equal(parseVoiceCommand('12 para los morados', couples).sideId, b.id);
  });

  test('varios destinatarios: pide elegir', () => {
    const p = parseVoiceCommand('20 para Juan y para Juana', individual);
    assert.equal(p.sideId, null);
    assert.equal(p.candidateSideIds.length, 2);
    assert.match(p.issues[0], /más de un/);
  });

  test('nombre ambiguo en la partida (dos jugadores llamados Pedro)', () => {
    const g = createGame({ playerCount: 2, names: ['Pedro Pérez', 'Pedro Díaz'], mode: 'individual', target: 100 }, T, ids);
    const p = parseVoiceCommand('Pedro ganó 10', g);
    assert.equal(p.sideId, null);
    assert.equal(p.candidateSideIds.length, 2);
    assert.equal(parseVoiceCommand('10 para Pedro Díaz', g).sideId, g.sides[1].id);
  });

  test('nombre parecido: sugiere sin elegir', () => {
    const p = parseVoiceCommand('veinte para Martha', couples);
    assert.equal(p.sideId, null);
    assert.deepEqual(p.candidateSideIds, [couples.sides[1].id]);
    assert.match(p.issues[0], /seguridad/);
  });

  test('frases incompletas o inválidas', () => {
    assert.match(parseVoiceCommand('para Juan', individual).issues.join(' '), /cuántos puntos/);
    assert.equal(parseVoiceCommand('veinte', individual).sideId, null);
    const many = parseVoiceCommand('Juan 20 o 25', individual);
    assert.equal(many.points, null);
    assert.match(many.issues.join(' '), /varios números/);
    const big = parseVoiceCommand('dos mil para Juan', individual);
    assert.equal(big.points, null);
    assert.match(big.issues.join(' '), /máximo/);
    assert.equal(parseVoiceCommand('', individual).ready, false);
    assert.equal(parseVoiceCommand('eh mmm ruido', individual).ready, false);
  });
});

describe('conteo de fichas', () => {
  const base = (): TileGroup => ({
    id: 'g1',
    set: 'doble6',
    photoUri: null,
    imageIssues: [],
    confirmed: false,
    tiles: [
      { id: 'f1', left: 6, right: 4, box: { x: 0, y: 0, w: 0.1, h: 0.1 }, status: 'ok', reviewReason: '', source: 'detectada' },
      { id: 'f2', left: 0, right: 0, box: { x: 0.2, y: 0, w: 0.1, h: 0.1 }, status: 'ok', reviewReason: '', source: 'detectada' },
      { id: 'f3', left: null, right: 3, box: { x: 0.4, y: 0, w: 0.1, h: 0.1 }, status: 'revisar', reviewReason: 'reflejo', source: 'detectada' },
      { id: 'f4', left: 5, right: 5, box: { x: 0.6, y: 0, w: 0.1, h: 0.1 }, status: 'revisar', reviewReason: 'posible duplicado de la ficha 1', source: 'detectada' },
    ],
  });

  test('el total suma mitades y la ficha en blanco vale 0', () => {
    assert.equal(groupTotal(base()), 10 + 0 + 3 + 10);
  });

  test('no se puede confirmar con fichas en revisión', () => {
    assert.equal(groupProblems(base()).length, 2);
    assert.throws(() => confirmGroup(base()), /Revisa/);
  });

  test('corregir, quitar duplicado y agregar omitida recalculan al instante', () => {
    let g = editTile(base(), 'f3', { left: 2 });
    assert.equal(groupTotal(g), 10 + 0 + 5 + 10);
    g = removeTile(g, 'f4');
    assert.equal(groupTotal(g), 15);
    g = addManualTile(g, 'm1');
    assert.equal(groupProblems(g).length, 1);
    g = editTile(g, 'm1', { left: 1, right: 2 });
    assert.equal(groupTotal(g), 18);
    g = confirmGroup(g);
    assert.equal(g.confirmed, true);
  });

  test('marcar como revisada sin cambiar valores', () => {
    const g = markReviewed(base(), 'f4');
    assert.equal(g.tiles.find((t) => t.id === 'f4')!.status, 'ok');
    // una ficha con valor faltante no se puede dar por revisada
    assert.equal(markReviewed(base(), 'f3').tiles.find((t) => t.id === 'f3')!.status, 'revisar');
  });

  test('varios grupos en una mano: solo suman los confirmados y no se duplican', () => {
    const g1 = confirmGroup(removeTile(editTile(base(), 'f3', { left: 1 }), 'f4'));
    const g2: TileGroup = { ...base(), id: 'g2', tiles: [base().tiles[0]] };
    let groups = upsertGroup([], g1);
    groups = upsertGroup(groups, g2);
    assert.equal(handTotal(groups), groupTotal(g1));
    groups = upsertGroup(groups, confirmGroup(g2));
    groups = upsertGroup(groups, confirmGroup(g2)); // respuesta repetida: no se suma dos veces
    assert.equal(groups.length, 2);
    assert.equal(handTotal(groups), groupTotal(g1) + 10);
  });

  test('editar un grupo confirmado lo vuelve a dejar sin confirmar', () => {
    const g = confirmGroup(removeTile(editTile(base(), 'f3', { left: 1 }), 'f4'));
    assert.equal(editTile(g, 'f1', { left: 5 }).confirmed, false);
  });
});

describe('tamaño de foto para el análisis', () => {
  test('coincide con los ejemplos de la documentación oficial (nivel de alta resolución)', () => {
    assert.deepEqual(visionSize(1920, 1080), [1920, 1080]);
    assert.deepEqual(visionSize(1000, 1000), [1000, 1000]);
    assert.deepEqual(visionSize(3840, 2160), [2576, 1449]);
  });

  test('fotos verticales de celular quedan dentro de los límites', () => {
    const [w, h] = visionSize(3024, 4032);
    assert.ok(Math.ceil(w / 28) * Math.ceil(h / 28) <= 4784);
    assert.ok(Math.abs(w / h - 3024 / 4032) < 0.01);
  });
});
