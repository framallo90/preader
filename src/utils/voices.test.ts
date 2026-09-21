import { describe, it, expect } from 'vitest';

import { VoiceLike, buildVoiceOptions, getOfflineVoices, pickVoiceForLanguage, resolveVoice } from './voices';

const voice = (identifier: string, language: string, quality: number, extra: Partial<VoiceLike> = {}): VoiceLike => ({
  identifier,
  name: identifier,
  language,
  quality,
  networkConnectionRequired: false,
  notInstalled: false,
  ...extra,
});

const voices: VoiceLike[] = [
  voice('es-es-x-eea-local', 'es-ES', 400),
  voice('es-us-x-sfb-local', 'es-US', 400),
  voice('es-us-x-esc-local', 'es-US', 300),
  voice('es-us-x-sfb-network', 'es-US', 500, { networkConnectionRequired: true }),
  voice('en-us-x-iol-local', 'en-US', 400),
  voice('fr-fr-x-vlf-local', 'fr-FR', 400, { notInstalled: true }),
];

describe('getOfflineVoices', () => {
  it('descarta las que necesitan red o no están instaladas', () => {
    const ids = getOfflineVoices(voices).map((v) => v.identifier);
    expect(ids).not.toContain('es-us-x-sfb-network');
    expect(ids).not.toContain('fr-fr-x-vlf-local');
    expect(ids).toHaveLength(4);
  });
});

describe('pickVoiceForLanguage', () => {
  it('prefiere español latino y, dentro de la región, la de más calidad', () => {
    expect(pickVoiceForLanguage(voices, 'es')?.identifier).toBe('es-us-x-sfb-local');
  });

  it('devuelve null si no hay voz offline del idioma', () => {
    expect(pickVoiceForLanguage(voices, 'fr')).toBeNull();
    expect(pickVoiceForLanguage(voices, 'de')).toBeNull();
  });
});

describe('resolveVoice', () => {
  it('usa la voz elegida cuando coincide con el idioma del libro', () => {
    expect(resolveVoice(voices, 'es-es-x-eea-local', 'es').voiceId).toBe('es-es-x-eea-local');
  });

  it('ignora la voz elegida si el libro está en otro idioma', () => {
    const resolved = resolveVoice(voices, 'es-es-x-eea-local', 'en');
    expect(resolved.voiceId).toBe('en-us-x-iol-local');
    expect(resolved.language).toBe('en-US');
  });

  it('sin idioma detectado respeta el idioma de la voz elegida', () => {
    expect(resolveVoice(voices, 'en-us-x-iol-local', null).voiceId).toBe('en-us-x-iol-local');
  });

  it('sin voz instalada para el idioma deja que el motor resuelva', () => {
    expect(resolveVoice(voices, null, 'de')).toEqual({ voiceId: null, language: 'de' });
  });

  it('descarta una voz elegida que ya no existe', () => {
    expect(resolveVoice(voices, 'voz-desinstalada', 'es').voiceId).toBe('es-us-x-sfb-local');
  });
});

describe('buildVoiceOptions', () => {
  it('arma etiquetas legibles, español latino primero', () => {
    const options = buildVoiceOptions(voices);
    expect(options[0].value).toBe('es-us-x-sfb-local');
    expect(options[0].label).toBe('Español latino · voz 1');
    expect(options.map((o) => o.value)).not.toContain('es-us-x-sfb-network');
    expect(options.find((o) => o.value === 'es-us-x-esc-local')?.label).toBe('Español latino · voz 2');
  });
});
