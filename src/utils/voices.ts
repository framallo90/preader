type VoiceLike = {
  identifier: string;
  name: string;
  language: string;
  networkConnectionRequired: boolean;
  notInstalled: boolean;
};

function sortVoicesByPreference<T extends VoiceLike>(voices: T[]) {
  const scoreLanguage = (language: string) => {
    if (language.startsWith('es')) {
      return 0;
    }

    if (language.startsWith('en')) {
      return 1;
    }

    return 2;
  };

  return [...voices].sort((left, right) => {
    const languageScore = scoreLanguage(left.language) - scoreLanguage(right.language);

    if (languageScore !== 0) {
      return languageScore;
    }

    return left.name.localeCompare(right.name);
  });
}

export function getOfflineVoices<T extends VoiceLike>(voices: T[]) {
  const deduped = new Map<string, T>();

  voices.forEach((voice) => {
    if (voice.notInstalled || voice.networkConnectionRequired) {
      return;
    }

    if (!deduped.has(voice.identifier)) {
      deduped.set(voice.identifier, voice);
    }
  });

  return sortVoicesByPreference([...deduped.values()]);
}

export function sanitizeVoiceId<T extends VoiceLike>(voiceId: string | null, voices: T[]) {
  if (!voiceId) {
    return null;
  }

  return voices.some((voice) => voice.identifier === voiceId) ? voiceId : null;
}
