import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  AdminCorrections,
  AdminGames,
  AdminHome,
  AdminPlayers,
  AdminRanking,
  AdminSettings,
  AdminUsers,
} from '@/components/admin/sections';
import { AppHeader } from '@/components/AppHeader';
import { Screen, type IconName } from '@/components/ui';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';

const SECTIONS = [
  { key: 'inicio', label: 'Inicio', icon: 'speedometer-outline', Component: AdminHome },
  { key: 'jugadores', label: 'Jugadores', icon: 'people-outline', Component: AdminPlayers },
  { key: 'partidas', label: 'Partidas', icon: 'grid-outline', Component: AdminGames },
  { key: 'ranking', label: 'Ranking', icon: 'podium-outline', Component: AdminRanking },
  { key: 'correcciones', label: 'Correcciones', icon: 'document-text-outline', Component: AdminCorrections },
  { key: 'configuracion', label: 'Configuración', icon: 'options-outline', Component: AdminSettings },
  { key: 'usuarios', label: 'Usuarios', icon: 'key-outline', Component: AdminUsers },
] as const satisfies readonly { key: string; label: string; icon: IconName; Component: () => React.JSX.Element }[];

const WIDE_BREAKPOINT = 900;

export default function AdminPanel() {
  const { seccion } = useLocalSearchParams<{ seccion?: string }>();
  const { width } = useWindowDimensions();
  const { user } = useStore();
  const wide = width >= WIDE_BREAKPOINT;
  const active = SECTIONS.find((sct) => sct.key === seccion) ?? SECTIONS[0];
  const Active = active.Component;

  const select = (key: string) => router.setParams({ seccion: key });

  const nav = SECTIONS.map((sct) => {
    const selected = sct.key === active.key;
    return (
      <Pressable
        key={sct.key}
        onPress={() => select(sct.key)}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        style={({ pressed }) => [wide ? s.sideItem : s.tab, selected && (wide ? s.sideItemActive : s.tabActive), pressed && { opacity: 0.75 }]}
      >
        <Ionicons name={sct.icon} size={wide ? 22 : 18} color={selected ? colors.lime : colors.textMuted} />
        <Text style={[wide ? s.sideLabel : s.tabLabel, selected && { color: colors.lime }]}>{sct.label}</Text>
      </Pressable>
    );
  });

  return (
    <Screen header={<AppHeader subtitle="Panel de administración" />} maxWidth={wide ? 1240 : 720}>
      {wide ? (
        <View style={s.wideLayout}>
          <View style={s.sidebar} accessibilityRole="tablist">
            <View style={s.sideUser}>
              <Ionicons name="shield-checkmark" size={20} color={colors.purple} />
              <Text style={s.sideUserText} numberOfLines={1}>
                {user?.username}
              </Text>
            </View>
            {nav}
          </View>
          <View style={s.main}>
            <Active />
          </View>
        </View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs} accessibilityRole="tablist">
            {nav}
          </ScrollView>
          <Active />
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  wideLayout: { flexDirection: 'row', gap: space.xl, alignItems: 'flex-start' },
  sidebar: {
    width: 240,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.xl,
    padding: space.sm,
    gap: 2,
  },
  sideUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    marginBottom: space.sm,
  },
  sideUserText: { color: colors.text, fontFamily: fonts.heading, fontSize: 18, flex: 1 },
  sideItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingHorizontal: space.md, borderRadius: radius.md },
  sideItemActive: { backgroundColor: 'rgba(198, 244, 50, 0.1)' },
  sideLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  main: { flex: 1, minWidth: 0 },
  tabs: { gap: space.sm, paddingBottom: space.sm },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: 'rgba(8, 14, 48, 0.7)',
  },
  tabActive: { borderColor: colors.lime, backgroundColor: 'rgba(198, 244, 50, 0.1)' },
  tabLabel: { color: colors.textMuted, fontSize: 15, fontWeight: '700' },
});
