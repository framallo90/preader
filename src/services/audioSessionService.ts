import {
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  setIsAudioActiveAsync,
} from 'expo-audio';
import { Platform } from 'react-native';

class AudioSessionService {
  private configurePromise: Promise<void> | null = null;
  private isConfigured = false;
  private notificationPermissionPromise: Promise<void> | null = null;

  async ensureReady() {
    if (this.isConfigured) {
      return;
    }

    if (!this.configurePromise) {
      this.configurePromise = (async () => {
        await setIsAudioActiveAsync(true);
        await setAudioModeAsync({
          allowsRecording: false,
          interruptionMode: 'doNotMix',
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          shouldRouteThroughEarpiece: false,
        });

        this.isConfigured = true;
      })().finally(() => {
        if (!this.isConfigured) {
          this.configurePromise = null;
        }
      });
    }

    await this.configurePromise;
  }

  async ensureNotificationPermission() {
    if (Platform.OS !== 'android') {
      return;
    }

    if (!this.notificationPermissionPromise) {
      this.notificationPermissionPromise = (async () => {
        try {
          await requestNotificationPermissionsAsync();
        } catch {
          // Si Android no necesita pedir permiso o el usuario ya lo rechazo,
          // seguimos sin bloquear la reproduccion principal.
        }
      })();
    }

    await this.notificationPermissionPromise;
  }
}

export const audioSessionService = new AudioSessionService();
