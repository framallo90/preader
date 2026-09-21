import { describe, it, expect } from 'vitest';

import { getSafFolderPath, isFolderExcluded } from './safPaths';

const TREE = 'content://com.android.externalstorage.documents/tree/primary%3ALibros';
const PICKED_SUBFOLDER = 'content://com.android.externalstorage.documents/tree/primary%3ALibros%2FViejos';
const SCANNED_SUBFOLDER = `${TREE}/document/primary%3ALibros%2FViejos`;
const SCANNED_NESTED = `${TREE}/document/primary%3ALibros%2FViejos%2FSaga`;
const SCANNED_SIBLING = `${TREE}/document/primary%3ALibros%2FViejosPeroBuenos`;

describe('getSafFolderPath', () => {
  it('da la misma ruta para la carpeta elegida y para la encontrada al escanear', () => {
    expect(getSafFolderPath(PICKED_SUBFOLDER)).toBe('primary:Libros/Viejos');
    expect(getSafFolderPath(SCANNED_SUBFOLDER)).toBe('primary:Libros/Viejos');
  });
});

describe('isFolderExcluded', () => {
  const excluded = [getSafFolderPath(PICKED_SUBFOLDER)];

  it('excluye la carpeta y todo lo que cuelga de ella', () => {
    expect(isFolderExcluded(SCANNED_SUBFOLDER, excluded)).toBe(true);
    expect(isFolderExcluded(SCANNED_NESTED, excluded)).toBe(true);
  });

  it('no excluye una carpeta hermana que solo comparte el prefijo del nombre', () => {
    expect(isFolderExcluded(SCANNED_SIBLING, excluded)).toBe(false);
  });

  it('sin exclusiones no excluye nada', () => {
    expect(isFolderExcluded(SCANNED_SUBFOLDER, [])).toBe(false);
  });
});
