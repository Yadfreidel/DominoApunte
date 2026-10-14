import { Ionicons } from '@expo/vector-icons';
import { router, usePathname, type Href } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';
import { IconButton, type IconName } from './ui';

interface MenuItem {
  label: string;
  href: Href;
  icon: IconName;
  hint?: string;
  disabled?: boolean;
}

export function AppHeader({ subtitle, title = 'DOMINÓ' }: { subtitle?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const { currentGame, isAdmin, user } = useStore();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const items: MenuItem[] = [
    { label: 'Nueva partida', href: '/nueva', icon: 'add-circle-outline' },
    {
      label: 'Partida en curso',
      href: '/partida',
      icon: 'play-circle-outline',
      disabled: !currentGame,
      hint: currentGame ? undefined : 'No hay una partida abierta',
    },
    { label: 'Historial', href: '/historial', icon: 'time-outline' },
    { label: 'Estadísticas', href: '/estadisticas', icon: 'stats-chart-outline' },
    { label: 'Configuración', href: '/configuracion', icon: 'settings-outline' },
  ];
  if (isAdmin) items.push({ label: 'Administración', href: '/admin', icon: 'shield-checkmark-outline' });

  const go = (href: Href) => {
    setOpen(false);
    router.navigate(href);
  };

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <IconButton icon="menu" label="Abrir menú" onPress={() => setOpen(true)} size={30} />
        <Text style={s.title} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit>
          {title}
        </Text>
        <IconButton icon="settings-sharp" label="Configuración" onPress={() => router.navigate('/configuracion')} size={26} />
      </View>
      {subtitle ? (
        <View style={s.subtitleRow}>
          <View style={s.line} />
          <Text style={s.subtitle}>{subtitle}</Text>
          <View style={s.line} />
        </View>
      ) : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Cerrar menú">
          <View style={[s.menu, { marginTop: insets.top + 56 }]} accessibilityRole="menu">
            <Text style={s.menuTitle}>Menú</Text>
            {items.map((item) => {
              const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
              return (
                <Pressable
                  key={item.label}
                  disabled={item.disabled}
                  onPress={() => go(item.href)}
                  accessibilityRole="menuitem"
                  accessibilityState={{ disabled: item.disabled, selected: active }}
                  style={({ pressed }) => [
                    s.item,
                    active && s.itemActive,
                    pressed && { opacity: 0.7 },
                    item.disabled && { opacity: 0.45 },
                  ]}
                >
                  <Ionicons name={item.icon} size={24} color={active ? colors.lime : colors.text} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.itemLabel, active && { color: colors.lime }]}>{item.label}</Text>
                    {item.hint ? <Text style={s.itemHint}>{item.hint}</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                </Pressable>
              );
            })}
            {user ? (
              <View style={s.userRow}>
                <Ionicons name="person-circle-outline" size={18} color={colors.textDim} />
                <Text style={s.userText}>
                  {user.username} · {user.role === 'admin' ? 'Administrador' : 'Anotador'}
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingTop: space.sm, paddingBottom: space.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: {
    flex: 1,
    textAlign: 'center',
    color: '#F4F6FF',
    fontFamily: fonts.black,
    fontSize: 46,
    letterSpacing: 2,
    textShadowColor: 'rgba(140, 160, 255, 0.85)',
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 0 },
  },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: -2, paddingHorizontal: space.xl },
  line: { flex: 1, height: 1, backgroundColor: 'rgba(174, 182, 218, 0.35)' },
  subtitle: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, paddingHorizontal: space.lg },
  menu: {
    backgroundColor: colors.surfaceSolid,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: space.sm,
    width: '100%',
    maxWidth: 360,
    gap: 2,
  },
  menuTitle: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  itemActive: { backgroundColor: 'rgba(198, 244, 50, 0.1)' },
  itemLabel: { color: colors.text, fontSize: 18, fontWeight: '600' },
  itemHint: { color: colors.textDim, fontSize: 12 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    marginTop: space.sm,
    padding: space.md,
  },
  userText: { color: colors.textDim, fontSize: 13 },
});
