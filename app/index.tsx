import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Alert, AppState, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '../src/components/AppButton';
import { BookGridItem } from '../src/components/BookGridItem';
import { BookListItem } from '../src/components/BookListItem';
import { OptionPickerModal } from '../src/components/OptionPickerModal';
import { ReorderSheet } from '../src/components/ReorderSheet';
import { Screen } from '../src/components/Screen';
import { Chip, Icon, IconButton, IconName } from '../src/components/ui';
import { useAppSettings } from '../src/hooks/useAppSettings';
import {
  documentAudioPlaybackService,
  DocumentPlaybackSnapshot,
} from '../src/services/documentAudioPlaybackService';
import { removeBookCover } from '../src/services/bookMetadataService';
import { restoreAudioSessionIfAny } from '../src/services/audioSessionRestore';
import { ScanResult, addIgnoredBook, clearIgnoredBook, consumeScanRequest, getDisplayNameFromSafUri, getIgnoredBooksCount, requestLibraryFolder, restoreIgnoredBooks, scanLibraryFolders } from '../src/services/libraryScanService';
import { buildOrderEntries, compareBooksManually, compareBooksNaturally, getDisplayTitle } from '../src/utils/bookDisplay';
import { compareSubfolders, folderMatchDepth, formatSubfolderLabel, getSubfolderPath } from '../src/utils/libraryFolders';
import { foldText } from '../src/utils/textSearch';
import { getDocumentTypeLabel } from '../src/utils/formatters';
import { radius } from '../src/utils/theme';
import { NO_COVER_COLOR, coverTint } from '../src/utils/coverTint';
import { getBardoPdfModule, isBardoPdfAvailable } from '../modules/bardo-pdf';
import { filePickerService } from '../src/services/filePickerService';
import { isComicFile } from '../src/services/bookTypes';
import { backfillCovers } from '../src/services/coverBackfillService';
import { remainingLabel } from '../src/utils/readingTime';
import { clearBookPages } from '../src/services/pdfLocalService';
import { clearBookAudio } from '../src/services/systemTtsService';
import { bookProgressRepository } from '../src/storage/bookProgressRepository';
import { bookRepository } from '../src/storage/bookRepository';
import { withDatabaseRetry } from '../src/storage/database';
import { collectionRepository } from '../src/storage/collectionRepository';
import { runtimeStateRepository } from '../src/storage/runtimeStateRepository';
import { parsedDocumentRepository } from '../src/storage/parsedDocumentRepository';
import { Book, BookStatus, Collection, LibrarySort } from '../src/types/storage';

// Al volver al Inicio se escanea como mucho cada tanto. Volver a la app desde
// otra, tirar para abajo, cambiar las carpetas y "Restaurar ocultos" escanean
// siempre, sin esperar.
const SCAN_MIN_INTERVAL_MS = 2 * 60 * 1000;
// Cuánto queda a la vista el resultado de tirar para abajo.
const SCAN_NOTICE_MS = 5000;

/** Qué decir después de escanear a pedido. */
function describeScan(result: ScanResult | null): string {
  if (!result) return 'No se pudo escanear. Probá de nuevo.';
  if (result.unreadable.length > 0) {
    const nombres = result.unreadable.map(getDisplayNameFromSafUri).join(', ');
    return `No se pudo leer ${nombres}. Quitala en Ajustes y volvé a agregarla.`;
  }
  if (result.changed === 0) return 'Sin novedades: no hay libros nuevos en las carpetas.';
  return result.changed === 1 ? '1 libro nuevo o movido.' : `${result.changed} libros nuevos o movidos.`;
}

const SORT_OPTIONS: { value: LibrarySort; label: string; description: string; icon: IconName }[] = [
  { value: 'recent', label: 'Recientes', description: 'Lo último que abriste, primero.', icon: 'time-outline' },
  { value: 'title', label: 'Título', description: 'Alfabético por título.', icon: 'text-outline' },
  { value: 'author', label: 'Autor', description: 'Agrupa la biblioteca por autor.', icon: 'person-outline' },
  { value: 'manual', label: 'El mío', description: 'El orden que acomodaste a mano en cada carpeta.', icon: 'reorder-three-outline' },
];

function compareByAuthor(a: Book, b: Book): number {
  const byAuthor = (a.author ?? '\uffff').localeCompare(b.author ?? '\uffff', 'es', { sensitivity: 'base' });
  return byAuthor !== 0 ? byAuthor : compareBooksNaturally(a, b);
}

/** Orden de la biblioteca. 'recent' respeta el orden de la base (último abierto primero). */
function sortBooks(books: Book[], sort: LibrarySort): Book[] {
  if (sort === 'title') return [...books].sort(compareBooksNaturally);
  if (sort === 'author') return [...books].sort(compareByAuthor);
  if (sort === 'manual') return [...books].sort(compareBooksManually);
  return books;
}

// 'all' | 'reading' | 'to_read' | 'read' | 'favorite' | id de una colección
type LibraryFilter = string;
const BASE_FILTERS: { value: LibraryFilter; label: string; icon: IconName }[] = [
  { value: 'all', label: 'Todos', icon: 'grid-outline' },
  { value: 'reading', label: 'Leyendo', icon: 'book-outline' },
  { value: 'to_read', label: 'Para leer', icon: 'bookmark-outline' },
  { value: 'read', label: 'Leídos', icon: 'checkmark-done-outline' },
  { value: 'favorite', label: 'Favoritos', icon: 'heart' },
];

/** Tres libros por fila: es lo que entra cómodo en un teléfono. */
const LIBRARY_COLUMNS = 3;

/** Encabezado para los libros a los que no se les pudo sacar el autor. */
const SIN_AUTOR = 'Sin autor';

/** Un tramo de la biblioteca: una subcarpeta, o la raíz cuando `path` es ''. */
type SubfolderGroup = { path: string; books: Book[] };
type LibrarySection = { folderUri: string; name: string; books: Book[]; groups: SubfolderGroup[] };

type LibraryRow =
  | { kind: 'folder'; key: string; section: LibrarySection }
  | { kind: 'subfolder'; key: string; folderUri: string; path: string; count: number }
  | { kind: 'books'; key: string; books: Book[] }
  | { kind: 'subtitle'; key: string; text: string };
/** Lo único que el Inicio necesita saber del reproductor. */
type PlaybackBadge = { documentId: string | null; isPlaying: boolean; isPreparing: boolean; isLoaded: boolean };

function toPlaybackBadge(snapshot: DocumentPlaybackSnapshot): PlaybackBadge {
  return {
    documentId: snapshot.documentId,
    isPlaying: snapshot.isPlaying,
    isPreparing: snapshot.isPreparing,
    isLoaded: snapshot.isLoaded,
  };
}

function samePlaybackBadge(a: PlaybackBadge, b: PlaybackBadge): boolean {
  return (
    a.documentId === b.documentId &&
    a.isPlaying === b.isPlaying &&
    a.isPreparing === b.isPreparing &&
    a.isLoaded === b.isLoaded
  );
}

export default function HomeScreen() {
  const { colors, settings, updateSettings, isReady: areSettingsReady } = useAppSettings();
  const [recentDocuments, setRecentDocuments] = useState<Book[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map());
  const [lastOpenedDocument, setLastOpenedDocument] = useState<Book | null>(null);
  const [continueSize, setContinueSize] = useState<{ textLength: number | null; pageCount: number | null }>({
    textLength: null,
    pageCount: null,
  });
  const [activePlaybackDocument, setActivePlaybackDocument] = useState<Book | null>(null);
  // Del reproductor, el Inicio solo muestra QUÉ libro suena y si está sonando o
  // preparando. Guardar el snapshot entero lo redibujaba cuatro veces por segundo
  // (el tiempo de reproducción cambia siempre), incluso con el lector en pantalla
  // y el Inicio montado abajo, sin nada visible que actualizar.
  const [playback, setPlayback] = useState<PlaybackBadge>(() => toPlaybackBadge(documentAudioPlaybackService.getSnapshot()));
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [ignoredCount, setIgnoredCount] = useState(0);
  // Tirar para abajo: el spinner del sistema y, al terminar, una línea con lo
  // que pasó (cuántos libros nuevos, o qué carpeta no se pudo leer).
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  // Carpetas de biblioteca como secciones expandibles + selector Leer/Escuchar.
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [pendingBook, setPendingBook] = useState<Book | null>(null);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSortPickerVisible, setIsSortPickerVisible] = useState(false);
  // El "+" pregunta qué querés agregar: un archivo suelto o una carpeta entera.
  const [isAddPickerVisible, setIsAddPickerVisible] = useState(false);
  // Libro que se está renombrando, con el texto en edición.
  const [renaming, setRenaming] = useState<{ book: Book; value: string } | null>(null);
  // Carpeta que se está acomodando a mano.
  const [reordering, setReordering] = useState<{ title: string; books: Book[] } | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionBookIds, setCollectionBookIds] = useState<Set<string> | null>(null);
  const hasAutoOpenedRef = useRef(false);

  // La lista al día para el generador de tapas, sin meterla como dependencia
  // (si no, cada tapa nueva reiniciaría el recorrido).
  const recentDocumentsRef = useRef<Book[]>([]);
  const hasLoadedOnceRef = useRef(false);
  const loadRecentDocuments = useCallback(async () => {
    // El spinner solo la primera vez: al volver de un libro la lista ya está y
    // se actualiza en el lugar, sin parpadeo.
    if (!hasLoadedOnceRef.current) setIsLoading(true);

    const leerTodo = () =>
      Promise.all([
        bookRepository.listAllBooks(),
        bookRepository.getLastOpenedBook(),
        collectionRepository.listCollections(),
        bookRepository.listProgressPercentages(),
        getIgnoredBooksCount(),
      ]);

    try {
      // Con reintento: si la base quedó inutilizable (la app se actualizó con el
      // proceso vivo), se reabre en vez de mostrar la biblioteca vacía.
      const [recent, lastOpened, loadedCollections, progress, ignored] = await withDatabaseRetry(leerTodo);
      setCollections(loadedCollections);
      recentDocumentsRef.current = recent;
      setRecentDocuments(recent);
      setProgressMap(progress);
      setLastOpenedDocument(lastOpened);
      // El tamaño solo del libro de la tarjeta, para decir cuánto falta.
      if (lastOpened) {
        void parsedDocumentRepository.getReadingSize(lastOpened.id).then(setContinueSize);
      } else {
        setContinueSize({ textLength: null, pageCount: null });
      }
      setIgnoredCount(ignored);
      hasLoadedOnceRef.current = true;
    } catch (error) {
      Alert.alert(
        'No se pudieron cargar los recientes',
        error instanceof Error ? error.message : 'Revisa el almacenamiento local e intenta de nuevo.',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Biblioteca por descubrimiento: la lista se muestra YA con lo que hay en la
  // base; el escaneo de las carpetas corre de fondo y, solo si encontró libros
  // nuevos, refresca. Antes el Inicio esperaba el escaneo entero cada vez que
  // volvías de un libro.
  const lastScanAtRef = useRef(0);
  // Qué carpetas se escanearon la última vez. Si la lista cambió (acabás de
  // agregar una en Ajustes), el escaneo NO espera el intervalo: si no, la
  // carpeta nueva no mostraba un solo libro hasta dos minutos después.
  const lastScanKeyRef = useRef('');
  const scanKey = `${settings.libraryFolders.join('|')}##${settings.excludedFolders.join('|')}`;

  // Escanea AHORA, sin esperar el intervalo, y recarga la lista si algo cambió.
  // Devuelve el resultado para quien quiera contarlo (tirar para abajo); null
  // si no hay carpetas o el escaneo falló. El escaneo nunca debe romper el Home.
  const rescan = useCallback(async (): Promise<ScanResult | null> => {
    lastScanAtRef.current = Date.now();
    lastScanKeyRef.current = scanKey;
    if (settings.libraryFolders.length === 0) return null;
    try {
      const result = await scanLibraryFolders(settings.libraryFolders, settings.excludedFolders);
      if (result.changed > 0) await loadRecentDocuments();
      return result;
    } catch {
      return null;
    }
  }, [scanKey, settings.libraryFolders, settings.excludedFolders, loadRecentDocuments]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        await loadRecentDocuments();
        if (!active) return;
        // Con las mismas carpetas de la última vez se respeta el intervalo. Si
        // cambiaron, se escanea ya, y eso incluye haberse quedado SIN carpetas:
        // antes, con la lista vacía se salía sin anotar la clave, y al quitar
        // la única carpeta y volver a agregarla la clave era la de siempre, el
        // intervalo se comía el escaneo, y los libros nuevos no aparecían "ni
        // borrando la carpeta y cargándola de nuevo".
        const sameFolders = scanKey === lastScanKeyRef.current;
        // "Restaurar ocultos" desde Ajustes pide un escaneo ya, sin intervalo.
        const requested = consumeScanRequest();
        if (!requested && sameFolders && Date.now() - lastScanAtRef.current < SCAN_MIN_INTERVAL_MS) return;
        await rescan();
      })();
      return () => {
        active = false;
      };
    }, [loadRecentDocuments, scanKey, rescan]),
  );

  // Volver a Bardo desde otra app escanea siempre. Es el caso de todos los días:
  // copiás libros a la carpeta con el explorador de archivos y volvés; el Inicio
  // no se entera solo de que hay archivos nuevos, hay que mirar la carpeta. Es
  // barato: una consulta nativa por carpeta, y los archivos ya conocidos se
  // saltean por URI.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void rescan();
    });
    return () => subscription.remove();
  }, [rescan]);

  // Tirar para abajo: escanear a pedido y decir qué pasó. Es la salida a mano
  // cuando "no aparecen" los libros que acabás de agregar.
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      if (settings.libraryFolders.length === 0) {
        await loadRecentDocuments();
        setScanNotice('No hay carpetas para escanear. Agregá una con el botón +.');
        return;
      }
      setScanNotice(describeScan(await rescan()));
    } finally {
      setIsRefreshing(false);
    }
  }, [settings.libraryFolders.length, loadRecentDocuments, rescan]);

  useEffect(() => {
    if (!scanNotice) return;
    const timer = setTimeout(() => setScanNotice(null), SCAN_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [scanNotice]);

  const openReader = useCallback((documentId: string, replace = false, mode?: 'read' | 'listen') => {
    console.log('[home] openReader', documentId.slice(0, 12), mode ?? '(sin modo)');
    const action = replace ? router.replace : router.push;
    action({ pathname: '/reader', params: mode ? { documentId, mode } : { documentId } });
  }, []);

  const openChooser = useCallback((book: Book) => {
    setPendingBook(book);
  }, []);

  // Estables entre renders: si cambiaran de identidad, el memo de BookGridItem
  // no serviría de nada.
  const handleOpenBook = useCallback((book: Book) => openReader(book.id), [openReader]);

  // Restaurar ocultos + re-escanear + refrescar, todo de una. Se recarga aunque
  // el escaneo no haya cambiado nada: el contador de ocultos sí cambió.
  const handleRestoreHidden = useCallback(async () => {
    await restoreIgnoredBooks();
    await rescan();
    await loadRecentDocuments();
  }, [rescan, loadRecentDocuments]);

  // Filtro por colección: los ids de sus libros se cargan al elegirla.
  const isCollectionFilter = !BASE_FILTERS.some((filter) => filter.value === libraryFilter);
  useEffect(() => {
    if (!isCollectionFilter) {
      setCollectionBookIds(null);
      return;
    }
    let mounted = true;
    void collectionRepository.listBookIdsInCollection(libraryFilter).then((ids) => {
      if (mounted) setCollectionBookIds(new Set(ids));
    });
    return () => { mounted = false; };
  }, [libraryFilter, isCollectionFilter, recentDocuments]);

  // La colección del filtro se borró (desde la ficha de un libro): volver a
  // "Todos". Si no, la lista quedaba vacía sin ningún chip activo.
  useEffect(() => {
    if (isCollectionFilter && !collections.some((collection) => collection.id === libraryFilter)) setLibraryFilter('all');
  }, [collections, isCollectionFilter, libraryFilter]);

  const filteredDocuments = useMemo(() => {
    let books: Book[];
    switch (libraryFilter) {
      case 'all':
        books = recentDocuments;
        break;
      case 'reading':
        books = recentDocuments.filter((book) => (progressMap.get(book.id) ?? 0) > 0 && book.status !== 'read');
        break;
      case 'to_read':
        books = recentDocuments.filter((book) => book.status === 'to_read');
        break;
      case 'read':
        books = recentDocuments.filter((book) => book.status === 'read');
        break;
      case 'favorite':
        books = recentDocuments.filter((book) => book.favorite);
        break;
      default:
        books = collectionBookIds ? recentDocuments.filter((book) => collectionBookIds.has(book.id)) : [];
    }
    // Búsqueda por título, autor o nombre de archivo, sin distinguir tildes ni mayúsculas.
    const query = foldText(searchQuery.trim());
    if (query) {
      books = books.filter((book) => foldText(`${getDisplayTitle(book)} ${book.author ?? ''} ${book.name}`).includes(query));
    }
    return books;
  }, [libraryFilter, recentDocuments, progressMap, collectionBookIds, searchQuery]);

  // Agrupa los libros por carpeta, comparando la RUTA de cada uno con la de la
  // carpeta. Antes se comparaba el "tree id" de la URI, que dice por dónde se
  // descubrió el archivo: una carpeta recién agregada aparecía con 0 libros si
  // los suyos ya estaban en la biblioteca desde otra raíz (importados a mano o
  // encontrados escaneando la carpeta de arriba), y caían en "Otros libros".
  // Orden natural (2 antes que 10) dentro de cada grupo.
  const librarySections = useMemo(() => {
    const folders = settings.libraryFolders.map((folderUri) => ({
      folderUri,
      name: getDisplayNameFromSafUri(folderUri),
    }));

    // Cada libro cae en UNA sola carpeta: la más específica que lo contenga. Si
    // tenés agregadas "Comics" y "Comics/Absolute Batman", el cómic va a la
    // segunda, no a las dos.
    const porCarpeta = new Map<string, Book[]>();
    const sueltos: Book[] = [];
    for (const book of filteredDocuments) {
      let elegida: string | null = null;
      let mejor = -1;
      for (const folder of folders) {
        // Por ruta (lo confiable) o, para libros viejos cuyo nombre guardaba el
        // prefijo de la carpeta, por ese prefijo.
        const porRuta = folderMatchDepth(book.uri, folder.folderUri);
        const porNombre = book.name.startsWith(`${folder.name}/`) ? folder.name.length : -1;
        const puntaje = Math.max(porRuta, porNombre);
        if (puntaje > mejor) {
          mejor = puntaje;
          elegida = folder.folderUri;
        }
      }
      if (elegida === null || mejor < 0) {
        sueltos.push(book);
        continue;
      }
      const actual = porCarpeta.get(elegida);
      if (actual) actual.push(book);
      else porCarpeta.set(elegida, [book]);
    }

    const sections = folders.map(({ folderUri, name }) => {
      const books = sortBooks(porCarpeta.get(folderUri) ?? [], settings.librarySort);
      // Los libros del escaneo guardan solo el nombre del archivo, pero su URI
      // de SAF sí trae la ruta: de ahí sale en qué subcarpeta está cada uno.
      const porSubcarpeta = new Map<string, Book[]>();
      for (const book of books) {
        const sub = getSubfolderPath(book.uri, folderUri);
        const actual = porSubcarpeta.get(sub);
        if (actual) actual.push(book);
        else porSubcarpeta.set(sub, [book]);
      }
      const groups = [...porSubcarpeta.entries()]
        .sort((a, b) => compareSubfolders(a[0], b[0]))
        .map(([path, libros]) => ({ path, books: libros }));
      return { folderUri, name, books, groups };
    });
    const ungrouped = sortBooks(sueltos, settings.librarySort);
    // Con un filtro o una búsqueda activos, las carpetas sin resultados no se muestran.
    const isFiltering = libraryFilter !== 'all' || searchQuery.trim().length > 0;
    return { sections: sections.filter((section) => !isFiltering || section.books.length > 0), ungrouped };
  }, [settings.libraryFolders, settings.librarySort, filteredDocuments, libraryFilter, searchQuery]);

  // Las tapas de los libros que entraron por escaneo y nunca se abrieron se
  // generan acá, de fondo. SOLO con el Inicio a la vista: el módulo nativo
  // mantiene un PDF abierto por vez, así que hacer esto con un libro abierto le
  // cerraría el documento al lector en cada tapa.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      // Un respiro antes de arrancar: primero que se vea la biblioteca.
      const timer = setTimeout(() => {
        void backfillCovers(recentDocumentsRef.current, {
          isCancelled: () => cancelled,
          onCover: (bookId, coverUri) => {
            // Se actualiza esa tapa nada más, sin volver a leer la base entera.
            // También en la ref, para que al volver al Inicio no se reintente
            // una tapa que ya está hecha.
            recentDocumentsRef.current = recentDocumentsRef.current.map((book) =>
              book.id === bookId ? { ...book, coverUri } : book,
            );
            setRecentDocuments((previous) =>
              previous.map((book) => (book.id === bookId ? { ...book, coverUri } : book)),
            );
            setLastOpenedDocument((previous) =>
              previous && previous.id === bookId ? { ...previous, coverUri, coverColor: null } : previous,
            );
          },
        });
      }, 900);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }, []),
  );

  // Reabrir el último libro es cosa del ARRANQUE. El ajuste vive en un contexto
  // compartido y el Inicio queda montado debajo de Ajustes: si el efecto mirara
  // el valor, activar la opción abría el lector encima de Ajustes ahí mismo.
  // Se decide una sola vez, apenas los ajustes están leídos.
  useEffect(() => {
    if (!areSettingsReady || hasAutoOpenedRef.current) return;
    hasAutoOpenedRef.current = true; // el arranque ya pasó: no se repite
    if (!settings.reopenLastDocumentOnLaunch) return;
    // Si el arranque anterior se cayó cargando un libro, no se lo vuelve a
    // abrir solo: era un bucle de cierres sin salida.
    if (runtimeStateRepository.wasBootRecovered()) return;
    void bookRepository.getLastOpenedBook().then((book) => {
      if (book) openReader(book.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areSettingsReady]);

  // Si la app se cerró mientras se escuchaba un libro, se lo vuelve a dejar
  // cargado en pausa con la sesión de medios armada (audioSessionRestore): el
  // play de la notificación, del auricular o de la tarjeta de arriba vuelve a
  // funcionar. Después de que el Inicio ya se mostró: abrir es instantáneo.
  const hasRestoredAudioRef = useRef(false);
  useEffect(() => {
    if (!areSettingsReady || hasRestoredAudioRef.current) return;
    hasRestoredAudioRef.current = true;
    setTimeout(() => {
      void restoreAudioSessionIfAny(settings).catch(() => {});
    }, 2000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areSettingsReady]);

  useEffect(() => {
    let isMounted = true;
    let requestId = 0;
    let lastDocumentId: string | null | undefined;

    const syncPlayback = (snapshot: DocumentPlaybackSnapshot) => {
      const badge = toPlaybackBadge(snapshot);
      // React corta solo si el estado no cambió, pero solo si es el MISMO objeto:
      // por eso se compara campo a campo antes de tocar el estado.
      setPlayback((previous) => (samePlaybackBadge(previous, badge) ? previous : badge));

      // El libro solo se busca cuando cambia de libro. Antes se consultaba la
      // base cuatro veces por segundo durante toda la escucha.
      if (badge.documentId === lastDocumentId) return;
      lastDocumentId = badge.documentId;
      if (!badge.documentId) {
        if (isMounted) setActivePlaybackDocument(null);
        return;
      }
      const currentRequestId = ++requestId;
      void bookRepository.getBookById(badge.documentId).then((storedDocument) => {
        if (isMounted && currentRequestId === requestId) setActivePlaybackDocument(storedDocument);
      });
    };

    syncPlayback(documentAudioPlaybackService.getSnapshot());
    const unsubscribe = documentAudioPlaybackService.subscribe(syncPlayback);
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // Agregar una carpeta entera desde el Inicio: el mismo selector del sistema
  // que usa Ajustes. Antes esto solo se podía desde Ajustes, y es lo primero
  // que querés hacer con la app recién instalada.
  const handleAddFolder = useCallback(async () => {
    const folderUri = await requestLibraryFolder();
    if (!folderUri) return;
    if (settings.libraryFolders.includes(folderUri)) {
      Alert.alert('Esa carpeta ya está', 'Ya la tenías agregada; si faltan libros, tirá para abajo para escanear de nuevo.');
      return;
    }
    await updateSettings({ libraryFolders: [...settings.libraryFolders, folderUri] });
  }, [settings.libraryFolders, updateSettings]);

  const handleSetStatus = useCallback(async (book: Book, status: BookStatus) => {
    await bookRepository.setStatus(book.id, status);
    setRecentDocuments((prev) => prev.map((b) => (b.id === book.id ? { ...b, status } : b)));
  }, []);

  /**
   * Abre el modo de acomodar con el tramo al que pertenece ese libro.
   *
   * Se acomoda la subcarpeta, no la carpeta entera: es donde el orden tiene
   * sentido, y evita poner 95 libros en una sola lista para mover uno.
   */
  const abrirReordenar = useCallback((book: Book) => {
    for (const section of librarySections.sections) {
      for (const group of section.groups) {
        if (!group.books.some((b) => b.id === book.id)) continue;
        const nombre = group.path === '' ? section.name : `${section.name} / ${formatSubfolderLabel(group.path)}`;
        setReordering({ title: nombre, books: group.books });
        return;
      }
    }
    if (librarySections.ungrouped.some((b) => b.id === book.id)) {
      setReordering({ title: 'otros libros', books: librarySections.ungrouped });
    }
  }, [librarySections]);

  const guardarOrden = useCallback(async (ordered: Book[]) => {
    setReordering(null);
    const entries = buildOrderEntries(ordered);
    await bookRepository.setOrder(entries);
    const porId = new Map(entries.map((e) => [e.id, e.orderIndex]));
    setRecentDocuments((prev) => prev.map((b) => {
      const nuevo = porId.get(b.id);
      return nuevo === undefined ? b : { ...b, orderIndex: nuevo };
    }));
    // Sin el modo "El mío" activo, el trabajo que acabás de hacer no se vería.
    if (settings.librarySort !== 'manual') await updateSettings({ librarySort: 'manual' });
  }, [settings.librarySort, updateSettings]);

  const handleRename = useCallback(async () => {
    const pendiente = renaming;
    if (!pendiente) return;
    setRenaming(null);
    const nuevo = pendiente.value.trim();
    // Vacío = volver al nombre del archivo.
    const title = nuevo.length > 0 ? nuevo : null;
    await bookRepository.setTitle(pendiente.book.id, title);
    setRecentDocuments((prev) => prev.map((b) => (b.id === pendiente.book.id ? { ...b, title } : b)));
    setLastOpenedDocument((prev) => (prev && prev.id === pendiente.book.id ? { ...prev, title } : prev));
  }, [renaming]);

  const handleOpenDocument = useCallback(async () => {
    setIsImporting(true);
    try {
      const picked = await filePickerService.pickDocument();
      if (!picked) return;
      // Importarlo a mano anula un borrado previo del mismo contenido.
      await clearIgnoredBook(picked.book.id);
      // Un libro que ya estaba no se vuelve a guardar: pisaba lastOpenedAt y
      // anulaba el color de tapa.
      if (!picked.alreadyInLibrary) await bookRepository.saveBook(picked.book);
      openReader(picked.book.id);
    } catch (error) {
      Alert.alert(
        'No se pudo abrir el archivo',
        error instanceof Error ? error.message : 'Elegí otro archivo e intentá de nuevo.',
      );
    } finally {
      setIsImporting(false);
    }
  }, [openReader]);

  const confirmDeleteDocument = useCallback(
    (document: Book) => {
      Alert.alert(
        'Eliminar libro',
        'Se borrará de recientes, junto con su progreso y el audio generado.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Eliminar',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  if (playback.documentId === document.id) {
                    await documentAudioPlaybackService.stopAndUnload();
                  }
                  await clearBookAudio(document.id);
                  await clearBookPages(document.id);
                  await removeBookCover(document.id);
                  await filePickerService.deleteStoredDocument(document.uri);
                  // Si el archivo sigue en una carpeta escaneada, que el
                  // próximo escaneo no lo vuelva a agregar solo.
                  // Sólo si el archivo es del usuario (content://): un libro
                  // importado a mano ya se borró del disco y no hay nada que
                  // ignorar; contarlo dejaba "1 oculto" para siempre.
                  if (document.uri.startsWith('content://')) await addIgnoredBook(document.id);
                  await bookRepository.removeBook(document.id);
                  await loadRecentDocuments();
                } catch (error) {
                  Alert.alert(
                    'No se pudo eliminar',
                    error instanceof Error ? error.message : 'No se pudo limpiar el libro local.',
                  );
                }
              })();
            },
          },
        ],
      );
    },
    [loadRecentDocuments, playback.documentId],
  );

  const pendingProgress = pendingBook ? (progressMap.get(pendingBook.id) ?? 0) : 0;

  // También con el libro cargado en pausa ("Listo para seguir"): después de un
  // reinicio la escucha se restaura así, y desde acá se reanuda con un toque.
  const playbackCardVisible = Boolean(
    activePlaybackDocument && (playback.isPlaying || playback.isPreparing || playback.isLoaded),
  );

  const playbackStatusLabel = useMemo(() => {
    if (playback.isPreparing) return 'Preparando audio';
    if (playback.isPlaying) return 'Reproduciendo ahora';
    return 'Listo para seguir';
  }, [playback.isPlaying, playback.isPreparing]);

  // El color de la tapa de "Seguir leyendo": se calcula UNA vez por tapa (en
  // nativo, sobre una miniatura) y queda guardado; después es leer un campo.
  const coverColorPendingId = lastOpenedDocument && lastOpenedDocument.coverUri && lastOpenedDocument.coverColor == null
    ? lastOpenedDocument.id
    : null;
  useEffect(() => {
    if (!coverColorPendingId || !lastOpenedDocument?.coverUri || !isBardoPdfAvailable()) return;
    let vivo = true;
    const coverUri = lastOpenedDocument.coverUri;
    void getBardoPdfModule()
      .coverColorAsync(coverUri)
      .then(async (color) => {
        const valor = color ?? NO_COVER_COLOR;
        await bookRepository.setCoverColor(coverColorPendingId, valor);
        if (!vivo) return;
        setLastOpenedDocument((previous) =>
          previous && previous.id === coverColorPendingId && previous.coverUri === coverUri ? { ...previous, coverColor: valor } : previous,
        );
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [coverColorPendingId, lastOpenedDocument?.coverUri]);
  const continueTint = useMemo(
    () => coverTint(lastOpenedDocument?.coverColor, colors, settings.darkMode),
    [lastOpenedDocument?.coverColor, colors, settings.darkMode],
  );

  const continueProgress = lastOpenedDocument ? (progressMap.get(lastOpenedDocument.id) ?? 0) : 0;
  // Cuánto falta del libro de la tarjeta. Se pide el tamaño de ESE libro nada
  // más (una consulta liviana), no el de toda la biblioteca.
  // Un cómic son imágenes, y un PDF escaneado no tiene texto: en los dos casos
  // ofrecer "Escuchar" llevaba a un lector con la voz deshabilitada.
  const continueCanNarrate = Boolean(
    lastOpenedDocument &&
      !isComicFile(lastOpenedDocument.type, lastOpenedDocument.name) &&
      (continueSize.textLength === null ||
        continueSize.textLength > (continueSize.pageCount ?? 1) * 100),
  );
  const continueRemaining = lastOpenedDocument
    ? remainingLabel({
        textLength: continueSize.textLength,
        pageCount: continueSize.pageCount,
        percentage: continueProgress,
        isComic: isComicFile(lastOpenedDocument.type, lastOpenedDocument.name),
      })
    : null;
  const libraryCountLabel =
    libraryFilter === 'all' && !searchQuery.trim()
      ? `${recentDocuments.length} libro${recentDocuments.length === 1 ? '' : 's'}`
      : `${filteredDocuments.length} de ${recentDocuments.length}`;

  // La biblioteca como FILAS: una por cabecera de carpeta y una por cada terna
  // de libros. Antes se montaban TODOS los libros de una, con su tapa
  // decodificada: con 100 libros son ~800 vistas y decenas de MB de imágenes
  // en el primer dibujado del Inicio.
  const libraryRows = useMemo<LibraryRow[]>(() => {
    const rows: LibraryRow[] = [];
    // En lista va un libro por fila; en grilla, tres. La virtualización es la
    // misma: cambia sólo de a cuántos se agrupan.
    const porFila = settings.libraryLayout === 'list' ? 1 : LIBRARY_COLUMNS;
    const pushBooks = (books: Book[], prefix: string) => {
      for (let i = 0; i < books.length; i += porFila) {
        const slice = books.slice(i, i + porFila);
        rows.push({ kind: 'books', key: `${prefix}-${slice[0].id}`, books: slice });
      }
    };
    // Ordenando por autor, la biblioteca se agrupa POR AUTOR (no por carpeta):
    // es lo que se espera al elegir ese orden, y deja ver de un vistazo todo lo
    // que tenés de cada uno.
    if (settings.librarySort === 'author') {
      let currentAuthor: string | null = null;
      let pendingBooks: Book[] = [];
      const flush = () => {
        if (pendingBooks.length > 0) pushBooks(pendingBooks, `a-${currentAuthor ?? 'sin'}`);
        pendingBooks = [];
      };
      for (const book of filteredDocuments) {
        const author = book.author?.trim() || SIN_AUTOR;
        if (author !== currentAuthor) {
          flush();
          currentAuthor = author;
          rows.push({ kind: 'subtitle', key: `au-${author}`, text: author.toUpperCase() });
        }
        pendingBooks.push(book);
      }
      flush();
      return rows;
    }

    for (const section of librarySections.sections) {
      rows.push({ kind: 'folder', key: `f-${section.folderUri}`, section });
      if (!(expandedFolders[section.folderUri] ?? true)) continue;
      // Con una sola subcarpeta (o ninguna) no hay nada que separar: poner una
      // cabecera sola arriba de todo seria ruido.
      if (section.groups.length <= 1) {
        pushBooks(section.books, section.folderUri);
        continue;
      }
      for (const group of section.groups) {
        const subKey = `${section.folderUri}#${group.path}`;
        if (group.path !== '') {
          rows.push({
            kind: 'subfolder',
            key: `s-${subKey}`,
            folderUri: section.folderUri,
            path: group.path,
            count: group.books.length,
          });
        }
        if (expandedFolders[subKey] ?? true) pushBooks(group.books, subKey);
      }
    }
    if (librarySections.ungrouped.length > 0) {
      if (librarySections.sections.length > 0) {
        rows.push({ kind: 'subtitle', key: 'otros', text: 'OTROS LIBROS' });
      }
      pushBooks(librarySections.ungrouped, 'sueltos');
    }
    return rows;
  }, [librarySections, expandedFolders, settings.librarySort, settings.libraryLayout, filteredDocuments]);

  const renderLibraryRow = useCallback(
    ({ item }: { item: LibraryRow }) => {
      if (item.kind === 'subtitle') {
        return <Text style={[styles.subsectionTitle, { color: colors.textMuted }]}>{item.text}</Text>;
      }
      if (item.kind === 'subfolder') {
        const subKey = `${item.folderUri}#${item.path}`;
        const expanded = expandedFolders[subKey] ?? true;
        return (
          <Pressable
            onPress={() => setExpandedFolders((prev) => ({ ...prev, [subKey]: !expanded }))}
            style={styles.subfolderHeader}
            accessibilityRole="button"
            accessibilityLabel={`Subcarpeta ${item.path}, ${item.count} libros`}
          >
            <Icon name="folder-open-outline" size={15} color={colors.textMuted} />
            <Text style={[styles.subfolderName, { color: colors.text }]} numberOfLines={1}>
              {formatSubfolderLabel(item.path)}
            </Text>
            <Text style={[styles.folderCount, { color: colors.textMuted }]}>{item.count}</Text>
            <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={colors.textMuted} />
          </Pressable>
        );
      }
      if (item.kind === 'folder') {
        const expanded = expandedFolders[item.section.folderUri] ?? true;
        return (
          <Pressable
            onPress={() => setExpandedFolders((prev) => ({ ...prev, [item.section.folderUri]: !expanded }))}
            style={[styles.folderHeader, { backgroundColor: colors.surface, borderColor: colors.border }]}
            accessibilityRole="button"
          >
            <Icon name="folder-outline" size={18} color={colors.primary} />
            <Text style={[styles.folderName, { color: colors.text }]} numberOfLines={1}>
              {item.section.name}
            </Text>
            <Text style={[styles.folderCount, { color: colors.textMuted }]}>{item.section.books.length}</Text>
            <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
          </Pressable>
        );
      }
      return (
        <View style={settings.libraryLayout === 'list' ? styles.listRow : styles.grid}>
          {item.books.map((document) =>
            settings.libraryLayout === 'list' ? (
              <BookListItem
                key={document.id}
                book={document}
                colors={colors}
                progress={progressMap.get(document.id)}
                onOpen={handleOpenBook}
                onLongPress={openChooser}
              />
            ) : (
              <BookGridItem
                key={document.id}
                book={document}
                colors={colors}
                progress={progressMap.get(document.id)}
                onOpen={handleOpenBook}
                onLongPress={openChooser}
              />
            ),
          )}
        </View>
      );
    },
    [colors, expandedFolders, progressMap, handleOpenBook, openChooser, settings.libraryLayout],
  );
  return (
    <Screen
      colors={colors}
      floating={
        <Pressable
          onPress={() => setIsAddPickerVisible(true)}
          disabled={isImporting}
          accessibilityRole="button"
          accessibilityLabel="Agregar libros"
          style={({ pressed }) => [styles.fab, { backgroundColor: colors.primary, opacity: isImporting ? 0.6 : pressed ? 0.85 : 1 }]}
        >
          {isImporting ? <ActivityIndicator color={colors.primaryText} /> : <Icon name="add" size={30} color={colors.primaryText} />}
        </Pressable>
      }
    >
      <Stack.Screen options={{ headerShown: false }} />

      <FlatList
        data={libraryRows}
        keyExtractor={(row) => row.key}
        renderItem={renderLibraryRow}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => { void handleRefresh(); }}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface}
            tintColor={colors.primary}
          />
        }
        // Sin getItemLayout a propósito: el título ocupa una o dos líneas, así
        // que la altura de una fila no es fija. La virtualización igual funciona;
        // lo único que se pierde es saltar a un índice, que acá no se usa.
        removeClippedSubviews
        initialNumToRender={6}
        windowSize={7}
        ListHeaderComponent={
          // Un ELEMENTO, no un componente: pasar una función definida acá adentro
          // vuelve a montar la cabecera en cada render y el campo de búsqueda
          // perdería el foco a la primera letra.
          <View style={styles.listHeader}>
            {/* Cabecera propia: marca a la izquierda, ajustes a la derecha. */}
            <View style={styles.header}>
              <View style={styles.brand}>
                {/* Miniatura del ícono de la app ("b." sobre vidrio): la misma marca que en el launcher. */}
                <Image source={require('../assets/brand-mark.png')} style={styles.brandMark} contentFit="contain" />
                <Text style={[styles.brandTitle, { color: colors.text }]}>Bardo</Text>
              </View>
              <View style={styles.headerActions}>
                {recentDocuments.length > 0 ? (
                  <IconButton
                    name={isSearchOpen ? 'close' : 'search-outline'}
                    label={isSearchOpen ? 'Cerrar búsqueda' : 'Buscar en la biblioteca'}
                    onPress={() => {
                      if (isSearchOpen) setSearchQuery('');
                      setIsSearchOpen((open) => !open);
                    }}
                    colors={colors}
                    variant="tonal"
                    active={isSearchOpen}
                    size={22}
                  />
                ) : null}
                <IconButton name="settings-outline" label="Ajustes" onPress={() => router.push('/settings')} colors={colors} variant="tonal" size={22} />
              </View>
            </View>

            {isSearchOpen ? (
              <View style={[styles.searchField, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
                <Icon name="search-outline" size={18} color={colors.textMuted} />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Título, autor o archivo"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                  returnKeyType="search"
                  style={[styles.searchInput, { color: colors.text }]}
                />
                {searchQuery ? (
                  <IconButton name="backspace-outline" label="Borrar búsqueda" onPress={() => setSearchQuery('')} colors={colors} size={20} />
                ) : null}
              </View>
            ) : null}

            {playbackCardVisible && activePlaybackDocument ? (
              <Pressable
                onPress={() => openReader(activePlaybackDocument.id)}
                style={[styles.nowPlaying, { backgroundColor: colors.primary }]}
                accessibilityRole="button"
                accessibilityLabel="Volver al libro que suena"
              >
                <Icon name={playback.isPreparing ? 'hourglass-outline' : 'volume-high'} size={20} color={colors.primaryText} />
                <View style={styles.nowPlayingText}>
                  <Text style={[styles.nowPlayingLabel, { color: colors.primaryText }]}>{playbackStatusLabel}</Text>
                  <Text style={[styles.nowPlayingTitle, { color: colors.primaryText }]} numberOfLines={1}>
                    {getDisplayTitle(activePlaybackDocument)}
                  </Text>
                </View>
                {!playback.isPreparing ? (
                  <Pressable
                    onPress={() => {
                      void (playback.isPlaying ? documentAudioPlaybackService.pause() : documentAudioPlaybackService.resume()).catch(() => {});
                    }}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={playback.isPlaying ? 'Pausar la voz' : 'Seguir escuchando'}
                    style={styles.nowPlayingStop}
                  >
                    <Icon name={playback.isPlaying ? 'pause' : 'play'} size={20} color={colors.primaryText} />
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => { void documentAudioPlaybackService.stopAndUnload().catch(() => {}); }}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Detener la voz"
                  style={styles.nowPlayingStop}
                >
                  <Icon name="stop" size={20} color={colors.primaryText} />
                </Pressable>
              </Pressable>
            ) : null}

            {lastOpenedDocument ? (
              <View style={[styles.continueCard, { backgroundColor: continueTint?.background ?? colors.surface, borderColor: continueTint?.border ?? colors.border }]}>
                <Pressable onPress={() => openReader(lastOpenedDocument.id)} style={styles.continueBody} accessibilityRole="button">
                  {lastOpenedDocument.coverUri ? (
                    <Image source={{ uri: lastOpenedDocument.coverUri }} style={styles.continueCover} contentFit="cover" />
                  ) : (
                    <View style={[styles.continueCover, { backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }]}>
                      <Icon name="book-outline" size={26} color={colors.primary} />
                    </View>
                  )}
                  <View style={styles.continueText}>
                    <Text style={[styles.eyebrow, { color: colors.primary }]}>SEGUIR LEYENDO</Text>
                    <Text style={[styles.continueTitle, { color: colors.text }]} numberOfLines={2}>
                      {getDisplayTitle(lastOpenedDocument)}
                    </Text>
                    {lastOpenedDocument.author ? (
                      <Text style={[styles.continueAuthor, { color: colors.textMuted }]} numberOfLines={1}>
                        {lastOpenedDocument.author}
                      </Text>
                    ) : null}
                    <View style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}>
                      <View style={[styles.progressFill, { backgroundColor: colors.warm, width: `${Math.min(Math.max(continueProgress, 2), 100)}%` }]} />
                    </View>
                    <Text style={[styles.progressLabel, { color: colors.textMuted }]}>
                      {continueProgress > 0 ? `${Math.max(1, Math.round(continueProgress))} % leído` : 'Sin empezar'} · {getDocumentTypeLabel(lastOpenedDocument.type)}
                {continueRemaining ? ` · te faltan ${continueRemaining}` : ''}
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.continueActions}>
                  <AppButton label="Continuar" icon="book-outline" onPress={() => openReader(lastOpenedDocument.id)} colors={colors} compact style={styles.continueButton} />
                  {/* Sin texto no hay nada que narrar: un cómic, o un PDF escaneado. */}
                  {continueCanNarrate ? (
                    <AppButton label="Escuchar" icon="headset-outline" onPress={() => openReader(lastOpenedDocument.id, false, 'listen')} variant="secondary" colors={colors} compact style={styles.continueButton} />
                  ) : null}
                </View>
              </View>
            ) : null}

            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Biblioteca</Text>
              <View style={styles.sectionActions}>
                {isLoading ? <ActivityIndicator color={colors.primary} /> : recentDocuments.length > 0 ? (
                  <Text style={[styles.sectionCount, { color: colors.textMuted }]}>{libraryCountLabel}</Text>
                ) : null}
                {recentDocuments.length > 1 ? (
                  <>
                    <IconButton
                      name={settings.libraryLayout === 'list' ? 'grid-outline' : 'list-outline'}
                      label={settings.libraryLayout === 'list' ? 'Ver como grilla' : 'Ver como lista'}
                      onPress={() => { void updateSettings({ libraryLayout: settings.libraryLayout === 'list' ? 'grid' : 'list' }); }}
                      colors={colors}
                      size={20}
                    />
                    <IconButton name="swap-vertical-outline" label="Ordenar la biblioteca" onPress={() => setIsSortPickerVisible(true)} colors={colors} size={20} />
                  </>
                ) : null}
              </View>
            </View>

            {recentDocuments.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                {BASE_FILTERS.map((filter) => (
                  <Chip
                    key={filter.value}
                    label={filter.label}
                    icon={filter.icon}
                    active={libraryFilter === filter.value}
                    onPress={() => setLibraryFilter(filter.value)}
                    colors={colors}
                  />
                ))}
                {collections.map((collection) => (
                  <Chip
                    key={collection.id}
                    label={collection.name}
                    icon="albums-outline"
                    active={libraryFilter === collection.id}
                    onPress={() => setLibraryFilter(collection.id)}
                    colors={colors}
                  />
                ))}
              </ScrollView>
            ) : null}

            {!isLoading && recentDocuments.length > 0 && filteredDocuments.length === 0 ? (
              <View style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Icon name={searchQuery.trim() ? 'search-outline' : 'albums-outline'} size={28} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  {searchQuery.trim() ? `Nada con "${searchQuery.trim()}"` : 'No hay libros en esta lista'}
                </Text>
                <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                  {searchQuery.trim()
                    ? 'Probá con otra palabra del título, el autor o el nombre del archivo.'
                    : 'Mantené apretado un libro y elegí "Sobre este libro" para sumarlo.'}
                </Text>
              </View>
            ) : null}

            {scanNotice ? (
              <View style={[styles.noticeBanner, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
                <Icon name="refresh-outline" size={18} color={colors.textMuted} />
                <Text style={[styles.hiddenBannerText, { color: colors.textMuted }]}>{scanNotice}</Text>
              </View>
            ) : null}

            {ignoredCount > 0 ? (
              <View style={[styles.hiddenBanner, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
                <Icon name="eye-off-outline" size={18} color={colors.textMuted} />
                <Text style={[styles.hiddenBannerText, { color: colors.textMuted }]}>
                  {ignoredCount} libro{ignoredCount === 1 ? '' : 's'} oculto{ignoredCount === 1 ? '' : 's'}
                </Text>
                <AppButton label="Restaurar" onPress={() => { void handleRestoreHidden(); }} variant="ghost" colors={colors} compact />
              </View>
            ) : null}

            {!isLoading && recentDocuments.length === 0 ? (
              <View style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
                  <Icon name="library-outline" size={30} color={colors.primary} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>Tu biblioteca está vacía</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                  Tocá + para abrir un PDF, EPUB, TXT, DOCX o un cómic. También podés elegir carpetas del teléfono en Ajustes para que los libros aparezcan solos.
                </Text>
                <AppButton label="Abrir un archivo" icon="add" onPress={() => { void handleOpenDocument(); }} disabled={isImporting} colors={colors} />
              </View>
            ) : null}

          </View>
        }
      />

      {/* Qué agregar: un archivo suelto o una carpeta entera. */}
      <OptionPickerModal
        title="Agregar a la biblioteca"
        visible={isAddPickerVisible}
        options={[
          {
            value: 'file',
            label: 'Un libro',
            icon: 'document-outline',
            description: 'Elegís un archivo y se abre al toque. PDF, EPUB, TXT, DOCX o cómic.',
          },
          {
            value: 'folder',
            label: 'Una carpeta',
            icon: 'folder-open-outline',
            description: 'Todo lo que haya adentro, con sus subcarpetas, aparece solo y se mantiene al día.',
          },
        ]}
        selectedValue=""
        colors={colors}
        onClose={() => setIsAddPickerVisible(false)}
        onSelect={(value) => {
          setIsAddPickerVisible(false);
          if (value === 'file') void handleOpenDocument();
          else void handleAddFolder();
        }}
      />

      <ReorderSheet
        visible={reordering !== null}
        title={reordering?.title ?? ''}
        books={reordering?.books ?? []}
        colors={colors}
        onCancel={() => setReordering(null)}
        onSave={(ordered) => { void guardarOrden(ordered); }}
      />

      {/* Renombrar: cambia el título que se ve, no el archivo. */}
      <Modal visible={renaming !== null} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable style={[styles.renameScrim, { backgroundColor: colors.scrim }]} onPress={() => setRenaming(null)}>
          <Pressable
            style={[styles.renameCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            <Text style={[styles.renameTitle, { color: colors.text }]}>Renombrar</Text>
            <Text style={[styles.renameHint, { color: colors.textMuted }]}>
              Cambia el título que muestra la biblioteca. El archivo del teléfono no se toca.
            </Text>
            <TextInput
              value={renaming?.value ?? ''}
              onChangeText={(value) => setRenaming((prev) => (prev ? { ...prev, value } : prev))}
              placeholder={renaming ? renaming.book.name : ''}
              placeholderTextColor={colors.textMuted}
              autoFocus
              selectTextOnFocus
              style={[styles.renameInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}
            />
            <View style={styles.renameActions}>
              <AppButton label="Cancelar" onPress={() => setRenaming(null)} variant="secondary" colors={colors} compact />
              <AppButton label="Guardar" icon="checkmark" onPress={() => { void handleRename(); }} colors={colors} compact />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <OptionPickerModal
        title="Ordenar por"
        visible={isSortPickerVisible}
        options={SORT_OPTIONS}
        selectedValue={settings.librarySort}
        colors={colors}
        onClose={() => setIsSortPickerVisible(false)}
        onSelect={(value) => {
          setIsSortPickerVisible(false);
          void updateSettings({ librarySort: value as LibrarySort });
        }}
      />

      <OptionPickerModal
        title={pendingBook ? getDisplayTitle(pendingBook) : '¿Cómo querés seguir?'}
        visible={pendingBook !== null}
        options={[
          {
            value: 'read',
            label: 'Leer',
            icon: 'book-outline',
            description: pendingProgress > 0 ? `Retoma en el ${pendingProgress.toFixed(0)} %.` : 'Empieza desde la primera página.',
          },
          // Un cómic son imágenes: no hay nada que narrar y la opción llevaba a un
          // lector con la voz deshabilitada.
          ...(pendingBook && isComicFile(pendingBook.type, pendingBook.name)
            ? []
            : [{
                value: 'listen',
                label: 'Escuchar',
                icon: 'headset-outline' as const,
                description: pendingProgress > 0 ? `La voz arranca en el ${pendingProgress.toFixed(0)} %.` : 'La voz arranca desde el principio.',
              }]),
          // Marcar leído/para leer funciona igual en libros y en cómics: es el
          // estado guardado, no depende de que haya texto que narrar.
          ...(pendingBook?.status === 'read'
            ? [{
                value: 'unread',
                label: 'Desmarcar como leído',
                icon: 'refresh-circle-outline' as const,
                description: 'Vuelve a quedar según tu progreso.',
              }]
            : [{
                value: 'mark_read',
                label: 'Marcar como leído',
                icon: 'checkmark-done-outline' as const,
                description: 'Lo manda al filtro "Leídos". No borra tu progreso.',
              }]),
          ...(pendingBook?.status === 'to_read'
            ? []
            : [{
                value: 'mark_to_read',
                label: 'Marcar para leer',
                icon: 'bookmark-outline' as const,
                description: 'Lo guarda en el filtro "Para leer".',
              }]),
          {
            value: 'reorder',
            label: 'Acomodar esta carpeta',
            icon: 'reorder-three-outline',
            description: 'Arrastrá los libros al orden que quieras. Se guarda.',
          },
          {
            value: 'rename',
            label: 'Renombrar',
            icon: 'create-outline',
            description: 'Cambia el título que se muestra, no el archivo del teléfono.',
          },
          {
            value: 'about',
            label: 'Sobre este libro',
            icon: 'information-circle-outline',
            description: 'Índice, anotaciones, listas, colecciones y reseña.',
          },
          ...(pendingProgress > 0
            ? [{
                value: 'restart',
                label: 'Empezar de nuevo',
                icon: 'refresh-outline' as const,
                description: 'Borra el progreso y arranca desde cero (pide confirmación).',
              }]
            : []),
          {
            value: 'delete',
            label: 'Eliminar de la biblioteca',
            icon: 'trash-outline',
            description: 'Borra el libro, su progreso y el audio generado (pide confirmación).',
            danger: true,
          },
        ]}
        selectedValue=""
        colors={colors}
        onClose={() => setPendingBook(null)}
        onSelect={(value) => {
          const book = pendingBook;
          if (!book) return;
          if (value === 'delete') {
            setPendingBook(null);
            confirmDeleteDocument(book);
            return;
          }
          if (value === 'about') {
            setPendingBook(null);
            router.push({ pathname: '/book', params: { bookId: book.id } });
            return;
          }
          if (value === 'mark_read' || value === 'unread' || value === 'mark_to_read') {
            setPendingBook(null);
            const estado: BookStatus = value === 'mark_read' ? 'read' : value === 'mark_to_read' ? 'to_read' : 'none';
            void handleSetStatus(book, estado);
            return;
          }
          if (value === 'rename') {
            setPendingBook(null);
            setRenaming({ book, value: book.title ?? getDisplayTitle(book) });
            return;
          }
          if (value === 'reorder') {
            setPendingBook(null);
            abrirReordenar(book);
            return;
          }
          if (value === 'restart') {
            Alert.alert(
              '¿Empezar de nuevo?',
              `Se borra tu progreso de "${book.title ?? book.name}" (${pendingProgress.toFixed(0)}%). Esto no se puede deshacer.`,
              [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Borrar progreso',
                  style: 'destructive',
                  onPress: () => {
                    setPendingBook(null);
                    void (async () => {
                      // Si ese libro está sonando, el reproductor volvería a
                      // guardar su posición en el próximo tick: primero se para.
                      if (playback.documentId === book.id) await documentAudioPlaybackService.stopAndUnload();
                      await bookProgressRepository.resetProgress(book.id);
                      await loadRecentDocuments();
                    })();
                  },
                },
              ],
            );
            return;
          }
          setPendingBook(null);
          openReader(book.id, false, value as 'read' | 'listen');
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchField: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderRadius: radius.md, paddingLeft: 12, paddingRight: 4 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 15 },
  sectionActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 34, height: 34 },
  // Wordmark en Lora Bold (embebida por el plugin expo-font de app.json; en Android la familia es el
  // nombre del archivo). Sin fontWeight: con una fuente propia, Android sintetizaría otra negrita encima.
  brandTitle: { fontSize: 28, fontFamily: 'Lora-Bold', letterSpacing: -0.3 },
  renameScrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  renameCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 10,
  },
  renameTitle: { fontSize: 18, fontWeight: '800' },
  renameHint: { fontSize: 13, lineHeight: 18 },
  renameInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  renameActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 2 },
  fab: {
    width: 60,
    height: 60,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  nowPlaying: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 12 },
  nowPlayingText: { flex: 1 },
  nowPlayingLabel: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.85 },
  nowPlayingTitle: { fontSize: 15, fontWeight: '700' },
  nowPlayingStop: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  continueCard: { borderWidth: 1, borderRadius: radius.xl, padding: 14, gap: 12 },
  continueBody: { flexDirection: 'row', gap: 14 },
  continueCover: { width: 78, height: 112, borderRadius: 10, overflow: 'hidden' },
  continueText: { flex: 1, gap: 4, justifyContent: 'center' },
  eyebrow: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8 },
  continueTitle: { fontSize: 18, fontWeight: '800', lineHeight: 23 },
  continueAuthor: { fontSize: 13.5 },
  progressTrack: { height: 6, borderRadius: 999, overflow: 'hidden', marginTop: 4 },
  progressFill: { height: '100%', borderRadius: 999 },
  progressLabel: { fontSize: 12.5 },
  continueActions: { flexDirection: 'row', gap: 10 },
  continueButton: { flex: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { fontSize: 21, fontWeight: '800', letterSpacing: -0.3 },
  sectionCount: { fontSize: 13, fontWeight: '600' },
  subsectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  filterRow: { gap: 8, paddingVertical: 2 },
  emptyState: { borderWidth: 1, borderRadius: radius.xl, padding: 22, gap: 10, alignItems: 'center' },
  emptyIcon: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptySubtitle: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  folderGroup: { gap: 12 },
  listContent: { padding: 20, paddingBottom: 96, gap: 12 },
  listHeader: { gap: 18 },
  // En lista cada fila trae un solo libro y ocupa todo el ancho.
  listRow: { marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, rowGap: 16 },
  hiddenBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.md, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
  hiddenBannerText: { flex: 1, fontSize: 13 },
  noticeBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10 },
  folderHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12 },
  folderName: { flex: 1, fontSize: 15, fontWeight: '700' },
  // La subcarpeta va un escalón más abajo que la carpeta: sin recuadro, con
  // sangría, para que se lea como "adentro de".
  subfolderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 6,
  },
  subfolderName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  folderCount: { fontSize: 12.5, fontWeight: '600' },
});
