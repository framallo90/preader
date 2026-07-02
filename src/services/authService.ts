import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../config/supabase';

export type AuthError = { message: string };

export type Profile = {
  id: string;
  email: string;
  isPremium: boolean;
  premiumUntil: string | null;
};

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authService = {
  async getSession(): Promise<Session | null> {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  async getUser(): Promise<User | null> {
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  },

  async signIn(email: string, password: string): Promise<AuthError | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { message: friendlyError(error.message) } : null;
  },

  async signUp(email: string, password: string): Promise<AuthError | null> {
    const { error } = await supabase.auth.signUp({ email, password });
    return error ? { message: friendlyError(error.message) } : null;
  },

  async resetPassword(email: string): Promise<AuthError | null> {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return error ? { message: friendlyError(error.message) } : null;
  },

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
  },

  onAuthStateChange(callback: (session: Session | null) => void) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session);
    });
    return data.subscription.unsubscribe;
  },

  // ── Profile / Premium ──────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, is_premium, premium_until')
      .eq('id', userId)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      email: data.email,
      isPremium: data.is_premium ?? false,
      premiumUntil: data.premium_until ?? null,
    };
  },

  /**
   * Suscribe a cambios en tiempo real del perfil del usuario.
   * Útil para detectar activación de premium luego del webhook de MercadoPago.
   */
  onProfileChange(userId: string, callback: (profile: Profile) => void) {
    const channel = supabase
      .channel(`profile-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            email: string;
            is_premium: boolean;
            premium_until: string | null;
          };
          callback({
            id: row.id,
            email: row.email,
            isPremium: row.is_premium,
            premiumUntil: row.premium_until,
          });
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function friendlyError(msg: string): string {
  if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.';
  if (msg.includes('Email not confirmed')) return 'Confirma tu email antes de ingresar.';
  if (msg.includes('User already registered')) return 'Ya existe una cuenta con ese email.';
  if (msg.includes('Password should be')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (msg.includes('rate limit')) return 'Demasiados intentos. Esperá unos minutos.';
  return msg;
}
