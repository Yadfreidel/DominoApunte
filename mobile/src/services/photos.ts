import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export type PhotoSource = 'camera' | 'library';

const SIZE = 256;

/** En el teléfono siempre; en la web, solo en dispositivos táctiles (el navegador del celular abre la cámara). */
export const cameraAvailable =
  Platform.OS !== 'web' || (typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0);

/**
 * Pide una foto a la cámara o a la galería y la devuelve recortada en cuadrado,
 * reducida a 256 px y como data URI JPEG (≈15–25 KB), lista para guardarse en el dispositivo.
 * Devuelve null si el usuario cancela.
 */
export async function pickPhoto(source: PhotoSource): Promise<string | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: 'images',
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  };
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    // En la web el permiso lo pide el propio navegador al abrir la cámara.
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) throw new Error('Permite el acceso a la cámara en los ajustes del teléfono.');
    }
    result = await ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front });
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
  // En web no hay pantalla de recorte: se recorta el centro para que quede cuadrada.
  if (asset.width && asset.height && asset.width !== asset.height) {
    const side = Math.min(asset.width, asset.height);
    context.crop({
      originX: Math.round((asset.width - side) / 2),
      originY: Math.round((asset.height - side) / 2),
      width: side,
      height: side,
    });
  }
  context.resize({ width: SIZE, height: SIZE });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
  if (!saved.base64) throw new Error('No se pudo procesar la foto.');
  return `data:image/jpeg;base64,${saved.base64}`;
}

const LOGO_MAX_SIDE = 512;

/**
 * Elige un logo de la galería: PNG (conserva la transparencia), con su proporción original y el lado
 * mayor reducido a 512 px. Devuelve null si el usuario cancela. El servidor vuelve a validar formato,
 * tamaño y dimensiones.
 */
export async function pickLogo(): Promise<string | null> {
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new Error('Permite el acceso a tus fotos en los ajustes del teléfono.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: false, quality: 1 });
  const asset = result.canceled ? null : result.assets?.[0];
  if (!asset) return null;
  const context = ImageManipulator.manipulate(asset.uri);
  const w = asset.width || LOGO_MAX_SIDE;
  const h = asset.height || LOGO_MAX_SIDE;
  if (Math.max(w, h) > LOGO_MAX_SIDE) {
    context.resize(w >= h ? { width: LOGO_MAX_SIDE } : { height: LOGO_MAX_SIDE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!saved.base64) throw new Error('No se pudo procesar la imagen.');
  return `data:image/png;base64,${saved.base64}`;
}
