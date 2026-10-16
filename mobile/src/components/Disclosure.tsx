import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, space } from '@/theme';
import type { IconName } from './ui';

/**
 * Botón que despliega un panel de opciones. Muestra a la derecha el valor elegido (por ejemplo
 * «200 puntos») para que se vea sin abrirlo.
 */
export function Disclosure({
  icon,
  title,
  value,
  children,
  initiallyOpen = false,
  accent = colors.lime,
}: {
  icon: IconName;
  title: string;
  value?: string;
  children: ReactNode;
  initiallyOpen?: boolean;
  accent?: string;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={[s.box, open && { borderColor: accent }]}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={value ? `${title}: ${value}` : title}
        style={({ pressed }) => [s.header, pressed && { opacity: 0.75 }]}
      >
        <View style={[s.icon, { backgroundColor: `${accent}22` }]}>
          <Ionicons name={icon} size={20} color={accent} />
        </View>
        <Text style={s.title}>{title}</Text>
        {value ? (
          <Text style={[s.value, { color: accent }]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
      </Pressable>
      {open ? <View style={s.body}>{children}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.md },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 20, flex: 1 },
  value: { fontFamily: fonts.heading, fontSize: 18, maxWidth: '45%' },
  body: { paddingHorizontal: space.md, paddingBottom: space.md, gap: space.md },
});
