import { Ionicons } from '@expo/vector-icons';
import { usePathname, type Href } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROLE_LABEL } from '@/services/api';
import { cameraAvailable, pickPhoto, type PhotoSource } from '@/services/photos';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';
import { Avatar } from './Avatar';
import { useDialogs } from './Dialogs';
import { Button, IconButton, type IconName } from './ui';
import { useGoTo } from '@/navigation';

interface MenuItem {
  label: string;
  href: Href;
  icon: IconName;
  hint?: string;
  disabled?: boolean;
}

export function AppHeader({ subtitle, title }: { subtitle?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const { currentGame, user, branding, isAdmin, setMyPhoto } = useStore();
  const { toast } = useDialogs();
  const [photoOptions, setPhotoOptions] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const heading = title ?? branding.appName.toLocaleUpperCase('es');
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const goTo = useGoTo();

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
    { label: 'Torneos', href: '/torneos', icon: 'trophy-outline' },
    { label: 'Grupos', href: '/grupos', icon: 'people-circle-outline' },
    { label: 'Estadísticas', href: '/estadisticas', icon: 'stats-chart-outline' },
    { label: 'Rivales', href: '/rivales', icon: 'git-compare-outline' },
    { label: 'Configuración', href: '/configuracion', icon: 'settings-outline' },
  ];
  // El panel de administración no aparece en este menú: se entra directamente en /admin.

  const go = (href: Href) => {
    setOpen(false);
    setPhotoOptions(false);
    goTo(href);
  };

  const changePhoto = async (source: PhotoSource | null) => {
    setPhotoOptions(false);
    setPhotoBusy(true);
    try {
      if (source === null) {
        await setMyPhoto(null);
        toast('Foto quitada', 'info');
      } else {
        const uri = await pickPhoto(source);
        if (!uri) return;
        await setMyPhoto(uri);
        toast('Foto de perfil actualizada');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo guardar la foto.', 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <IconButton icon="menu" label="Abrir menú" onPress={() => setOpen(true)} size={30} />
        <View style={s.brand}>
          {branding.logo ? <Image source={{ uri: branding.logo }} style={s.logo} accessibilityLabel={`Logo de ${branding.appName}`} /> : null}
          <Text style={s.title} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit>
            {heading}
          </Text>
        </View>
        <IconButton icon="settings-sharp" label="Configuración" onPress={() => goTo('/configuracion')} size={26} />
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
            <Text style={s.menuTitle}>{branding.tagline ? `${branding.appName} · ${branding.tagline}` : 'Menú'}</Text>
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
              <View style={s.profile}>
                <View style={s.userRow}>
                  <Pressable
                    onPress={() => setPhotoOptions((v) => !v)}
                    disabled={photoBusy}
                    accessibilityRole="button"
                    accessibilityLabel={user.photo ? 'Cambiar mi foto de perfil' : 'Poner mi foto de perfil'}
                    style={({ pressed }) => [pressed && { opacity: 0.75 }]}
                  >
                    <Avatar name={user.username} colorIndex={1} size={48} photo={user.photo ?? undefined} />
                    <View style={s.cameraBadge}>
                      {photoBusy ? <ActivityIndicator size="small" color={colors.onLime} /> : <Ionicons name="camera" size={12} color={colors.onLime} />}
                    </View>
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={s.userName} numberOfLines={1}>
                      {user.username}
                    </Text>
                    <Text style={s.userText}>{ROLE_LABEL[user.role]}</Text>
                  </View>
                </View>
                {photoOptions ? (
                  <View style={s.photoOptions}>
                    {cameraAvailable ? (
                      <Button label="Tomar foto" icon="camera-outline" size="sm" variant="outline" onPress={() => changePhoto('camera')} style={s.photoButton} />
                    ) : null}
                    <Button label="Galería" icon="images-outline" size="sm" variant="outline" onPress={() => changePhoto('library')} style={s.photoButton} />
                    {user.photo ? (
                      <Button label="Quitar" icon="trash-outline" size="sm" variant="ghost" onPress={() => changePhoto(null)} style={s.photoButton} />
                    ) : null}
                  </View>
                ) : null}
                {isAdmin ? (
                  <Button label="Panel de administración" icon="shield-checkmark-outline" variant="purple" size="sm" onPress={() => go('/admin')} />
                ) : null}
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
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minWidth: 0 },
  logo: { width: 40, height: 40, borderRadius: 10 },
  title: {
    flexShrink: 1,
    textAlign: 'center',
    color: colors.title,
    fontFamily: fonts.black,
    fontSize: 46,
    letterSpacing: 2,
    textShadowColor: colors.titleGlow,
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 0 },
  },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: -2, paddingHorizontal: space.xl },
  line: { flex: 1, height: 1, backgroundColor: colors.divider },
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
  itemActive: { backgroundColor: colors.limeSoft },
  itemLabel: { color: colors.text, fontSize: 18, fontWeight: '600' },
  itemHint: { color: colors.textDim, fontSize: 12 },
  profile: {
    gap: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    marginTop: space.sm,
    padding: space.md,
  },
  userName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lime,
    borderWidth: 2,
    borderColor: colors.surfaceSolid,
  },
  photoOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  photoButton: { flexGrow: 1 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  userText: { color: colors.textDim, fontSize: 13 },
});
