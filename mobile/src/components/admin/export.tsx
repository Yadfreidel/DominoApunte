import { useState } from 'react';
import { Platform, Share, Text, View } from 'react-native';
import type { GameStatus } from '@/domain/game.ts';
import { useStore } from '@/state/AppStore';
import { space } from '@/theme';
import type { DateRange } from '../DateFilter';
import { useDialogs } from '../Dialogs';
import { Button, Card } from '../ui';
import { as, errorMessage, SectionHeader, useDebounced } from './common';
import { GameFilters, gameQuery } from './sections';

const EXPORTS = [
  { kind: 'partidas', label: 'Partidas', hint: 'Una fila por partida: fechas, estado, modalidad, meta, marcador y ganador.' },
  { kind: 'resultados', label: 'Resultados', hint: 'Una fila por jugador y partida: puntos de su lado y resultado.' },
  { kind: 'jugadores', label: 'Jugadores', hint: 'Perfiles: nombre, si está activo y fecha de alta.' },
  { kind: 'estadisticas', label: 'Estadísticas', hint: 'Por jugador, solo partidas oficiales (sin pruebas ni papelera) del periodo.' },
] as const;

/** Descarga el archivo en la web; en el teléfono abre el menú de compartir con el contenido. */
async function deliver(fileName: string, csv: string) {
  if (Platform.OS === 'web') {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  await Share.share({ title: fileName, message: csv });
}

export function AdminExport() {
  const { api } = useStore();
  const { toast } = useDialogs();
  const [status, setStatus] = useState<GameStatus | ''>('');
  const [type, setType] = useState<'' | 'reales' | 'prueba'>('');
  const [player, setPlayer] = useState('');
  const [range, setRange] = useState<DateRange>({});
  const [busy, setBusy] = useState<string | null>(null);
  const debounced = useDebounced(player);

  const download = async (kind: string) => {
    if (busy) return;
    setBusy(kind);
    try {
      const query = gameQuery({ status, type, player: debounced, range });
      const csv = await api<string>(`/admin/export/${kind}?${query}`, { text: true, timeoutMs: 60000 });
      const day = new Date().toISOString().slice(0, 10);
      await deliver(`domino-${kind}-${day}.csv`, csv);
      toast(Platform.OS === 'web' ? 'Archivo CSV descargado' : 'CSV listo para compartir');
    } catch (err) {
      toast(errorMessage(err, 'No se pudo exportar.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={as.stack}>
      <SectionHeader
        title="Exportar"
        subtitle="Archivos CSV con los filtros elegidos. No incluyen contraseñas, correos, fotos ni datos de cuentas."
      />
      <GameFilters status={status} setStatus={setStatus} type={type} setType={setType} player={player} setPlayer={setPlayer} setRange={setRange} />
      <Text style={as.muted}>Fechas y jugador se aplican a todos; estado y tipo, a partidas y resultados.</Text>
      {EXPORTS.map((e) => (
        <Card key={e.kind} style={{ gap: space.sm }}>
          <Text style={as.rowTitle}>{e.label}</Text>
          <Text style={as.muted}>{e.hint}</Text>
          <Button label={`Descargar ${e.label.toLowerCase()} (CSV)`} icon="download-outline" variant="outline" size="sm" onPress={() => download(e.kind)} loading={busy === e.kind} />
        </Card>
      ))}
    </View>
  );
}
