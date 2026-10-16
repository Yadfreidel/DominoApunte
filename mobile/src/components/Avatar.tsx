import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Fragment, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { cameraAvailable, pickPhoto, type PhotoSource } from '@/services/photos';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, sideColor, space } from '@/theme';
import { useDialogs } from './Dialogs';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('es');
  return (parts[0][0] + parts[parts.length - 1][0]).toLocaleUpperCase('es');
}

/** Foto del jugador en círculo con el color de su lado; si no tiene foto, muestra sus iniciales. */
export function Avatar({ name, colorIndex, size = 48, photo }: { name: string; colorIndex: number; size?: number; photo?: string }) {
  const c = sideColor(colorIndex);
  const ring = Math.max(2, Math.round(size / 22));
  return (
    <View
      style={[s.avatar, { width: size, height: size, borderRadius: size / 2, borderWidth: ring, borderColor: c.main, shadowColor: c.main }]}
      accessibilityLabel={photo ? `Foto de ${name}` : name}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={{ width: '100%', height: '100%', borderRadius: size / 2 }} />
      ) : (
        <LinearGradient colors={[c.soft.replace(/[\d.]+\)$/, '0.45)'), colors.avatarBase]} style={[StyleSheet.absoluteFill, s.center]}>
          {name.trim() ? (
            <Text style={[s.initials, { fontSize: size * 0.4, color: c.main }]}>{initials(name)}</Text>
          ) : (
            <Ionicons name="person" size={size * 0.45} color={c.main} />
          )}
        </LinearGradient>
      )}
    </View>
  );
}

/** Avatares de un lado: uno para individual, dos superpuestos para una pareja. */
export function SideAvatars({ names, colorIndex, size = 48 }: { names: string[]; colorIndex: number; size?: number }) {
  const { photoOf } = useStore();
  const shown = names.length ? names : [''];
  return (
    <View style={s.row}>
      {shown.map((n, i) => (
        <View key={`${n}-${i}`} style={i > 0 ? { marginLeft: -size * 0.3 } : null}>
          <Avatar name={n} colorIndex={colorIndex} size={size} photo={n ? photoOf(n) : undefined} />
        </View>
      ))}
    </View>
  );
}

/**
 * Avatar que se toca para tomar o elegir una foto del jugador. La foto queda guardada en el
 * dispositivo con el nombre del jugador y aparece en todas sus partidas.
 */
export function PlayerPhotoButton({ name, colorIndex, size = 56 }: { name: string; colorIndex: number; size?: number }) {
  const { photoOf, setPhoto } = useStore();
  const { toast } = useDialogs();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const clean = name.trim();
  const photo = clean ? photoOf(clean) : undefined;

  const choose = async (source: PhotoSource) => {
    setOpen(false);
    setBusy(true);
    try {
      const uri = await pickPhoto(source);
      if (uri) {
        await setPhoto(clean, uri);
        toast(`Foto de ${clean} guardada`);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo cargar la foto.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setOpen(false);
    await setPhoto(clean, null);
    toast(`Foto de ${clean} quitada`, 'info');
  };

  return (
    <>
      <Pressable
        onPress={() => (clean ? setOpen(true) : toast('Escribe primero el nombre del jugador.', 'info'))}
        accessibilityRole="button"
        accessibilityLabel={photo ? `Cambiar foto de ${clean}` : `Poner foto${clean ? ` a ${clean}` : ''}`}
        style={({ pressed }) => [pressed && { opacity: 0.75 }]}
      >
        <Avatar name={clean} colorIndex={colorIndex} size={size} photo={photo} />
        <View style={[s.badge, { backgroundColor: sideColor(colorIndex).main }]}>
          {busy ? <ActivityIndicator size="small" color={colors.onLime} /> : <Ionicons name="camera" size={14} color={colors.onLime} />}
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <View style={s.sheet}>
            <View style={s.sheetHeader}>
              <Avatar name={clean} colorIndex={colorIndex} size={72} photo={photo} />
              <Text style={s.sheetTitle}>{clean}</Text>
            </View>
            {cameraAvailable ? <SheetOption icon="camera-outline" label="Tomar foto" onPress={() => choose('camera')} /> : null}
            <SheetOption icon="images-outline" label="Elegir de la galería" onPress={() => choose('library')} />
            {photo ? <SheetOption icon="trash-outline" label="Quitar foto" danger onPress={remove} /> : null}
            <SheetOption icon="close" label="Cancelar" onPress={() => setOpen(false)} />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function SheetOption({ icon, label, onPress, danger }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [s.option, pressed && { backgroundColor: colors.pressed }]}
    >
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.text} />
      <Text style={[s.optionText, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

export interface VersusSide {
  name: string;
  members: string[];
}

/** Presentación "cara a cara" de quienes se enfrentan, con sus fotos o iniciales. */
export function VersusBanner({ sides, size = 64 }: { sides: VersusSide[]; size?: number }) {
  const many = sides.length > 2;
  const avatarSize = many ? Math.round(size * 0.75) : size;
  return (
    <View style={s.versus} accessible accessibilityLabel={`Se enfrentan: ${sides.map((sd) => sd.name || 'sin nombre').join(' contra ')}`}>
      {sides.map((sd, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <View style={s.vsBadge}>
              <Text style={s.vsText}>VS</Text>
            </View>
          ) : null}
          <View style={[s.versusSide, many && { maxWidth: '22%' }]}>
            <SideAvatars names={sd.members} colorIndex={i} size={avatarSize} />
            <Text style={[s.versusName, { color: sideColor(i).main }]} numberOfLines={2}>
              {sd.name || `Jugador ${i + 1}`}
            </Text>
          </View>
        </Fragment>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  avatar: {
    overflow: 'hidden',
    backgroundColor: colors.surfaceSolid,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: fonts.display },
  row: { flexDirection: 'row', alignItems: 'center' },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: space.xl },
  sheet: {
    backgroundColor: colors.surfaceSolid,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    gap: 2,
  },
  sheetHeader: { alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  sheetTitle: { color: colors.text, fontFamily: fonts.heading, fontSize: 22 },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.md, borderRadius: radius.md },
  optionText: { color: colors.text, fontSize: 17, fontWeight: '600' },
  versus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  versusSide: { flex: 1, alignItems: 'center', gap: space.sm, minWidth: 0 },
  versusName: { fontFamily: fonts.heading, fontSize: 18, textAlign: 'center' },
  vsBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.pressed,
    borderWidth: 1,
    borderColor: colors.border,
  },
  vsText: { color: colors.text, fontFamily: fonts.black, fontSize: 16, letterSpacing: 1 },
});
