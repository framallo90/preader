import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';

class AudioSessionService {
  private configurePromise: Promise<void> | null = null;
  private isConfigured = false;

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
          shouldPlayInBackground: false,
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
}

export const audioSessionService = new AudioSessionService();
