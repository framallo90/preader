import * as Speech from 'expo-speech';

export type NativeTtsVoice = 'default';

export type NativeTtsStatus =
  | 'idle'
  | 'speaking'
  | 'paused'
  | 'stopped';

export type NativeTtsListener = (status: NativeTtsStatus) => void;

/**
 * Thin wrapper around expo-speech for the free tier.
 * Mirrors the shape that useReaderController expects so swapping
 * between free and premium TTS requires minimal changes.
 */
class NativeTtsService {
  private _status: NativeTtsStatus = 'idle';
  private _listeners = new Set<NativeTtsListener>();
  private _currentText = '';
  private _rate = 1.0;
  private _pitch = 1.0;

  get status(): NativeTtsStatus {
    return this._status;
  }

  get isSpeaking(): boolean {
    return this._status === 'speaking';
  }

  setRate(rate: number) {
    this._rate = Math.max(0.1, Math.min(rate, 2.0));
  }

  setPitch(pitch: number) {
    this._pitch = Math.max(0.5, Math.min(pitch, 2.0));
  }

  subscribe(listener: NativeTtsListener): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  private _notify(status: NativeTtsStatus) {
    this._status = status;
    this._listeners.forEach((l) => l(status));
  }

  async speak(text: string): Promise<void> {
    if (!text.trim()) return;

    // Stop whatever is already playing before starting new speech
    await this.stop();

    this._currentText = text;
    this._notify('speaking');

    await Speech.speak(text, {
      language: 'es-ES',
      rate: this._rate,
      pitch: this._pitch,
      onDone: () => { this._notify('idle'); },
      onStopped: () => { this._notify('stopped'); },
      onError: () => { this._notify('idle'); },
    });
  }

  async pause(): Promise<void> {
    const canPause = await Speech.isSpeakingAsync();
    if (!canPause) return;
    await Speech.pause();
    this._notify('paused');
  }

  async resume(): Promise<void> {
    if (this._status !== 'paused') return;
    await Speech.resume();
    this._notify('speaking');
  }

  async stop(): Promise<void> {
    const speaking = await Speech.isSpeakingAsync();
    if (speaking) {
      await Speech.stop();
    }
    this._notify('idle');
  }

  /** Returns true if expo-speech is currently uttering anything. */
  async isSpeakingAsync(): Promise<boolean> {
    return Speech.isSpeakingAsync();
  }
}

export const nativeTtsService = new NativeTtsService();
