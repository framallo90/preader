/**
 * appMode.ts
 *
 * Modo de la app. En PERSONAL_MODE la app es de uso propio, sin cuentas ni
 * pagos: no hay login y todas las funciones premium están desbloqueadas.
 * Las llamadas de IA (OpenAI TTS + Claude) se resuelven con las keys locales
 * de `secrets.ts`, no con las Edge Functions de Supabase.
 *
 * Para volver al modelo freemium (login + premium por pago) poné esto en false.
 */
export const PERSONAL_MODE = true;
