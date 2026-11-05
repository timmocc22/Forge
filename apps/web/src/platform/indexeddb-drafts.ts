import type { DraftStore } from '@studio/plugin-sdk';
export interface DraftStoreOptions {
  database: string;
  version: number;
  store: string;
  namespace: string;
  sessionId: string;
}
/** Lazy connection adapter: creating/importing the service never accesses browser storage. */
export class IndexedDbDraftStore<T> implements DraftStore<T> {
  private database?: Promise<IDBDatabase>;
  constructor(
    private readonly options: DraftStoreOptions,
    private readonly factory: () => IDBFactory,
    private readonly decode: (value: unknown) => T,
  ) {}
  private open() {
    if (this.database) return this.database;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let rejected = false;
      const fail = (message: string) => {
        rejected = true;
        reject(new Error(message));
      };
      const request = this.factory().open(this.options.database, this.options.version);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.options.store))
          request.result.createObjectStore(this.options.store);
      };
      request.onsuccess = () => {
        const db = request.result;
        if (rejected) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          this.database = undefined;
        };
        resolve(db);
      };
      request.onerror = () => fail('无法打开本地草稿，请导出备份');
      request.onblocked = () => fail('本地草稿数据库被其他窗口占用');
    });
    this.database = opening;
    void opening.catch(() => {
      if (this.database === opening) this.database = undefined;
    });
    return opening;
  }
  private key(id: string) {
    return `${this.options.namespace}:${id}:${this.options.sessionId}`;
  }
  private async transact<R>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<R>,
  ): Promise<R> {
    const db = await this.open();
    return new Promise<R>((resolve, reject) => {
      const tx = db.transaction(this.options.store, mode),
        request = action(tx.objectStore(this.options.store));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error('本地草稿事务失败，请导出备份'));
    });
  }
  async read(id: string) {
    const value: unknown = await this.transact('readonly', (store) => store.get(this.key(id)));
    return value === undefined ? undefined : this.decode(value);
  }
  async write(id: string, draft: T) {
    await this.transact('readwrite', (store) => store.put(structuredClone(draft), this.key(id)));
  }
  async remove(id: string) {
    await this.transact('readwrite', (store) => store.delete(this.key(id)));
  }
  async close() {
    const database = this.database;
    this.database = undefined;
    if (database) {
      try {
        (await database).close();
      } catch {
        /* Failed connections are already diagnosed by the caller. */
      }
    }
  }
}
