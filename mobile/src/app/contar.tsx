import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { useDialogs } from '@/components/Dialogs';
import { Button, Card, EmptyState, ErrorText, Loading, Pill, Screen, type IconName } from '@/components/ui';
import { MAX_HAND_POINTS, newId } from '@/domain/game.ts';
import {
  addManualTile,
  confirmGroup,
  editTile,
  groupProblems,
  groupTotal,
  handTotal,
  markReviewed,
  removeTile,
  setMax,
  TILE_SETS,
  tileValue,
  upsertGroup,
  type Tile,
  type TileGroup,
  type TileSetId,
} from '@/domain/tiles.ts';
import { ApiError } from '@/services/api';
import { cameraAvailable, pickTilePhoto, type PreparedPhoto } from '@/services/tilePhoto';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, sideColor, space } from '@/theme';
import { goBackOr } from '@/navigation';

interface DetectionResponse {
  imageUsable: boolean;
  imageIssues: string[];
  tiles: { id: string; left: number | null; right: number | null; box: Tile['box']; status: 'ok' | 'revisar'; reviewReason: string }[];
}

const ISSUE_LABELS: Record<string, string> = {
  sin_fichas: 'No se encontraron fichas de dominó en la foto.',
  borrosa: 'La foto está borrosa.',
  reflejos: 'Hay reflejos sobre algunas fichas.',
  poca_luz: 'Hay poca luz.',
  fichas_tapadas: 'Hay fichas tapadas.',
  fichas_superpuestas: 'Hay fichas encimadas.',
  fichas_cortadas: 'Algunas fichas quedan cortadas en el borde.',
  fichas_boca_abajo: 'Hay fichas boca abajo (no se cuentan).',
};

const GUIDE: { icon: IconName; text: string }[] = [
  { icon: 'grid-outline', text: 'Fichas completas y separadas entre sí' },
  { icon: 'eye-outline', text: 'Boca arriba, con todos los puntos a la vista' },
  { icon: 'square-outline', text: 'Fondo liso de un solo color' },
  { icon: 'sunny-outline', text: 'Buena luz, sin reflejos ni sombras fuertes' },
  { icon: 'arrow-down-outline', text: 'Cámara desde arriba, sin inclinar' },
];

type Step = 'setup' | 'analyzing' | 'review' | 'summary';

export default function CountTiles() {
  const { gameId } = useLocalSearchParams<{ gameId?: string }>();
  const store = useStore();
  const { confirm, toast } = useDialogs();
  const game = store.games.find((g) => g.id === (gameId ?? store.currentGame?.id));

  const [step, setStep] = useState<Step>('setup');
  const [set, setSet] = useState<TileSetId>('doble6');
  const [groups, setGroups] = useState<TileGroup[]>([]);
  const [current, setCurrent] = useState<TileGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sideId, setSideId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [visionConfigured, setVisionConfigured] = useState<boolean | null>(null);
  // Una sola mano por pantalla: confirmar varias veces no la duplica.
  const [handId] = useState(newId);
  const request = useRef<{ groupId: string; controller: AbortController } | null>(null);
  const submitting = useRef(false);

  const loggedIn = !!store.user;
  const { api } = store;

  useEffect(() => {
    if (!loggedIn) return;
    let alive = true;
    api<{ configured: boolean }>('/vision/status').then(
      (r) => alive && setVisionConfigured(r.configured),
      () => alive && setVisionConfigured(null),
    );
    return () => {
      alive = false;
    };
  }, [api, loggedIn]);

  // Al salir de la pantalla se cancela cualquier análisis pendiente.
  useEffect(() => () => request.current?.controller.abort(), []);

  if (!game || game.status !== 'pendiente') {
    return (
      <Screen header={<AppHeader subtitle="Contar fichas" />}>
        <EmptyState
          icon="alert-circle-outline"
          title="No hay una partida en curso"
          message="El conteo de fichas se usa para anotar una mano de la partida en curso."
          action={<Button label="Volver" variant="outline" onPress={() => goBackOr('/partida')} />}
        />
      </Screen>
    );
  }

  const total = handTotal(groups);
  const unconfirmed = groups.filter((g) => !g.confirmed);

  const analyze = async (source: 'camera' | 'library') => {
    setError(null);
    let photo: PreparedPhoto | null;
    try {
      photo = await pickTilePhoto(source);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la cámara o la galería.');
      return;
    }
    if (!photo) return;
    const groupId = newId();
    const controller = new AbortController();
    request.current?.controller.abort();
    request.current = { groupId, controller };
    setStep('analyzing');
    try {
      const data = await api<DetectionResponse>('/vision/dominoes', {
        method: 'POST',
        body: { image: photo.base64, width: photo.width, height: photo.height, set },
        timeoutMs: 120_000,
        signal: controller.signal,
      });
      // Respuesta tardía de un análisis ya cancelado o reemplazado: se ignora.
      if (request.current?.groupId !== groupId) return;
      request.current = null;
      if (data.tiles.length === 0) {
        setError(data.imageIssues.map((i) => ISSUE_LABELS[i]).filter(Boolean).join(' ') || ISSUE_LABELS.sin_fichas);
        setStep(groups.length ? 'summary' : 'setup');
        return;
      }
      setCurrent({
        id: groupId,
        set,
        photoUri: photo.uri,
        photoAspect: photo.width / photo.height,
        imageIssues: data.imageIssues,
        confirmed: false,
        tiles: data.tiles.map((t) => ({ ...t, id: `${groupId}-${t.id}`, source: 'detectada' })),
      });
      setStep('review');
    } catch (err) {
      if (request.current?.groupId !== groupId) return;
      request.current = null;
      if (err instanceof ApiError && err.status === 499) return;
      setError(err instanceof Error ? err.message : 'No se pudo analizar la foto.');
      setStep(groups.length ? 'summary' : 'setup');
    }
  };

  const cancelAnalysis = () => {
    request.current?.controller.abort();
    request.current = null;
    setStep(groups.length ? 'summary' : 'setup');
  };

  const countByHand = () => {
    const groupId = newId();
    setCurrent(addManualTile({ id: groupId, set, photoUri: null, imageIssues: [], confirmed: false, tiles: [] }, `${groupId}-m${Date.now()}`));
    setError(null);
    setStep('review');
  };

  const saveGroup = () => {
    if (!current) return;
    try {
      const confirmed = confirmGroup(current);
      setGroups((gs) => upsertGroup(gs, confirmed));
      setCurrent(null);
      setStep('summary');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Revisa las fichas.', 'error');
    }
  };

  const discardCurrent = async () => {
    const ok = await confirm({ title: '¿Descartar este grupo?', message: 'Sus fichas no se sumarán.', confirmLabel: 'Descartar', destructive: true });
    if (!ok) return;
    setCurrent(null);
    setStep(groups.length ? 'summary' : 'setup');
  };

  const leave = async () => {
    if (groups.length || current) {
      const ok = await confirm({
        title: '¿Salir sin anotar?',
        message: 'El conteo se descartará y el marcador no cambiará.',
        confirmLabel: 'Salir',
        destructive: true,
      });
      if (!ok) return;
    }
    request.current?.controller.abort();
    goBackOr('/partida');
  };

  const side = game.sides.find((s) => s.id === sideId);
  const tooMany = total > MAX_HAND_POINTS;
  const canConfirm = !!side && groups.length > 0 && unconfirmed.length === 0 && !tooMany && !saving;

  const submit = async () => {
    if (!canConfirm || !side || submitting.current) return;
    const live = store.currentGame;
    if (!live || live.id !== game.id || live.status !== 'pendiente') {
      toast('La partida cambió. No se anotó nada.', 'error');
      goBackOr('/partida');
      return;
    }
    submitting.current = true;
    setSaving(true);
    try {
      await store.addHand(game.id, side.id, total, handId);
      toast(`Mano guardada: ${side.name} +${total}`);
      goBackOr('/partida');
    } catch (err) {
      submitting.current = false;
      setSaving(false);
      toast(err instanceof Error ? err.message : 'No se pudo guardar la mano.', 'error');
    }
  };

  return (
    <Screen header={<AppHeader subtitle="Contar fichas" />}>
      <Button label="Volver a la partida" icon="arrow-back" variant="ghost" size="sm" onPress={leave} style={{ alignSelf: 'flex-start' }} />
      {error ? (
        <Card accent={colors.danger} style={{ gap: space.sm }}>
          <ErrorText>{error}</ErrorText>
          <Text style={s.muted}>Puedes tomar otra foto o contar a mano.</Text>
        </Card>
      ) : null}

      {step === 'setup' || (step === 'summary' && groups.length === 0) ? (
        <SetupStep
          set={set}
          onSet={setSet}
          loggedIn={loggedIn}
          visionConfigured={visionConfigured}
          onCamera={() => analyze('camera')}
          onLibrary={() => analyze('library')}
          onManual={countByHand}
        />
      ) : null}

      {step === 'analyzing' ? (
        <Card style={{ gap: space.md, alignItems: 'center' }}>
          <Loading label="Analizando la foto… puede tardar hasta un minuto" />
          <Button label="Cancelar" variant="outline" onPress={cancelAnalysis} />
        </Card>
      ) : null}

      {step === 'review' && current ? (
        <ReviewStep group={current} onChange={setCurrent} onConfirm={saveGroup} onDiscard={discardCurrent} />
      ) : null}

      {step === 'summary' && groups.length > 0 ? (
        <>
          <Card style={{ gap: space.sm }}>
            <Text style={s.title}>Grupos de esta mano</Text>
            {groups.map((g, i) => (
              <View key={g.id} style={s.groupRow}>
                <Ionicons name={g.photoUri ? 'image-outline' : 'create-outline'} size={20} color={colors.textMuted} />
                <Text style={s.groupText}>
                  Grupo {i + 1}: {g.tiles.length} {g.tiles.length === 1 ? 'ficha' : 'fichas'} · {groupTotal(g)} puntos
                </Text>
                <Pressable
                  onPress={() => {
                    setGroups((gs) => gs.filter((x) => x.id !== g.id));
                    setCurrent({ ...g, confirmed: false });
                    setStep('review');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Revisar grupo ${i + 1}`}
                  style={s.iconBtn}
                >
                  <Ionicons name="create-outline" size={20} color={colors.textMuted} />
                </Pressable>
                <Pressable
                  onPress={() => setGroups((gs) => gs.filter((x) => x.id !== g.id))}
                  accessibilityRole="button"
                  accessibilityLabel={`Quitar grupo ${i + 1}`}
                  style={s.iconBtn}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </Pressable>
              </View>
            ))}
            <View style={s.row}>
              {cameraAvailable ? (
                <Button label="Otra foto" icon="camera-outline" variant="outline" size="sm" onPress={() => analyze('camera')} disabled={!loggedIn} style={s.flex} />
              ) : null}
              <Button label="Otra imagen" icon="images-outline" variant="outline" size="sm" onPress={() => analyze('library')} disabled={!loggedIn} style={s.flex} />
              <Button label="A mano" icon="add" variant="outline" size="sm" onPress={countByHand} style={s.flex} />
            </View>
          </Card>

          <Card style={{ gap: space.md }}>
            <Text style={s.title}>¿A quién se le suman?</Text>
            <View style={s.sides}>
              {game.sides.map((sd, i) => {
                const c = sideColor(i);
                const active = sd.id === sideId;
                return (
                  <Pressable
                    key={sd.id}
                    onPress={() => setSideId(sd.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    style={[s.sideChip, active && { borderColor: c.main, backgroundColor: c.soft }]}
                  >
                    <View style={[s.dot, { backgroundColor: c.main }]} />
                    <Text style={[s.sideText, active && { color: c.main }]} numberOfLines={1}>
                      {sd.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {tooMany ? <ErrorText>{`El total (${total}) supera el máximo de ${MAX_HAND_POINTS} puntos por mano.`}</ErrorText> : null}
            <View style={[s.summary, canConfirm && { borderColor: colors.lime }]}>
              <Text style={s.summaryText}>{side ? `Sumar ${total} puntos a ${side.name}` : `Total: ${total} puntos`}</Text>
            </View>
            <View style={s.row}>
              <Button label="Cancelar" variant="outline" onPress={leave} disabled={saving} style={s.flex} />
              <Button label="Confirmar" icon="checkmark" onPress={submit} disabled={!canConfirm} loading={saving} style={s.flex} />
            </View>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function SetupStep({
  set,
  onSet,
  loggedIn,
  visionConfigured,
  onCamera,
  onLibrary,
  onManual,
}: {
  set: TileSetId;
  onSet: (s: TileSetId) => void;
  loggedIn: boolean;
  visionConfigured: boolean | null;
  onCamera: () => void;
  onLibrary: () => void;
  onManual: () => void;
}) {
  const photoBlocked = !loggedIn || visionConfigured === false;
  return (
    <>
      <Card style={{ gap: space.md }}>
        <Text style={s.title}>Conjunto de fichas</Text>
        <View style={s.row}>
          {TILE_SETS.map((t) => (
            <Pill key={t.id} label={t.label} active={set === t.id} onPress={() => onSet(t.id)} />
          ))}
        </View>
      </Card>
      <Card style={{ gap: space.sm }}>
        <Text style={s.title}>Para una buena foto</Text>
        {GUIDE.map((g) => (
          <View key={g.text} style={s.guideRow}>
            <Ionicons name={g.icon} size={20} color={colors.lime} />
            <Text style={s.guideText}>{g.text}</Text>
          </View>
        ))}
      </Card>
      {!loggedIn ? (
        <Text style={s.note}>Para analizar fotos inicia sesión en el servidor (Configuración). Mientras tanto puedes contar a mano.</Text>
      ) : visionConfigured === false ? (
        <Text style={s.note}>El servidor no tiene configurado el servicio de visión. Puedes contar a mano.</Text>
      ) : null}
      {cameraAvailable ? <Button label="Tomar foto" icon="camera" size="lg" onPress={onCamera} disabled={photoBlocked} /> : null}
      <Button label="Elegir imagen" icon="images-outline" variant={cameraAvailable ? 'outline' : 'primary'} onPress={onLibrary} disabled={photoBlocked} />
      <Button label="Contar a mano" icon="create-outline" variant="ghost" onPress={onManual} />
      <Text style={s.privacy}>
        La foto se envía al servidor de la app y al servicio de visión de Anthropic solo para contarla. No se guarda en el teléfono ni en el
        servidor. Requiere internet.
      </Text>
    </>
  );
}

function ReviewStep({
  group,
  onChange,
  onConfirm,
  onDiscard,
}: {
  group: TileGroup;
  onChange: (g: TileGroup) => void;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const max = setMax(group.set);
  const problems = groupProblems(group);
  const problemIds = new Set(problems.map((p) => p.tileId));
  const [selected, setSelected] = useState<string | null>(null);

  const step = (tile: Tile, half: 'left' | 'right', delta: number) => {
    const currentValue = tile[half];
    const next = currentValue === null ? (delta > 0 ? 0 : max) : Math.min(max, Math.max(0, currentValue + delta));
    onChange(editTile(group, tile.id, { [half]: next }));
  };

  return (
    <>
      {group.photoUri ? (
        <View style={[s.photoWrap, { aspectRatio: group.photoAspect ?? 4 / 3 }]}>
          <Image source={{ uri: group.photoUri }} style={StyleSheet.absoluteFill} resizeMode="stretch" accessibilityLabel="Foto analizada" />
          {group.tiles.map((t, i) =>
            t.box ? (
              <Pressable
                key={t.id}
                onPress={() => setSelected(t.id)}
                accessibilityRole="button"
                accessibilityLabel={`Ficha ${i + 1}`}
                style={[
                  s.box,
                  {
                    left: `${t.box.x * 100}%`,
                    top: `${t.box.y * 100}%`,
                    width: `${t.box.w * 100}%`,
                    height: `${t.box.h * 100}%`,
                    borderColor: problemIds.has(t.id) ? colors.warning : colors.lime,
                  },
                  selected === t.id && { borderWidth: 4 },
                ]}
              >
                <Text style={[s.boxLabel, { backgroundColor: problemIds.has(t.id) ? colors.warning : colors.lime }]}>{i + 1}</Text>
              </Pressable>
            ) : null,
          )}
        </View>
      ) : null}

      {group.imageIssues.length ? (
        <Card accent={colors.warning} style={{ gap: 4 }}>
          {group.imageIssues.map((i) => (
            <Text key={i} style={s.warnText}>
              • {ISSUE_LABELS[i] ?? i}
            </Text>
          ))}
          <Text style={s.muted}>Si hay muchas dudas, toma otra foto siguiendo la guía.</Text>
        </Card>
      ) : null}

      <Card style={{ gap: space.sm }}>
        <View style={s.rowBetween}>
          <Text style={s.title}>Fichas ({TILE_SETS.find((x) => x.id === group.set)?.label.toLowerCase()})</Text>
          <Text style={s.groupTotal}>{groupTotal(group)}</Text>
        </View>
        {group.tiles.length === 0 ? <Text style={s.muted}>Sin fichas. Agrega las que falten.</Text> : null}
        {group.tiles.map((t, i) => {
          const problem = problems.find((p) => p.tileId === t.id)?.problem;
          return (
            <View key={t.id} style={[s.tileRow, selected === t.id && { backgroundColor: 'rgba(198,244,50,0.06)' }, problem && { borderColor: colors.warning }]}>
              <View style={s.rowBetween}>
                <Text style={s.tileName}>
                  Ficha {i + 1}
                  {t.source === 'manual' ? ' (a mano)' : ''}
                </Text>
                <Pressable onPress={() => onChange(removeTile(group, t.id))} accessibilityRole="button" accessibilityLabel={`Eliminar ficha ${i + 1}`} hitSlop={6}>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </Pressable>
              </View>
              <View style={s.halves}>
                <HalfStepper value={t.left} label={`Ficha ${i + 1}, mitad 1`} onMinus={() => step(t, 'left', -1)} onPlus={() => step(t, 'left', 1)} />
                <Text style={s.sep}>|</Text>
                <HalfStepper value={t.right} label={`Ficha ${i + 1}, mitad 2`} onMinus={() => step(t, 'right', -1)} onPlus={() => step(t, 'right', 1)} />
                <Text style={s.eq}>= {t.left === null || t.right === null ? '?' : tileValue(t)}</Text>
              </View>
              {problem ? (
                <View style={s.rowBetween}>
                  <Text style={[s.warnText, { flex: 1 }]}>Revisar: {problem}</Text>
                  {t.left !== null && t.right !== null ? (
                    <Button label="Está bien" size="sm" variant="outline" onPress={() => onChange(markReviewed(group, t.id))} />
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
        <Button label="Agregar ficha omitida" icon="add" variant="outline" size="sm" onPress={() => onChange(addManualTile(group, `${group.id}-m${Date.now()}`))} />
      </Card>

      {problems.length ? <Text style={s.note}>Quedan {problems.length} ficha(s) por revisar antes de confirmar el grupo.</Text> : null}
      <View style={s.row}>
        <Button label="Descartar" variant="outline" onPress={onDiscard} style={s.flex} />
        <Button label={`Confirmar grupo (${groupTotal(group)})`} icon="checkmark" onPress={onConfirm} disabled={problems.length > 0 || group.tiles.length === 0} style={s.flex} />
      </View>
    </>
  );
}

function HalfStepper({ value, label, onMinus, onPlus }: { value: number | null; label: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={s.stepper} accessibilityLabel={`${label}: ${value ?? 'sin valor'}`}>
      <Pressable onPress={onMinus} accessibilityRole="button" accessibilityLabel={`Restar a ${label}`} style={s.stepBtn}>
        <Ionicons name="remove" size={20} color={colors.text} />
      </Pressable>
      <Text style={[s.stepValue, value === null && { color: colors.warning }]}>{value ?? '?'}</Text>
      <Pressable onPress={onPlus} accessibilityRole="button" accessibilityLabel={`Sumar a ${label}`} style={s.stepBtn}>
        <Ionicons name="add" size={20} color={colors.text} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 21 },
  muted: { color: colors.textMuted, fontSize: 14 },
  note: { color: colors.warning, fontSize: 14, textAlign: 'center' },
  privacy: { color: colors.textDim, fontSize: 12, textAlign: 'center', lineHeight: 17 },
  row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  flex: { flexGrow: 1, flexBasis: 100 },
  guideRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  guideText: { color: colors.text, fontSize: 15, flex: 1 },
  photoWrap: { width: '100%', borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' },
  box: { position: 'absolute', borderWidth: 2, borderRadius: 4 },
  boxLabel: { position: 'absolute', top: -2, left: -2, minWidth: 20, textAlign: 'center', color: colors.onLime, fontWeight: '800', fontSize: 12, paddingHorizontal: 3, borderRadius: 4, overflow: 'hidden' },
  warnText: { color: colors.warning, fontSize: 13 },
  groupTotal: { color: colors.lime, fontFamily: fonts.display, fontSize: 34 },
  tileRow: { gap: 6, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.md, padding: space.sm },
  tileName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  halves: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  sep: { color: colors.textDim, fontSize: 22 },
  eq: { color: colors.text, fontFamily: fonts.display, fontSize: 24, marginLeft: 'auto' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  stepBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepValue: { color: colors.text, fontFamily: fonts.display, fontSize: 24, minWidth: 28, textAlign: 'center' },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  groupText: { color: colors.text, fontSize: 15, flex: 1 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  sides: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sideChip: {
    flexGrow: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  sideText: { color: colors.textMuted, fontSize: 17, fontWeight: '700', flexShrink: 1 },
  summary: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: space.md, alignItems: 'center' },
  summaryText: { color: colors.text, fontFamily: fonts.heading, fontSize: 22, textAlign: 'center' },
});
