import type { AnimationProject } from "@nanoleaf-jazz/shared";

const DATABASE_NAME = "nanoleaf-jazz";
const DATABASE_VERSION = 2;
const PROJECT_STORE_NAME = "projects";
const SETTINGS_STORE_NAME = "settings";
const RECENT_PAINTS_KEY = "recent-paints";

export type StoredPaintSwatch = {
  color: string;
  brightness: number;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE_NAME)) {
        database.createObjectStore(PROJECT_STORE_NAME, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
        database.createObjectStore(SETTINGS_STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    handler(store, resolve, reject);
  });
}

export function listProjects(): Promise<AnimationProject[]> {
  return runTransaction(PROJECT_STORE_NAME, "readonly", (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as AnimationProject[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    request.onerror = () => reject(request.error);
  });
}

export function saveProject(project: AnimationProject): Promise<void> {
  return runTransaction(PROJECT_STORE_NAME, "readwrite", (store, resolve, reject) => {
    const request = store.put(project);
    request.onsuccess = () => resolve(undefined);
    request.onerror = () => reject(request.error);
  });
}

export function deleteProject(projectId: string): Promise<void> {
  return runTransaction(PROJECT_STORE_NAME, "readwrite", (store, resolve, reject) => {
    const request = store.delete(projectId);
    request.onsuccess = () => resolve(undefined);
    request.onerror = () => reject(request.error);
  });
}

export function loadRecentPaints(): Promise<StoredPaintSwatch[] | null> {
  return runTransaction(SETTINGS_STORE_NAME, "readonly", (store, resolve, reject) => {
    const request = store.get(RECENT_PAINTS_KEY);
    request.onsuccess = () => {
      const result = request.result as { key: string; value?: StoredPaintSwatch[] } | undefined;
      resolve(result?.value ?? null);
    };
    request.onerror = () => reject(request.error);
  });
}

export function saveRecentPaints(swatches: StoredPaintSwatch[]): Promise<void> {
  return runTransaction(SETTINGS_STORE_NAME, "readwrite", (store, resolve, reject) => {
    const request = store.put({
      key: RECENT_PAINTS_KEY,
      value: swatches
    });
    request.onsuccess = () => resolve(undefined);
    request.onerror = () => reject(request.error);
  });
}
