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

/** Tamaño objetivo del logo ya comprimido (el servidor admite hasta 1 MB). */
const LOGO_TARGET_BYTES = 250 * 1024;

const dataUriBytes = (uri: string) => Math.ceil(((uri.length - uri.indexOf(',') - 1) * 3) / 4);

/**
 * Elige cualquier imagen de la galería como logo y la adapta sola: la reduce y la comprime hasta que
 * pese menos de 250 KB. Primero intenta PNG (conserva la transparencia), después WebP y, como último
 * recurso, JPEG. Devuelve null si el usuario cancela.
 */
export async function pickLogo(): Promise<string | null> {
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new Error('Permite el acceso a tus fotos en los ajustes del teléfono.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: false, quality: 1 });
  const asset = result.canceled ? null : result.assets?.[0];
  if (!asset) return null;
  const w = asset.width || 512;
  const h = asset.height || 512;

  const render = async (side: number, format: SaveFormat, compress = 1) => {
    const context = ImageManipulator.manipulate(asset.uri);
    const scale = Math.min(1, side / Math.max(w, h));
    if (scale < 1) context.resize(w >= h ? { width: Math.round(w * scale) } : { height: Math.round(h * scale) });
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format, compress, base64: true });
    if (!saved.base64) throw new Error('No se pudo procesar la imagen.');
    const mime = format === SaveFormat.PNG ? 'png' : format === SaveFormat.WEBP ? 'webp' : 'jpeg';
    return `data:image/${mime};base64,${saved.base64}`;
  };

  const attempts: [number, SaveFormat, number][] = [
    [512, SaveFormat.PNG, 1],
    [384, SaveFormat.PNG, 1],
    [512, SaveFormat.WEBP, 0.85],
    [512, SaveFormat.JPEG, 0.85],
    [384, SaveFormat.JPEG, 0.75],
    [256, SaveFormat.JPEG, 0.7],
  ];
  let last = '';
  for (const [side, format, compress] of attempts) {
    try {
      last = await render(side, format, compress);
    } catch {
      continue; // formato no disponible en este navegador o teléfono: se prueba el siguiente
    }
    // Algunos navegadores devuelven PNG al pedir WebP: se acepta igual si ya cumple el tamaño.
    if (dataUriBytes(last) <= LOGO_TARGET_BYTES) return last;
  }
  if (!last) throw new Error('No se pudo procesar la imagen.');
  return last;
}
