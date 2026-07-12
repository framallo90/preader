/**
 * Voces de narración disponibles.
 *
 * IMPORTANTE: la voz la genera Kokoro (español) vía fal.ai, que ofrece 3 voces
 * distintas. El código viejo mostraba 6 nombres de OpenAI (Onyx, Nova, Alloy…)
 * que en realidad mapeaban a solo 3 → elegir "Echo" o "Fable" no cambiaba nada.
 * Esta lista expone las 3 voces REALES, con descripciones honestas.
 *
 * Los `value` se mantienen como nombres OpenAI heredados porque son la clave que
 * guarda el usuario y la que `toKokoroVoice()` mapea a cada voz Kokoro distinta:
 *   onyx → em_alex   ·   nova → ef_dora   ·   alloy → em_santa
 */
export type VoiceOption = {
  value: string;
  label: string;
  description: string;
};

export const VOICE_OPTIONS: VoiceOption[] = [
  { value: 'onyx', label: 'Álex — masculina', description: 'Voz masculina, tono neutro y claro. Por defecto.' },
  { value: 'nova', label: 'Dora — femenina', description: 'Voz femenina, clara y natural.' },
  { value: 'alloy', label: 'Santa — masculina cálida', description: 'Voz masculina de tono más cálido.' },
];

export const DEFAULT_VOICE_ID = 'onyx';

export const VALID_VOICE_IDS = new Set(VOICE_OPTIONS.map((v) => v.value));

export function getVoiceLabel(voiceId: string): string {
  return VOICE_OPTIONS.find((v) => v.value === voiceId)?.label ?? VOICE_OPTIONS[0].label;
}
