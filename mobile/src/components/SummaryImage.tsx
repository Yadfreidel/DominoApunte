// Versión web: el navegador convierte el SVG del resumen en PNG. Si el dispositivo permite compartir
// archivos (menú nativo de Android/iOS desde el navegador), se usa; si no, se descarga la imagen.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { colors, space } from '@/theme';
import { Button, ErrorText } from './ui';

export interface SummaryImageProps {
  svg: string;
  width: number;
  height: number;
  fileName: string;
  title: string;
  onDone?: (result: 'compartida' | 'descargada') => void;
}

async function svgToPng(svg: string, width: number, height: number): Promise<Blob> {
  const img = new window.Image();
  img.decoding = 'async';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no permite generar imágenes.');
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen.'))), 'image/png'),
  );
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function SummaryImage({ svg, width, height, fileName, title, onDone }: SummaryImageProps) {
  const [png, setPng] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // La imagen se genera al abrir: así "Compartir" llama al menú del sistema dentro del mismo toque,
  // como exigen los navegadores.
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    svgToPng(svg, width, height).then(
      (blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setPng({ blob, url });
      },
      (err) => alive && setError(err instanceof Error ? err.message : 'No se pudo generar la imagen.'),
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [svg, width, height]);

  const file = png ? new File([png.blob], fileName, { type: 'image/png' }) : null;
  const canShare = !!file && typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [file] });

  const share = async () => {
    if (!file || !png) return;
    setBusy(true);
    setError(null);
    try {
      await navigator.share({ files: [file], title });
      onDone?.('compartida');
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') setError('No se pudo compartir. Puedes descargar la imagen.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !png) return <ErrorText>{error}</ErrorText>;
  if (!png) {
    return (
      <View style={s.loading}>
        <ActivityIndicator color={colors.lime} />
        <Text style={s.muted}>Generando imagen…</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: space.md }}>
      <Image source={{ uri: png.url }} style={[s.preview, { aspectRatio: width / height }]} resizeMode="contain" accessibilityLabel="Vista previa del resumen" />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={s.row}>
        {canShare ? <Button label="Compartir" icon="logo-whatsapp" onPress={share} loading={busy} style={s.flex} /> : null}
        <Button
          label="Descargar imagen"
          icon="download-outline"
          variant={canShare ? 'outline' : 'primary'}
          onPress={() => {
            download(png.blob, fileName);
            onDone?.('descargada');
          }}
          style={s.flex}
        />
      </View>
      {!canShare ? <Text style={s.muted}>Este navegador no permite compartir archivos directamente: descarga la imagen y envíala por WhatsApp.</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  preview: { width: '100%', maxHeight: 460, borderRadius: 12, backgroundColor: colors.bg },
  row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  flex: { flexGrow: 1, flexBasis: 140 },
  loading: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  muted: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
});
