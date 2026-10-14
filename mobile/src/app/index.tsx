import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { EmptyState, Loading, Screen, StadiumBackground } from '@/components/ui';
import { useStore } from '@/state/AppStore';
import { colors } from '@/theme';

/** Al abrir la app se recupera la partida en curso; si no hay, se va a configurar una nueva. */
export default function Index() {
  const { ready, loadError, currentGame } = useStore();
  if (loadError) {
    return (
      <Screen>
        <EmptyState
          icon="alert-circle-outline"
          title="No se pudieron leer los datos"
          message={`El almacenamiento del dispositivo no respondió: ${loadError}. Cierra y vuelve a abrir la app.`}
        />
      </Screen>
    );
  }
  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <StadiumBackground />
        <Loading label="Recuperando partidas…" />
      </View>
    );
  }
  return <Redirect href={currentGame && currentGame.status !== 'cancelada' ? '/partida' : '/nueva'} />;
}
