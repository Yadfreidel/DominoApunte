import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { visionSize } from '@/domain/tiles.ts';

export interface PreparedPhoto {
  /** URI local para mostrarla en pantalla (temporal, no se guarda en la app). */
  uri: string;
  base64: string;
  width: number;
  height: number;
}

export const cameraAvailable = Platform.OS !== 'web';

/** Pide una foto (cámara o galería) y la prepara para el análisis. Devuelve null si se cancela. */
export async function pickTilePhoto(source: 'camera' | 'library'): Promise<PreparedPhoto | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', allowsEditing: false, quality: 1 };
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Permite el acceso a la cámara en los ajustes del teléfono.');
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) throw new Error('Permite el acceso a tus fotos en los ajustes del teléfono.');
    }
    result = await ImagePicker.launchImageLibraryAsync(options);
  }
  const asset = result.canceled ? null : result.assets?.[0];
  if (!asset) return null;

  const context = ImageManipulator.manipulate(asset.uri);
  if (asset.width && asset.height) {
    const [w, h] = visionSize(asset.width, asset.height);
    if (w !== asset.width || h !== asset.height) context.resize({ width: w, height: h });
  }
  const image = await context.renderAsync();
  let saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.88, base64: true });
  // Si el selector no informó las dimensiones, se comprueba sobre el archivo final y se reduce otra vez.
  const [fw, fh] = visionSize(saved.width, saved.height);
  if (fw !== saved.width || fh !== saved.height) {
    const again = ImageManipulator.manipulate(saved.uri);
    again.resize({ width: fw, height: fh });
    saved = await (await again.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.88, base64: true });
  }
  if (!saved.base64) throw new Error('No se pudo preparar la foto.');
  // Las dimensiones reales del archivo final son las que manda el servidor a validar.
  return { uri: saved.uri, base64: saved.base64, width: saved.width, height: saved.height };
}
