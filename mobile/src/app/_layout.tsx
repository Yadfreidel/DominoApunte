import {
  BarlowCondensed_600SemiBold,
  BarlowCondensed_700Bold,
  BarlowCondensed_800ExtraBold,
  BarlowCondensed_900Black,
  useFonts,
} from '@expo-google-fonts/barlow-condensed';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DialogProvider } from '@/components/Dialogs';
import { ScreenAwake } from '@/components/ScreenAwake';
import { Loading, StadiumBackground } from '@/components/ui';
import { AppStoreProvider } from '@/state/AppStore';
import { colors } from '@/theme';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold,
    BarlowCondensed_900Black,
  });

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {!fontsLoaded && !fontError ? (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <StadiumBackground />
          <Loading />
        </View>
      ) : (
        <AppStoreProvider>
          <ScreenAwake />
          <DialogProvider>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: 'fade',
              }}
            />
          </DialogProvider>
        </AppStoreProvider>
      )}
    </SafeAreaProvider>
  );
}
