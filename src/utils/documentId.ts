function hashString(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function createDocumentId(params: {
  name: string;
  lastModified?: number;
  size?: number;
}) {
  const identity = `${params.name}:${params.lastModified ?? 0}:${params.size ?? 0}`;
  return `doc_${hashString(identity)}`;
}

export function safeDisplayFileName(name: string) {
  const cleanName = name.trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_');
  return cleanName || 'documento.pdf';
}

export function getFileExtension(name: string, mimeType?: string | null) {
  if (name.includes('.')) {
    return `.${name.split('.').pop() ?? 'pdf'}`.toLowerCase();
  }

  if (mimeType === 'application/pdf') {
    return '.pdf';
  }

  return '.bin';
}
