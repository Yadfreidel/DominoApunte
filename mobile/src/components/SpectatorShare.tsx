// Ventana para abrir el marcador en una pantalla grande (TV con navegador, monitor o tableta).
// Crea un enlace de espectador de solo lectura para esta partida (revocable) y lo muestra con un QR.
import { Ionicons } from '@expo/vector-icons';
import createQr from 'qrcode-generator';
import { useState } from 'react';
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Game } from '@/domain/game.ts';
import { appBaseUrl, shareOrCopy } from '@/services/links';
import { useGoTo } from '@/navigation';
import { useStore } from '@/state/AppStore';
import { colors, fonts, radius, space } from '@/theme';
import { useDialogs } from './Dialogs';
import { Button, ErrorText } from './ui';

function qrDataUrl(text: string): string {
  const qr = createQr(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(8, 2);
}

export function SpectatorShare({ game, onClose }: { game: Game; onClose: () => void }) {
  const store = useStore();
  const goTo = useGoTo();
  const insets = useSafeAreaInsets();
  const { confirm, toast } = useDialogs();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !!store.user && !!store.settings.apiUrl;

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // La pantalla grande lee el marcador del servidor: primero se sincroniza la partida.
      await store.syncNow();
      const r = await store.api<{ token: string }>(`/games/${game.id}/spectator`, { method: 'POST' });
      setLink(`${appBaseUrl()}/pantalla/${r.token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el enlace.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    const ok = await confirm({ title: '¿Desactivar la pantalla grande?', message: 'Los enlaces de esta partida dejarán de funcionar.', confirmLabel: 'Desactivar', destructive: true });
    if (!ok) return;
    try {
      await store.api(`/games/${game.id}/spectator`, { method: 'DELETE' });
      setLink(null);
      toast('Enlaces desactivados', 'info');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo desactivar.', 'error');
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Cerrar" />
        <View style={[s.sheet, { paddingBottom: insets.bottom + space.lg }]} accessibilityViewIsModal>
          <View style={s.header}>
            <Text style={s.title}>Pantalla grande</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={10}>
              <Ionicons name="close" size={28} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: space.md }}>
            <Text style={s.text}>
              Muestra este marcador en una TV con navegador, un monitor o una tableta. Se actualiza solo cada pocos segundos y no permite anotar
              ni ver datos del grupo. No es una transmisión por Chromecast ni AirPlay.
            </Text>
            {!ready ? (
              <>
                <Text style={s.warn}>Necesitas iniciar sesión en Configuración: la pantalla grande lee la partida desde el servidor.</Text>
                <Button
                  label="Ir a Configuración"
                  icon="log-in-outline"
                  variant="outline"
                  onPress={() => {
                    onClose();
                    goTo('/configuracion');
                  }}
                />
              </>
            ) : link ? (
              <View style={s.linkBox}>
                <Image source={{ uri: qrDataUrl(link) }} style={s.qr} accessibilityLabel="Código QR del enlace" />
                <Text style={s.link} selectable numberOfLines={3}>
                  {link}
                </Text>
                <View style={s.row}>
                  <Button
                    label="Compartir o copiar"
                    icon="share-social-outline"
                    size="sm"
                    onPress={async () => {
                      const r = await shareOrCopy('Marcador en pantalla grande', link);
                      if (r === 'copiado') toast('Enlace copiado');
                    }}
                    style={{ flex: 1 }}
                  />
                  {Platform.OS === 'web' ? (
                    <Button label="Abrir" icon="open-outline" size="sm" variant="outline" onPress={() => window.open(link, '_blank', 'noopener')} style={{ flex: 1 }} />
                  ) : null}
                </View>
                <Text style={s.hint}>Escanea el QR con la tableta o escribe el enlace en el navegador de la TV. Cualquiera con el enlace puede ver el marcador.</Text>
                <Button label="Desactivar enlaces" icon="close-circle-outline" variant="ghost" size="sm" onPress={revoke} />
              </View>
            ) : (
              <Button label="Crear enlace de espectador" icon="tv-outline" onPress={create} loading={busy} />
            )}
            {error ? <ErrorText>{error}</ErrorText> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surfaceSolid,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
    width: '100%',
    maxWidth: 560,
    maxHeight: '94%',
    alignSelf: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 24 },
  text: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  warn: { color: colors.warning, fontSize: 14 },
  linkBox: { alignItems: 'center', gap: space.sm, borderWidth: 1.5, borderColor: colors.lime, borderRadius: radius.lg, padding: space.md },
  qr: { width: 220, height: 220, backgroundColor: '#FFFFFF', borderRadius: radius.sm },
  link: { color: colors.text, fontSize: 13, textAlign: 'center' },
  hint: { color: colors.textDim, fontSize: 12, textAlign: 'center' },
  row: { flexDirection: 'row', gap: space.sm, alignSelf: 'stretch' },
});
