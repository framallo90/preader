import { authService, Profile } from './authService';

export type PremiumListener = (isPremium: boolean) => void;

/**
 * Singleton que mantiene el estado premium del usuario activo.
 * Se suscribe a cambios en tiempo real desde Supabase (webhook de MercadoPago
 * actualiza la tabla profiles → Supabase Realtime notifica → aquí se refleja).
 */
class PremiumService {
  private _isPremium = false;
  private _profile: Profile | null = null;
  private _listeners = new Set<PremiumListener>();
  private _unsubscribeRealtime: (() => void) | null = null;
  private _activeUserId: string | null = null;

  get isPremium() { return this._isPremium; }
  get profile() { return this._profile; }

  async initialize(userId: string) {
    // Evita suscripciones realtime duplicadas si se llama más de una vez
    // para el mismo usuario (p. ej. eventos repetidos de auth).
    if (this._activeUserId === userId && this._unsubscribeRealtime) {
      return;
    }

    this._unsubscribeRealtime?.();
    this._unsubscribeRealtime = null;
    this._activeUserId = userId;

    // Carga inicial
    const profile = await authService.getProfile(userId);
    this._profile = profile;
    this._isPremium = profile?.isPremium ?? false;
    this._notify();

    // Suscripción realtime para detectar activación de premium post-pago
    this._unsubscribeRealtime = authService.onProfileChange(userId, (updatedProfile) => {
      this._profile = updatedProfile;
      this._isPremium = updatedProfile.isPremium;
      this._notify();
    });
  }

  teardown() {
    this._unsubscribeRealtime?.();
    this._unsubscribeRealtime = null;
    this._activeUserId = null;
    this._isPremium = false;
    this._profile = null;
    // No limpiamos _listeners: las pantallas suscritas (Ajustes, Suscripción)
    // deben seguir recibiendo el estado si el usuario vuelve a loguearse.
    this._notify();
  }

  subscribe(listener: PremiumListener) {
    this._listeners.add(listener);
    // Emite el estado actual inmediatamente
    listener(this._isPremium);
    return () => { this._listeners.delete(listener); };
  }

  private _notify() {
    for (const listener of this._listeners) {
      listener(this._isPremium);
    }
  }
}

export const premiumService = new PremiumService();
