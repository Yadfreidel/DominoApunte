// Versión Android/iOS: se dibuja el SVG del resumen, se captura como PNG y se abre el menú nativo
// para compartir (WhatsApp, guardar en fotos, etc.).
import * as Sharing from 'expo-sharing';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { colors, space } from '@/theme';
import type { SummaryImageProps } from './SummaryImage';
import { Button, ErrorText } from './ui';

const PREVIEW_WIDTH = 320;

export function SummaryImage({ svg, width, height, title, onDone }: SummaryImageProps) {
  const ref = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewHeight = (height * PREVIEW_WIDTH) / width;

  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Este dispositivo no permite compartir archivos.');
      const uri = await captureRef(ref, { format: 'png', result: 'tmpfile', width, height });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: title });
      onDone?.('compartida');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo compartir la imagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ alignItems: 'center' }}>
        <View ref={ref} collapsable={false} style={{ width: PREVIEW_WIDTH, height: previewHeight, backgroundColor: colors.bg }}>
          <SvgXml xml={svg} width={PREVIEW_WIDTH} height={previewHeight} />
        </View>
      </ScrollView>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label="Compartir" icon="logo-whatsapp" onPress={share} loading={busy} />
      <Text style={s.muted}>En el menú puedes elegir WhatsApp o «Guardar imagen».</Text>
    </View>
  );
}

const s = StyleSheet.create({
  muted: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
});
