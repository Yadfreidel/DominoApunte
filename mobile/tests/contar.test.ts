/// <reference types="node" />
// Conteo de fichas: líneas «Ficha 1: 6 | 4 = 10», total hablado y correcciones que actualizan el total.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  addManualTile,
  confirmGroup,
  editTile,
  groupTotal,
  handTotal,
  numberToSpanish,
  removeTile,
  spokenTotal,
  tileLine,
  upsertGroup,
  type Tile,
  type TileGroup,
} from '../src/domain/tiles.ts';

const tile = (id: string, left: number | null, right: number | null, status: Tile['status'] = 'ok'): Tile => ({
  id,
  left,
  right,
  box: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
  status,
  reviewReason: status === 'revisar' ? 'reflejo sobre los puntos' : '',
  source: 'detectada',
});
const group = (tiles: Tile[]): TileGroup => ({ id: 'g1', set: 'doble6', photoUri: 'foto', tiles, imageIssues: [], confirmed: false });

describe('lista de fichas y total', () => {
  test('formato «Ficha N: a | b = suma», con «?» si falta una mitad', () => {
    assert.equal(tileLine(tile('a', 6, 4), 0), 'Ficha 1: 6 | 4 = 10');
    assert.equal(tileLine(tile('b', 3, 0), 1), 'Ficha 2: 3 | 0 = 3');
    assert.equal(tileLine(tile('c', null, 5, 'revisar'), 2), 'Ficha 3: ? | 5 = ?');
    assert.equal(groupTotal(group([tile('a', 6, 4), tile('b', 3, 0)])), 13);
  });

  test('corregir, eliminar y agregar fichas actualiza el total', () => {
    let g = group([tile('a', 6, 4), tile('b', 3, 0), tile('c', 5, 5)]);
    assert.equal(groupTotal(g), 23);
    g = editTile(g, 'a', { right: 2 });
    assert.equal(groupTotal(g), 21);
    g = removeTile(g, 'c');
    assert.equal(groupTotal(g), 11);
    g = addManualTile(g, 'm1');
    assert.throws(() => confirmGroup(g), /Revisa/);
    g = editTile(g, 'm1', { left: 6, right: 6 });
    assert.equal(groupTotal(g), 23);
    const confirmed = confirmGroup(g);
    assert.equal(handTotal([confirmed]), 23);
  });

  test('una ficha dudosa impide confirmar hasta revisarla; solo suman los grupos confirmados', () => {
    const g = group([tile('a', 6, 4), tile('b', 2, 2, 'revisar')]);
    assert.throws(() => confirmGroup(g), /Revisa/);
    assert.equal(handTotal([g]), 0);
  });

  test('el mismo grupo no se suma dos veces', () => {
    const g = confirmGroup(group([tile('a', 6, 4)]));
    const groups = upsertGroup(upsertGroup([], g), g);
    assert.equal(groups.length, 1);
    assert.equal(handTotal(groups), 10);
  });
});

describe('Escuchar total', () => {
  test('números en palabras', () => {
    assert.equal(numberToSpanish(0), 'cero');
    assert.equal(numberToSpanish(13), 'trece');
    assert.equal(numberToSpanish(21), 'veintiuno');
    assert.equal(numberToSpanish(45), 'cuarenta y cinco');
    assert.equal(numberToSpanish(100), 'cien');
    assert.equal(numberToSpanish(115), 'ciento quince');
    assert.equal(numberToSpanish(200), 'doscientos');
    assert.equal(numberToSpanish(1000), 'mil');
  });

  test('frase completa con concordancia', () => {
    assert.equal(spokenTotal(13), 'El total es trece puntos');
    assert.equal(spokenTotal(1), 'El total es un punto');
    assert.equal(spokenTotal(0), 'El total es cero puntos');
    assert.equal(spokenTotal(21), 'El total es veintiún puntos');
    assert.equal(spokenTotal(31), 'El total es treinta y un puntos');
  });
});
