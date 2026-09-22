import { NativeModule, requireOptionalNativeModule } from 'expo';

export type VolumeKey = 'up' | 'down';

type VolumeKeyEvent = { key: VolumeKey };

declare class BardoKeysNativeModule extends NativeModule<{ volumeKey: (event: VolumeKeyEvent) => void }> {
  /** Prende o apaga la captura de los botones de volumen. */
  setCaptureVolumeKeys(enabled: boolean): void;
}

// Opcional: una build vieja no tiene el módulo, y la app tiene que abrir igual
// (sin pasar de página con el volumen) en vez de romperse al arrancar.
const nativeModule = requireOptionalNativeModule<BardoKeysNativeModule>('BardoKeys');

/** Si es false, el resto de este archivo no hace nada. */
export const volumeKeysAvailable = nativeModule !== null;

export function setCaptureVolumeKeys(enabled: boolean): void {
  nativeModule?.setCaptureVolumeKeys(enabled);
}

/**
 * Avisa cada vez que se aprieta volumen arriba/abajo mientras la captura está
 * prendida. Devuelve la función para dejar de escuchar.
 */
export function addVolumeKeyListener(listener: (key: VolumeKey) => void): () => void {
  if (!nativeModule) return () => {};
  const subscription = nativeModule.addListener('volumeKey', (event) => listener(event.key));
  return () => subscription.remove();
}
