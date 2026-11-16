/**
 * The IndexedDB backend for the store (ADR 0009). One database, `enlighten`. Version 1 has the
 * `preferences` store, which also holds set-aside records under their own keys. Later stages add
 * their stores with a version bump. Everything read here is checked by `src/store` before use.
 */
import type { Backend } from '../store/store.ts';

const DB = 'enlighten';
const VERSION = 1;
const STORE = 'preferences';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => {
      resolve(r.result);
    };
    r.onerror = () => {
      reject(r.error ?? new Error('IndexedDB request failed.'));
    };
  });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    r.onsuccess = () => {
      resolve(r.result);
    };
    r.onerror = () => {
      reject(r.error ?? new Error('IndexedDB could not be opened.'));
    };
    r.onblocked = () => {
      reject(new Error('IndexedDB is blocked by another tab.'));
    };
  });
}

export class IdbBackend implements Backend {
  private db: Promise<IDBDatabase> | undefined;

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    this.db ??= open();
    const db = await this.db;
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  async get(key: string): Promise<unknown> {
    return request((await this.store('readonly')).get(key));
  }

  async put(key: string, value: unknown): Promise<void> {
    await request((await this.store('readwrite')).put(value, key));
  }

  async keys(): Promise<string[]> {
    const all = await request((await this.store('readonly')).getAllKeys());
    return all.filter((k): k is string => typeof k === 'string');
  }

  async delete(key: string): Promise<void> {
    await request((await this.store('readwrite')).delete(key));
  }
}
