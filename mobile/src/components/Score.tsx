import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { runningTotals, type Game } from '@/domain/game.ts';
import { colors, fonts, radius, sideColor, space } from '@/theme';
import { SideAvatars } from './Avatar';

export function ScoreCard({
  name,
  detail,
  members,
  total,
  target,
  index,
  team,
  leading,
  winner,
  compact,
  onAdd,
}: {
  name: string;
  detail?: string;
  /** Jugadores del lado: se muestran sus fotos o iniciales. */
  members?: string[];
  total: number;
  target: number;
  index: number;
  team: boolean;
  leading?: boolean;
  winner?: boolean;
  compact?: boolean;
  onAdd?: () => void;
}) {
  const c = sideColor(index);
  const progress = Math.min(1, target > 0 ? total / target : 0);
  const highlighted = leading || winner;
  // El número se reduce según la cantidad de cifras para que nunca se corte.
  const digits = String(total).length;
  const fontSize = (compact ? [68, 68, 60, 46] : [120, 120, 88, 66])[Math.min(digits, 4) - 1];
  const content = (
    <>
      <LinearGradient colors={[c.soft, 'rgba(10,16,52,0.2)']} style={StyleSheet.absoluteFill} />
      {members?.length ? (
        <View style={s.avatars}>
          <SideAvatars names={members} colorIndex={index} size={compact ? 40 : 52} />
          {winner ? (
            <View style={s.trophy}>
              <Ionicons name="trophy" size={14} color={colors.onLime} />
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={s.nameRow}>
        {members?.length ? null : (
          <Ionicons name={winner ? 'trophy' : team ? 'people' : 'person'} size={compact ? 18 : 22} color={c.main} />
        )}
        <Text style={[s.name, compact && { fontSize: 18 }]} numberOfLines={1}>
          {name}
        </Text>
      </View>
      {detail ? (
        <Text style={s.detail} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
      <Text
        style={[s.total, { fontSize, lineHeight: fontSize + 8, color: c.main, textShadowColor: c.main }]}
        numberOfLines={1}
      >
        {total}
      </Text>
      {onAdd ? (
        <View style={[s.plus, compact && s.plusCompact, { borderColor: c.main, backgroundColor: c.soft }]}>
          <Ionicons name="add" size={compact ? 20 : 26} color={c.main} />
        </View>
      ) : null}
      <View style={[s.track, { backgroundColor: c.track }]}>
        <View style={[s.fill, { width: `${progress * 100}%`, backgroundColor: c.main }]} />
      </View>
      <Text style={s.progressText}>
        {total} / {target}
      </Text>
    </>
  );
  const cardStyle = [
    s.card,
    !compact && s.cardTall,
    { borderColor: highlighted ? c.main : `${c.main}66` },
    highlighted && { shadowColor: c.main, shadowOpacity: 0.65, shadowRadius: 18, elevation: 10 },
  ];
  const label = `${name}: ${total} de ${target} puntos${winner ? ', ganador' : ''}`;

  // Toda la tarjeta es el botón: al tocarla se abre el teclado de puntos de ese lado.
  if (onAdd) {
    return (
      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel={`${label}. Toca para anotar puntos a ${name}`}
        style={({ pressed }) => [...cardStyle, pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 }]}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View style={cardStyle} accessible accessibilityLabel={label}>
      {content}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    borderWidth: 2,
    borderRadius: radius.lg,
    padding: space.md,
    paddingTop: space.lg,
    overflow: 'hidden',
    backgroundColor: 'rgba(10, 16, 52, 0.85)',
    shadowOffset: { width: 0, height: 0 },
    alignItems: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
  avatars: { marginBottom: space.sm },
  trophy: {
    position: 'absolute',
    right: -6,
    top: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: colors.text, fontSize: 21, fontWeight: '700', flexShrink: 1 },
  detail: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  cardTall: { paddingVertical: space.xl },
  total: {
    fontFamily: fonts.display,
    fontSize: 120,
    lineHeight: 128,
    textShadowRadius: 18,
    textShadowOffset: { width: 0, height: 0 },
    marginVertical: 2,
  },
  plus: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusCompact: { width: 30, height: 30, borderRadius: 15, top: 8, right: 8 },
  track: { height: 10, borderRadius: 5, alignSelf: 'stretch', overflow: 'hidden', marginTop: 4 },
  fill: { height: '100%', borderRadius: 5 },
  progressText: { color: colors.textMuted, fontSize: 14, marginTop: 6, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: 4 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  dot: { width: 10, height: 10, borderRadius: 5 },
  handNo: { color: colors.textMuted, fontSize: 15, width: 64 },
  handSide: { fontSize: 15, fontWeight: '700', flex: 1 },
  edited: { color: colors.textDim, fontSize: 12, fontWeight: '400' },
  running: { fontSize: 16, fontWeight: '700', color: colors.text },
  sep: { color: colors.textDim },
  emptyHands: { color: colors.textDim, fontSize: 15, textAlign: 'center', paddingVertical: space.lg },
});

/**
 * Historial de manos en forma de planilla: una columna por jugador o equipo, una fila por mano
 * (puntos del que anotó y 0 para los demás), ✕ para borrar la mano y totales grandes al final.
 * Tocar los números de una fila abre la corrección de esa mano.
 */
export function HandLedger({
  game,
  onEdit,
  onDelete,
}: {
  game: Game;
  onEdit?: (handId: string) => void;
  onDelete?: (handId: string) => void;
}) {
  const totals = runningTotals(game).at(-1) ?? Object.fromEntries(game.sides.map((sd) => [sd.id, 0]));
  const many = game.sides.length > 2;
  return (
    <View style={l.sheet}>
      {game.hands.length === 0 ? (
        <Text style={l.empty}>Aún no hay manos registradas.</Text>
      ) : (
        game.hands.map((h, i) => {
          const row = (
            <>
              <Text style={l.num}>{i + 1}</Text>
              {game.sides.map((sd, si) => {
                const scored = h.sideId === sd.id;
                return (
                  <Text
                    key={sd.id}
                    style={[l.cell, many && { fontSize: 20 }, scored ? { color: sideColor(si).main } : l.zero]}
                  >
                    {scored ? h.points : 0}
                  </Text>
                );
              })}
            </>
          );
          const scorer = game.sides.find((sd) => sd.id === h.sideId);
          return (
            <View key={h.id} style={l.row}>
              {onEdit ? (
                <Pressable
                  onPress={() => onEdit(h.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Editar mano ${i + 1}: ${scorer?.name} ${h.points} puntos`}
                  style={({ pressed }) => [l.rowMain, pressed && { backgroundColor: 'rgba(255,255,255,0.05)' }]}
                >
                  {row}
                </Pressable>
              ) : (
                <View style={l.rowMain}>{row}</View>
              )}
              {onDelete ? (
                <Pressable
                  onPress={() => onDelete(h.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Borrar mano ${i + 1}`}
                  hitSlop={6}
                  style={({ pressed }) => [l.delCol, pressed && { opacity: 0.5 }]}
                >
                  <Ionicons name="close" size={24} color={colors.danger} />
                </Pressable>
              ) : null}
            </View>
          );
        })
      )}

      <View style={l.footer}>
        <View style={l.numCol} />
        {game.sides.map((sd, i) => (
          <View key={sd.id} style={l.totalCell}>
            <Text style={[l.total, many && { fontSize: 30 }, { color: sideColor(i).main }]}>{totals[sd.id] ?? 0}</Text>
            <Text style={l.target}>/{game.target}</Text>
          </View>
        ))}
        {onDelete ? <View style={l.delCol} /> : null}
      </View>
    </View>
  );
}

const LINE = 'rgba(96, 124, 255, 0.38)';

const l = StyleSheet.create({
  sheet: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: 'rgba(8, 13, 44, 0.92)',
    paddingHorizontal: space.sm,
    overflow: 'hidden',
  },
  numCol: { width: 26 },
  delCol: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: LINE },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 40, gap: 6 },
  num: { width: 26, color: colors.textDim, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  cell: { flex: 1, textAlign: 'center', fontFamily: fonts.display, fontSize: 24 },
  zero: { color: 'rgba(174, 182, 218, 0.45)' },
  empty: { color: colors.textDim, fontSize: 15, textAlign: 'center', paddingVertical: space.lg, borderBottomWidth: 1, borderBottomColor: LINE },
  footer: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingVertical: space.md },
  totalCell: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' },
  total: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44 },
  target: { color: colors.textMuted, fontSize: 14, fontWeight: '700', marginLeft: 2 },
});
