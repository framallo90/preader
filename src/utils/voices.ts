/**
 * Selección de voces del motor TTS del sistema. Funciones puras (testeables):
 * el acceso al módulo nativo vive en systemTtsService.
 */
export type VoiceLike = {
  identifier: string;
  name: string;
  /** BCP 47, p. ej. "es-US". */
  language: string;
  /** Escala de Android: 100 muy baja … 300 normal … 400 alta … 500 muy alta. */
  quality: number;
  networkConnectionRequired: boolean;
  notInstalled: boolean;
};

// Variantes regionales preferidas por idioma, de más a menos deseada. Para
// español se prioriza el latinoamericano (en el motor de Google es "es-US").
const REGION_PREFERENCE: Record<string, string[]> = {
  es: ['es-AR', 'es-US', 'es-419', 'es-MX', 'es-ES'],
  en: ['en-US', 'en-GB', 'en-AU'],
  pt: ['pt-BR', 'pt-PT'],
};

const LANGUAGE_LABELS: Record<string, string> = {
  'es-US': 'Español latino',
  'es-419': 'Español latino',
  'es-MX': 'Español (México)',
  'es-AR': 'Español (Argentina)',
  'es-ES': 'Español (España)',
  'en-US': 'Inglés (EE. UU.)',
  'en-GB': 'Inglés (Reino Unido)',
  'en-AU': 'Inglés (Australia)',
  'en-IN': 'Inglés (India)',
  'pt-BR': 'Portugués (Brasil)',
  'pt-PT': 'Portugués (Portugal)',
  'fr-FR': 'Francés',
  'it-IT': 'Italiano',
  'de-DE': 'Alemán',
};

export function primaryLanguage(tag: string): string {
  return tag.split(/[-_]/)[0]?.toLowerCase() ?? '';
}

function normalizeTag(tag: string): string {
  const [lang, region] = tag.split(/[-_]/);
  return region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : (lang ?? '').toLowerCase();
}

/** Voces utilizables sin red: instaladas y que no necesitan conexión. */
export function getOfflineVoices<T extends VoiceLike>(voices: T[]): T[] {
  const deduped = new Map<string, T>();
  for (const voice of voices) {
    if (voice.notInstalled || voice.networkConnectionRequired) continue;
    if (!deduped.has(voice.identifier)) deduped.set(voice.identifier, voice);
  }
  return [...deduped.values()];
}

function regionRank(voice: VoiceLike): number {
  const preference = REGION_PREFERENCE[primaryLanguage(voice.language)];
  if (!preference) return 0;
  const index = preference.indexOf(normalizeTag(voice.language));
  return index >= 0 ? index : preference.length;
}

/** Mejor voz offline para un idioma: región preferida, luego calidad. */
export function pickVoiceForLanguage<T extends VoiceLike>(voices: T[], language: string): T | null {
  const wanted = primaryLanguage(language);
  const candidates = getOfflineVoices(voices).filter((v) => primaryLanguage(v.language) === wanted);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const region = regionRank(a) - regionRank(b);
    if (region !== 0) return region;
    const quality = b.quality - a.quality;
    if (quality !== 0) return quality;
    return a.identifier.localeCompare(b.identifier);
  })[0];
}

/**
 * Voz a usar para un libro. La voz elegida en Ajustes vale solo para libros de
 * SU idioma; para el resto se elige sola la mejor voz del idioma del libro.
 */
export function resolveVoice<T extends VoiceLike>(
  voices: T[],
  preferredVoiceId: string | null,
  bookLanguage: string | null,
  fallbackLanguage = 'es',
): { voiceId: string | null; language: string } {
  const offline = getOfflineVoices(voices);
  const preferred = preferredVoiceId ? offline.find((v) => v.identifier === preferredVoiceId) ?? null : null;
  const language = bookLanguage ?? (preferred ? primaryLanguage(preferred.language) : fallbackLanguage);

  if (preferred && primaryLanguage(preferred.language) === primaryLanguage(language)) {
    return { voiceId: preferred.identifier, language: preferred.language };
  }
  const picked = pickVoiceForLanguage(offline, language);
  if (picked) return { voiceId: picked.identifier, language: picked.language };
  // Sin voz instalada para ese idioma: que el motor resuelva con su default.
  return { voiceId: null, language };
}

function qualityLabel(quality: number): string {
  if (quality >= 400) return 'alta';
  if (quality >= 300) return 'normal';
  return 'baja';
}

export type VoiceOption = { value: string; label: string; description: string };

/**
 * Opciones para el selector de Ajustes. Los nombres del motor son crípticos
 * ("es-us-x-sfb-local"), así que se muestran como "Español latino · voz 2".
 */
export function buildVoiceOptions<T extends VoiceLike>(voices: T[]): VoiceOption[] {
  const offline = getOfflineVoices(voices);
  const languageOrder = (v: VoiceLike) => {
    const lang = primaryLanguage(v.language);
    return lang === 'es' ? 0 : lang === 'en' ? 1 : 2;
  };
  const sorted = [...offline].sort((a, b) => {
    const order = languageOrder(a) - languageOrder(b);
    if (order !== 0) return order;
    const region = regionRank(a) - regionRank(b);
    if (region !== 0) return region;
    const lang = normalizeTag(a.language).localeCompare(normalizeTag(b.language));
    if (lang !== 0) return lang;
    const quality = b.quality - a.quality;
    if (quality !== 0) return quality;
    return a.identifier.localeCompare(b.identifier);
  });

  const counters = new Map<string, number>();
  return sorted.map((voice) => {
    const tag = normalizeTag(voice.language);
    const count = (counters.get(tag) ?? 0) + 1;
    counters.set(tag, count);
    return {
      value: voice.identifier,
      label: `${LANGUAGE_LABELS[tag] ?? tag} · voz ${count}`,
      description: `Calidad ${qualityLabel(voice.quality)} · sin conexión · ${voice.identifier}`,
    };
  });
}
