const DATABASE_NAME = 'gom_operation_pdf_folders';
const STORE_NAME = 'folders';

interface WritableDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  removeEntry(name: string): Promise<void>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker(options: { mode: 'readwrite'; id?: string }): Promise<WritableDirectoryHandle>;
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

const isDirectoryHandle = (value: unknown): value is WritableDirectoryHandle => {
  const handle = value as Partial<WritableDirectoryHandle> | undefined;
  return Boolean(handle && handle.kind === 'directory' && typeof handle.getFileHandle === 'function');
};

const pickerIdForOperation = (operationId: string) => {
  let hash = 2166136261;
  for (const character of operationId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `gom-pdf-${(hash >>> 0).toString(36)}`;
};

const ensureWritePermission = async (handle: WritableDirectoryHandle) => {
  const currentPermission = await handle.queryPermission({ mode: 'readwrite' });
  if (currentPermission === 'granted') return;
  const requestedPermission = await handle.requestPermission({ mode: 'readwrite' });
  if (requestedPermission !== 'granted') throw new Error('PERMISSION_DENIED');
};

export const supportsOperationPdfFolders = () =>
  window.isSecureContext && typeof (window as unknown as Partial<DirectoryPickerWindow>).showDirectoryPicker === 'function';

export const getAllOperationPdfFolders = async () => {
  const folders = await runRequest<OperationPdfFolder[]>('readonly', store => store.getAll());
  return folders.filter(folder => folder?.operationId && isDirectoryHandle(folder.handle));
};
export const saveOperationPdfFolder = (folder: OperationPdfFolder) => runRequest<IDBValidKey>('readwrite', store => store.put(folder));

export const pickOperationPdfFolder = async (operationId: string) => {
  if (!supportsOperationPdfFolders()) throw new Error('UNSUPPORTED');
  // A short stable id lets Chromium remember the last folder used by each
  // operation without exceeding the API's 32-character limit.
  const handle = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
    mode: 'readwrite',
    id: pickerIdForOperation(operationId),
  });
  await ensureWritePermission(handle);
  const folder = { operationId, name: handle.name, handle };
  await saveOperationPdfFolder(folder);
  return folder;
};

export const verifyOperationPdfFolder = async (folder: OperationPdfFolder) => {
  await ensureWritePermission(folder.handle);
  const testFileName = `.gom-pdf-${Date.now()}.tmp`;
  const fileHandle = await folder.handle.getFileHandle(testFileName, { create: true });
  const writer = await fileHandle.createWritable();
  await writer.write(new Blob(['ok'], { type: 'text/plain' }));
  await writer.close();
  await folder.handle.removeEntry(testFileName);
};

export const createOperationPdfWriter = async (folder: OperationPdfFolder, fileName: string) => {
  if (!isDirectoryHandle(folder.handle)) throw new Error('INVALID_DIRECTORY_HANDLE');
  await ensureWritePermission(folder.handle);
  const fileHandle = await folder.handle.getFileHandle(fileName, { create: true });
  return fileHandle.createWritable();
};
