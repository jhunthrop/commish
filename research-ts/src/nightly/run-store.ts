import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * WHERE A RUN IS WRITTEN. The nightly run never touches the filesystem or a bucket directly: it hands
 * keys and bodies to a `RunStore`, so the local directory a developer reads and a production bucket
 * are one call site each. Keys are POSIX paths under the store's root (`runs/<runId>/adp.json`).
 */
export interface RunStore {
  /** Writes one object, replacing any object at the same key. */
  put(key: string, body: string): Promise<void>;
  /** The object at `key`, or `null` when there is none. */
  get(key: string): Promise<string | null>;
  /** Where a reader finds `key`, for the run's own log lines. */
  locate(key: string): string;
}

/** A directory on local disk: the development target, and what the parity oracle writes. */
export class LocalRunStore implements RunStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, body: string): Promise<void> {
    const path = this.locate(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, "utf8");
  }

  async get(key: string): Promise<string | null> {
    const path = this.locate(key);
    try {
      await access(path);
    } catch {
      return null;
    }
    return readFile(path, "utf8");
  }

  locate(key: string): string {
    if (key.split("/").some((segment) => segment === ".." || segment === "")) throw new Error(`run store key "${key}" is not a plain relative path.`);
    return join(this.root, key);
  }
}
