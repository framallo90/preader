export function formatRelativeDateLabel(value: string) {
  const date = new Date(value);
  const now = Date.now();
  const diffMs = date.getTime() - now;
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const absMinutes = Math.abs(diffMinutes);
  const relative = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

  if (absMinutes < 60) {
    return relative.format(diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return relative.format(diffHours, 'hour');
  }

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) {
    return relative.format(diffDays, 'day');
  }

  return date.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function getDocumentTypeLabel(type: string | null) {
  if (!type) {
    return 'Archivo';
  }

  if (type.includes('pdf')) {
    return 'PDF';
  }

  return type.split('/').pop()?.toUpperCase() ?? 'Archivo';
}
