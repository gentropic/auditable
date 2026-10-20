export interface NodeCompileStoreOptions {
  /** Where entries go. Default: $XDG_CACHE_HOME/gcu-adder, %LOCALAPPDATA%\gcu-adder on Windows, else ~/.cache/gcu-adder. */
  dir?: string;
  /** The directory's cap in bytes; least recently used entries are removed past it. Default 256 MB. */
  maxBytes?: number;
  /** Path or file: URL of the @gcu/air bundle, when import.meta.resolve('@gcu/air') can't find it. */
  air?: string;
}
export interface NodeCompileStore {
  /** The compiler identity entries are keyed by (adder's src/ files + the @gcu/air bundle, hashed). */
  readonly id: string;
  readonly dir: string;
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}
/** A disk store for adder's compile cache — pass it to setCompileStore. Node only. */
export function nodeCompileStore(opts?: NodeCompileStoreOptions): NodeCompileStore;
