/// <reference types="node" />
// Tema global, valores predeterminados del organizador, reglas por partida y torneos en pausa.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  contrastChecks,
  contrastRatio,
  deriveTokens,
  isValidAppearance,
  ORIGINAL_APPEARANCE,
  PRESETS,
  readableOn,
  sameAppearance,
} from '../src/domain/appearance.ts';
import { seededRng } from '../src/domain/draw.ts';
import { addHand, createGame, createRematch, validateSetup, type GameSetup } from '../src/domain/game.ts';
import { DEFAULT_SETTINGS, gameDefaults, MemoryStorage, Repository, type PublicConfig } from '../src/domain/repository.ts';
import { buildSummarySvg } from '../src/domain/summary.ts';
import { createTournament, matchGameSetup, resolveTournament, TournamentError } from '../src/domain/tournament.ts';

const T = '2026-10-20T20:00:00.000Z';
let n = 0;
const ids = () => `y${++n}`;

describe('apariencia', () => {
  test('los seis temas prediseñados son legibles (mismas reglas que el servidor)', () => {
    assert.deepEqual(
      PRESETS.map((p) => p.id),
      ['original', 'verde', 'azul', 'morado', 'rojo', 'oscuro'],
    );
    for (const p of PRESETS) {
      const failing = contrastChecks(p.colors).filter((c) => !c.ok);
      assert.deepEqual(failing, [], `tema ${p.name}`);
    }
  });

  test('el tema original conserva exactamente los colores del diseño', () => {
    const t = deriveTokens(ORIGINAL_APPEARANCE);
    assert.equal(t.bg, '#050A24');
    assert.equal(t.lime, '#C6F432');
    assert.equal(t.purple, '#A06BFF');
    assert.equal(t.surface, 'rgba(16, 24, 66, 0.86)');
    assert.equal(t.onButton, '#0A1030');
  });

  test('un tema personalizado deriva toda la paleta y el texto de los botones es legible', () => {
    const red = PRESETS.find((p) => p.id === 'rojo')!;
    const t = deriveTokens({ preset: 'rojo', colors: red.colors });
    assert.equal(t.bg, red.colors.background);
    assert.equal(t.lime, red.colors.primary);
    assert.equal(t.button, red.colors.button);
    assert.ok(contrastRatio(t.onButton, t.button) >= 4.5);
    assert.ok(contrastRatio(t.textMuted, t.bg) >= 4.5, 'texto secundario legible');
  });

  test('detecta colores ilegibles y valida el formato', () => {
    const bad = { ...ORIGINAL_APPEARANCE.colors, background: '#FFFFFF', card: '#FFFFFF', text: '#EEEEEE' };
    const failing = contrastChecks(bad).filter((c) => !c.ok).map((c) => c.label);
    assert.ok(failing.includes('Texto sobre el fondo'));
    assert.equal(readableOn('#FFFFFF'), '#0A1030');
    assert.equal(readableOn('#000000'), '#FFFFFF');
    assert.equal(isValidAppearance({ preset: 'x', colors: { ...bad, primary: 'rojo' } }), false);
    assert.equal(isValidAppearance(ORIGINAL_APPEARANCE), true);
    assert.equal(sameAppearance(ORIGINAL_APPEARANCE, { preset: 'original', colors: { ...ORIGINAL_APPEARANCE.colors, text: '#ffffff' } }), true);
  });
});

describe('valores predeterminados del organizador', () => {
  const config: PublicConfig = {
    settings: { defaultTargets: [150, 300], defaultTarget: 300, defaultMode: 'parejas', rules: { passPoints: 25 } },
    branding: { appName: 'Club', tagline: '', homeText: '', logo: null },
    appearance: ORIGINAL_APPEARANCE,
  };

  test('sin servidor se usan los del dispositivo', () => {
    const d = gameDefaults(DEFAULT_SETTINGS, null);
    assert.deepEqual(d, { targets: [100, 150, 200], defaultTarget: 200, defaultMode: 'individual', passPoints: 0 });
  });

  test('con servidor son sugerencias: se suman a las metas propias del usuario', () => {
    const d = gameDefaults({ ...DEFAULT_SETTINGS, targets: [100, 500] }, config);
    assert.deepEqual(d.targets, [100, 150, 300, 500]);
    assert.equal(d.defaultTarget, 300);
    assert.equal(d.defaultMode, 'parejas');
    assert.equal(d.passPoints, 25);
  });

  test('la configuración pública se guarda para usarla sin conexión', async () => {
    const repo = new Repository(new MemoryStorage());
    assert.equal(await repo.loadPublicConfig(), null);
    await repo.savePublicConfig(config);
    assert.deepEqual(await repo.loadPublicConfig(), config);
  });
});

describe('reglas opcionales por partida', () => {
  const setup = (rules?: GameSetup['rules']): GameSetup => ({ playerCount: 2, names: ['Ana', 'Luis'], mode: 'individual', target: 100, rules });

  test('la partida copia sus reglas: cambiar los valores predeterminados después no la afecta', () => {
    const defaults = { passPoints: 20 };
    const g = createGame(setup({ ...defaults }), T, ids);
    defaults.passPoints = 50;
    assert.deepEqual(g.rules, { passPoints: 20 });
    const played = addHand(g, g.sides[1].id, 20, 'h1', T);
    assert.equal(played.rules?.passPoints, 20);
    assert.deepEqual(createRematch(played, T, ids).rules, { passPoints: 20 }, 'la revancha conserva las reglas');
  });

  test('sin reglas la partida funciona como siempre y se rechazan valores inválidos', () => {
    assert.equal(createGame(setup(), T, ids).rules, null);
    assert.match(validateSetup(setup({ passPoints: -1 })) ?? '', /pase/);
    assert.match(validateSetup(setup({ passPoints: 2.5 })) ?? '', /pase/);
  });
});

describe('torneos y resumen', () => {
  test('un torneo en pausa no permite empezar enfrentamientos', () => {
    const t = createTournament(
      { name: 'Copa', mode: 'individual', target: 50, entrants: ['A', 'B'].map((x) => ({ players: [{ playerId: x, name: x }] })) },
      T,
      seededRng(1),
      ids,
    );
    const match = resolveTournament(t, []).rounds[0][0];
    assert.throws(() => matchGameSetup({ ...t, status: 'pausado' }, match), (err) => err instanceof TournamentError && /pausa/.test(err.message));
    assert.ok(matchGameSetup(t, match));
  });

  test('el resumen usa el nombre de la app definido por el administrador', () => {
    const g = createGame({ playerCount: 2, names: ['Ana', 'Luis'], mode: 'individual', target: 100 }, T, ids);
    const { svg } = buildSummarySvg(g, { appName: 'Club <Dominó>' });
    assert.ok(svg.includes('CLUB &lt;DOMINÓ&gt;'));
    assert.ok(svg.includes('Anotado con Club &lt;Dominó&gt;'));
  });
});
