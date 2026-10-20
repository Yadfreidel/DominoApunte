// Conecta el narrador con las acciones hechas en este dispositivo (store.onLocalAction): nunca con la
// carga del historial ni con la sincronización, así que no anuncia partidas antiguas ni repite
// anuncios al reconstruir el estado. También muestra cada anuncio en pantalla (subtítulo), útil cuando
// el dispositivo no tiene voz en español o el narrador está silenciado.
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { challengeNarration, handNarrations, startNarration, victoryNarration, type Narration } from '@/domain/narrator.ts';
import { challengeProgress } from '@/domain/challenge.ts';
import type { Game } from '@/domain/game.ts';
import { narrator } from '@/services/narrator';
import { useStore } from '@/state/AppStore';
import { colors, radius, space } from '@/theme';

export function NarratorHost() {
  const store = useStore();
  const { settings, onLocalAction } = store;
  const insets = useSafeAreaInsets();
  const latest = useRef(store);
  useEffect(() => {
    latest.current = store;
  });

  useEffect(() => {
    narrator.configure(settings.narrator);
  }, [settings.narrator]);

  useEffect(
    () =>
      onLocalAction((action) => {
        const n = latest.current.settings.narrator;
        if (!n.enabled) return;
        if (action.type === 'start') {
          narrator.announce([startNarration(action.game)]);
          return;
        }
        const { before, after } = action;
        if (action.type === 'hand' || action.type === 'edit') {
          if (action.type === 'edit') narrator.invalidate(after.id);
          if (before.status === 'pendiente' && after.status === 'terminada') {
            // La victoria se anuncia junto con la celebración (tras la fanfarria si está activa), con el
            // marcador final copiado de la partida terminada: no depende del reinicio posterior.
            const items: Narration[] = [];
            const v = victoryNarration(after);
            if (v) items.push(v);
            const c = challengeAnnouncement(latest.current.challenges, latest.current.games, before, after);
            if (c) items.push(c);
            narrator.announce(items, latest.current.settings.victorySound ? 1600 : 400);
          } else if (action.type === 'hand') {
            narrator.announce(handNarrations(before, after));
          }
          return;
        }
        // Deshacer, borrar o cancelar: lo pendiente de esa partida deja de ser válido.
        narrator.invalidate(after.id);
      }),
    [onLocalAction],
  );

  const state = useSyncExternalStore(narrator.subscribe, narrator.getState, narrator.getState);
  if (!settings.narrator.enabled || !state.caption) return null;
  return (
    <View pointerEvents="none" style={[s.wrap, { bottom: insets.bottom + space.lg }]}>
      <View style={s.caption} accessibilityLiveRegion="polite" accessibilityLabel={`Narrador: ${state.caption.text}`}>
        <Ionicons name={settings.narrator.muted ? 'volume-mute' : 'megaphone-outline'} size={18} color={colors.warning} />
        <Text style={s.text}>{state.caption.text}</Text>
      </View>
    </View>
  );
}

function challengeAnnouncement(challenges: ReturnType<typeof useStore>['challenges'], games: Game[], before: Game, after: Game) {
  if (!after.challengeId) return null;
  const ch = challenges.find((c) => c.id === after.challengeId);
  if (!ch) return null;
  const at = new Date().toISOString();
  const withBefore = games.map((g) => (g.id === after.id ? before : g));
  const withAfter = games.some((g) => g.id === after.id) ? games.map((g) => (g.id === after.id ? after : g)) : [...games, after];
  return challengeNarration(ch, challengeProgress(ch, withBefore, at), challengeProgress(ch, withAfter, at), after.id);
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: space.md, zIndex: 900 },
  caption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    maxWidth: 560,
    backgroundColor: colors.surfaceSolid,
    borderWidth: 1.5,
    borderColor: colors.warning,
    borderRadius: radius.lg,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  text: { color: colors.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
});
