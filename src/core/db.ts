import type { AppDB, Plan, Settings, TreeRecord } from './types';

const DB_NAME = 'bonsai-studio-db';
const DB_VERSION = 1;
const STORE = 'kv';
const KEY_TREES = 'trees';
const KEY_PLANS = 'plans';
const KEY_SETTINGS = 'settings';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  defaultWireMaterial: 'aluminum',
  contactGapLimit: 0.1,
  showHelpers: true,
  quality: 'balanced',
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function get<T>(key: string, fallback: T): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as T) ?? fallback);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export const storage = {
  async loadAll(): Promise<AppDB> {
    const [trees, plans, settings] = await Promise.all([
      get<TreeRecord[]>(KEY_TREES, []),
      get<Plan[]>(KEY_PLANS, []),
      get<Settings>(KEY_SETTINGS, DEFAULT_SETTINGS),
    ]);
    return { trees, plans, settings };
  },
  saveTrees(trees: TreeRecord[]): Promise<void> {
    return put(KEY_TREES, trees);
  },
  savePlans(plans: Plan[]): Promise<void> {
    return put(KEY_PLANS, plans);
  },
  saveSettings(settings: Settings): Promise<void> {
    return put(KEY_SETTINGS, settings);
  },
  async exportJSON(): Promise<string> {
    const all = await this.loadAll();
    return JSON.stringify(all, null, 2);
  },
  async importJSON(text: string): Promise<AppDB> {
    const data = JSON.parse(text) as AppDB;
    await this.saveTrees(data.trees ?? []);
    await this.savePlans(data.plans ?? []);
    if (data.settings) await this.saveSettings(data.settings);
    return data;
  },
};
