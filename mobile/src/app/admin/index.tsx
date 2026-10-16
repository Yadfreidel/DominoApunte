import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AdminExport } from '@/components/admin/export';
import { AdminAppearance, AdminBranding } from '@/components/admin/identity';
import { AdminDuplicates, AdminPlayers } from '@/components/admin/players';
import { AdminAudit, AdminGames, AdminHome, AdminRanking, AdminRules, AdminTests, AdminUsers } from '@/components/admin/sections';
import { AdminTournaments } from '@/components/admin/tournaments';
import { AdminTrash } from '@/components/admin/trash';
import { AppHeader } from '@/components/AppHeader';
import { useDialogs } from '@/components/Dialogs';
import { Button, Screen, type IconName } from '@/components/ui';
import { ROLE_LABEL } from '@/services/api';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';

const SECTIONS = [
  { key: 'resumen', label: 'Resumen', icon: 'speedometer-outline', Component: AdminHome },
  { key: 'partidas', label: 'Partidas', icon: 'grid-outline', Component: AdminGames },
  { key: 'jugadores', label: 'Jugadores', icon: 'people-outline', Component: AdminPlayers },
  { key: 'duplicados', label: 'Duplicados', icon: 'git-merge-outline', Component: AdminDuplicates },
  { key: 'torneos', label: 'Torneos', icon: 'trophy-outline', Component: AdminTournaments },
  { key: 'reglas', label: 'Reglas', icon: 'options-outline', Component: AdminRules },
  { key: 'pruebas', label: 'Pruebas', icon: 'flask-outline', Component: AdminTests },
  { key: 'papelera', label: 'Papelera', icon: 'trash-outline', Component: AdminTrash },
  { key: 'auditoria', label: 'Auditoría', icon: 'document-text-outline', Component: AdminAudit },
  { key: 'exportar', label: 'Exportar', icon: 'download-outline', Component: AdminExport },
  { key: 'ranking', label: 'Ranking', icon: 'podium-outline', Component: AdminRanking },
  { key: 'identidad', label: 'Identidad visual', icon: 'image-outline', Component: AdminBranding },
  { key: 'apariencia', label: 'Apariencia', icon: 'color-palette-outline', Component: AdminAppearance },
  { key: 'cuentas', label: 'Cuentas', icon: 'key-outline', Component: AdminUsers },
] as const satisfies readonly { key: string; label: string; icon: IconName; Component: () => React.JSX.Element }[];

const WIDE_BREAKPOINT = 900;

export default function AdminPanel() {
  const { seccion } = useLocalSearchParams<{ seccion?: string }>();
  const { width } = useWindowDimensions();
  const { user, logout } = useStore();
  const { confirm, toast } = useDialogs();
  const wide = width >= WIDE_BREAKPOINT;
  const active = SECTIONS.find((sct) => sct.key === seccion) ?? SECTIONS[0];
  const Active = active.Component;

  const select = (key: string) => router.setParams({ seccion: key });

  const signOut = async () => {
    const ok = await confirm({ title: '¿Cerrar sesión?', message: 'Tendrás que volver a ingresar tu correo y contraseña para entrar al panel.', confirmLabel: 'Cerrar sesión' });
    if (!ok) return;
    await logout();
    toast('Sesión cerrada', 'info');
  };

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

  const account = (
    <View style={s.sideUser}>
      <Ionicons name="shield-checkmark" size={20} color={colors.purple} />
      <View style={{ flex: 1 }}>
        <Text style={s.sideUserText} numberOfLines={1}>
          {user?.email ?? user?.username}
        </Text>
        <Text style={s.sideRole}>{user ? ROLE_LABEL[user.role] : ''}</Text>
      </View>
      <Button label="Salir" icon="log-out-outline" size="sm" variant="ghost" onPress={signOut} />
    </View>
  );

  return (
    <Screen header={<AppHeader subtitle="Panel de administración" />} maxWidth={wide ? 1240 : 720}>
      {wide ? (
        <View style={s.wideLayout}>
          <View style={s.sidebar} accessibilityRole="tablist">
            {account}
            {nav}
          </View>
          <View style={s.main}>
            <Active />
          </View>
        </View>
      ) : (
        <>
          {account}
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
    width: 250,
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
  sideUserText: { color: colors.text, fontFamily: fonts.heading, fontSize: 17 },
  sideRole: { color: colors.textDim, fontSize: 12 },
  sideItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 46, paddingHorizontal: space.md, borderRadius: radius.md },
  sideItemActive: { backgroundColor: colors.limeSoft },
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
    backgroundColor: colors.field,
  },
  tabActive: { borderColor: colors.lime, backgroundColor: colors.limeSoft },
  tabLabel: { color: colors.textMuted, fontSize: 15, fontWeight: '700' },
});
