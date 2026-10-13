// The uploads in progress, kept apart from upload.ts so the outliner can hold them.

/** A file on its way to the server. */
export interface Upload {
  name: string;
  /** Bytes sent so far, and in all. */
  loaded: number;
  total: number;
}

/** The uploads in progress, for the progress bar. Leaving the page while there are any asks first. */
export class Uploads {
  #list: Upload[] = [];
  #listeners = new Set<() => void>();
  readonly #onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();

  get list(): readonly Upload[] {
    return this.#list;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  add(upload: Upload): void {
    if (this.#list.length === 0) window.addEventListener("beforeunload", this.#onBeforeUnload);
    this.#set([...this.#list, upload]);
  }

  update(upload: Upload, loaded: number): void {
    this.#set(this.#list.map((u) => (u === upload ? Object.assign(upload, { loaded }) : u)));
  }

  remove(upload: Upload): void {
    this.#set(this.#list.filter((u) => u !== upload));
    if (this.#list.length === 0) window.removeEventListener("beforeunload", this.#onBeforeUnload);
  }

  #set(list: Upload[]): void {
    this.#list = list;
    for (const l of this.#listeners) l();
  }
}
