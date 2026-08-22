const DATABASE_NAME = 'gom_operation_pdf_folders';
const STORE_NAME = 'folders';

interface WritableDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker(options: { mode: 'readwrite' }): Promise<WritableDirectoryHandle>;
}

export interface OperationPdfFolder {
  operationId: string;
  name: string;
  handle: WritableDirectoryHandle;
}

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'operationId' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const runRequest = <T,>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) =>
  openDatabase().then(database => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  }));

export const supportsOperationPdfFolders = () => 'showDirectoryPicker' in window;
export const getAllOperationPdfFolders = () => runRequest<OperationPdfFolder[]>('readonly', store => store.getAll());
export const saveOperationPdfFolder = (folder: OperationPdfFolder) => runRequest<IDBValidKey>('readwrite', store => store.put(folder));

export const pickOperationPdfFolder = async (operationId: string) => {
  if (!supportsOperationPdfFolders()) throw new Error('UNSUPPORTED');
  // The picker `id` has a strict 32-character limit in Chromium. Operation IDs
  // can be longer, so folder ownership is kept only in IndexedDB below.
  const handle = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({ mode: 'readwrite' });
  const folder = { operationId, name: handle.name, handle };
  await saveOperationPdfFolder(folder);
  return folder;
};

export const writePdfToOperationFolder = async (folder: OperationPdfFolder, fileName: string, blob: Blob) => {
  const permission = await folder.handle.queryPermission({ mode: 'readwrite' });
  const granted = permission === 'granted' || await folder.handle.requestPermission({ mode: 'readwrite' }) === 'granted';
  if (!granted) throw new Error('PERMISSION_DENIED');
  const fileHandle = await folder.handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
};
