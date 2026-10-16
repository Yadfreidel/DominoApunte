import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { GameStatus } from '@/domain/game.ts';
import { colors, CONTENT_MAX_WIDTH, fonts, radius, space } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Luces del estadio en la parte superior del fondo. */
const LIGHTS = [
  { left: '6%', top: 70, size: 5 },
  { left: '13%', top: 92, size: 3 },
  { left: '21%', top: 64, size: 4 },
  { left: '78%', top: 66, size: 4 },
  { left: '86%', top: 90, size: 3 },
  { left: '93%', top: 72, size: 5 },
  { left: '30%', top: 110, size: 2 },
  { left: '70%', top: 112, size: 2 },
] as const;

export function StadiumBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={[colors.bgTop, colors.bgMid, colors.bg, colors.bg]}
        locations={[0, 0.28, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* Haz de luz del estadio: se desvanece hacia los lados y hacia abajo. */}
      <View style={styles.beam}>
        <LinearGradient
          colors={[colors.glowClear, colors.glow, colors.glowClear]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={[colors.bgClear, colors.bgMid]}
          locations={[0.35, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
      {LIGHTS.map((l, i) => (
        <View
          key={i}
          style={[
            styles.light,
            { left: l.left, top: l.top, width: l.size, height: l.size, borderRadius: l.size, shadowRadius: l.size * 3 },
          ]}
        />
      ))}
    </View>
  );
}

export function Screen({
  children,
  scroll = true,
  maxWidth = CONTENT_MAX_WIDTH,
  header,
}: {
  children: ReactNode;
  scroll?: boolean;
  maxWidth?: number;
  header?: ReactNode;
}) {
  const content = <View style={[styles.content, { maxWidth }]}>{children}</View>;
  return (
    <View style={styles.root}>
      <StadiumBackground />
      <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
        <View style={[styles.headerWrap, { maxWidth }]}>{header}</View>
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {content}
          </ScrollView>
        ) : (
          <View style={[styles.flex, styles.scrollContent]}>{content}</View>
        )}
      </SafeAreaView>
    </View>
  );
}

export function Card({
  children,
  style,
  accent,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accent?: string;
}) {
  return <View style={[styles.card, accent ? { borderColor: accent } : null, style]}>{children}</View>;
}

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'purple';

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  loading,
  size = 'md',
  style,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const palette = {
    primary: { bg: colors.button, fg: colors.onButton, border: colors.button },
    purple: { bg: colors.purpleDeep, fg: colors.text, border: colors.purple },
    outline: { bg: colors.outlineBg, fg: colors.text, border: colors.borderStrong },
    ghost: { bg: 'transparent', fg: colors.textMuted, border: 'transparent' },
    danger: { bg: colors.dangerBg, fg: colors.danger, border: colors.danger },
  }[variant];
  const height = { sm: 40, md: 52, lg: 62 }[size];
  const fontSize = { sm: 17, md: 20, lg: 25 }[size];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: height,
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: inactive ? 0.5 : pressed ? 0.82 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        variant === 'primary' && styles.primaryGlow,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={fontSize + 3} color={palette.fg} /> : null}
          <Text style={[styles.buttonLabel, { color: palette.fg, fontSize }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  color = colors.text,
  size = 26,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  color?: string;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Field({
  label,
  error,
  style,
  ...props
}: TextInputProps & { label?: string; error?: string | null }) {
  return (
    <View style={styles.field}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        placeholderTextColor={colors.textDim}
        selectionColor={colors.lime}
        style={[styles.input, error ? { borderColor: colors.danger } : null, style]}
        // La etiqueta visible también nombra el campo para lectores de pantalla.
        accessibilityLabel={label}
        {...props}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.error} accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}

export function Pill({
  label,
  active,
  onPress,
  color = colors.lime,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => [
        styles.pill,
        active && { borderColor: color, backgroundColor: `${color}22` },
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.pillLabel, active && { color }]}>{label}</Text>
    </Pressable>
  );
}

export interface SelectOption<T> {
  value: T;
  label: string;
  disabled?: boolean;
  hint?: string;
}

/** Menú desplegable accesible que funciona igual en móvil y web. */
export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={styles.field}>
      {label ? <Label>{label}</Label> : null}
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? 'Seleccionar'}: ${current?.label ?? ''}`}
        style={({ pressed }) => [styles.input, styles.selectBox, pressed && { opacity: 0.8 }]}
      >
        <Text style={styles.selectText}>{current?.label ?? 'Seleccionar'}</Text>
        <Ionicons name="chevron-down" size={22} color={colors.lime} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.selectSheet}>
            {label ? <Text style={styles.selectSheetTitle}>{label}</Text> : null}
            {options.map((o) => {
              const selected = o.value === value;
              return (
                <Pressable
                  key={String(o.value)}
                  disabled={o.disabled}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected, disabled: o.disabled }}
                  style={({ pressed }) => [
                    styles.selectOption,
                    selected && styles.selectOptionActive,
                    pressed && { opacity: 0.7 },
                    o.disabled && { opacity: 0.4 },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.selectOptionText, selected && { color: colors.lime }]}>{o.label}</Text>
                    {o.hint ? <Text style={styles.hint}>{o.hint}</Text> : null}
                  </View>
                  {selected ? <Ionicons name="checkmark-circle" size={22} color={colors.lime} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: IconName;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <Card style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={34} color={colors.lime} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {action}
    </Card>
  );
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.lime} />
      <Text style={styles.hint}>{label}</Text>
    </View>
  );
}

const STATUS_STYLE: Record<GameStatus, { label: string; color: string; icon: IconName }> = {
  pendiente: { label: 'Pendiente', color: colors.warning, icon: 'time-outline' },
  terminada: { label: 'Terminada', color: colors.success, icon: 'trophy-outline' },
  cancelada: { label: 'Cancelada', color: colors.danger, icon: 'close-circle-outline' },
};

export function StatusBadge({ status }: { status: GameStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <View style={[styles.badge, { borderColor: s.color, backgroundColor: `${s.color}1F` }]}>
      <Ionicons name={s.icon} size={13} color={s.color} />
      <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

export function Stat({ label, value, color = colors.text }: { label: string; value: string | number; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  beam: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },
  light: {
    position: 'absolute',
    backgroundColor: colors.light,
    shadowColor: colors.lightGlow,
    shadowOpacity: 1,
    shadowOffset: { width: 0, height: 0 },
    opacity: 0.85,
  },
  headerWrap: { width: '100%', alignSelf: 'center', paddingHorizontal: space.lg },
  scrollContent: { paddingHorizontal: space.lg, paddingBottom: 40, flexGrow: 1 },
  content: { width: '100%', alignSelf: 'center', gap: space.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: space.lg,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    paddingHorizontal: space.lg,
  },
  primaryGlow: {
    shadowColor: colors.lime,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  buttonLabel: { fontFamily: fonts.heading, letterSpacing: 0.3 },
  iconButton: { padding: 6, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
  sectionTitle: { color: colors.text, fontFamily: fonts.heading, fontSize: 22 },
  label: { color: colors.textMuted, fontSize: 14, fontWeight: '600', marginBottom: 6 },
  field: { gap: 0 },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.fieldStrong,
    color: colors.text,
    fontSize: 18,
    paddingHorizontal: space.lg,
  },
  error: { color: colors.danger, fontSize: 14, marginTop: 6, fontWeight: '600' },
  pill: {
    minHeight: 46,
    minWidth: 64,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabel: { color: colors.textMuted, fontFamily: fonts.heading, fontSize: 19 },
  selectBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectText: { color: colors.text, fontSize: 18, fontWeight: '600' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: space.xl,
  },
  selectSheet: {
    backgroundColor: colors.surfaceSolid,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: 6,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  selectSheetTitle: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  selectOption: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    gap: space.md,
  },
  selectOptionActive: { backgroundColor: colors.limeSoft },
  selectOptionText: { color: colors.text, fontSize: 18, fontWeight: '600' },
  hint: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.limeSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  emptyTitle: { color: colors.text, fontFamily: fonts.heading, fontSize: 22, textAlign: 'center' },
  emptyMessage: { color: colors.textMuted, fontSize: 15, textAlign: 'center', marginBottom: space.sm, lineHeight: 21 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  stat: { flex: 1, alignItems: 'center', minWidth: 70 },
  statValue: { fontFamily: fonts.display, fontSize: 32 },
  statLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
