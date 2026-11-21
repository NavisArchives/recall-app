import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Last-known-good copies of the read-only data.
 *
 * Every successful read is written here. When Supabase cannot be reached, the
 * display serves the snapshot instead of an error: Margaret gets the archive
 * she saw yesterday rather than a broken screen, which is far better than the
 * truth being unavailable.
 */

const SNAPSHOT_DIR = path.resolve(process.cwd(), ".cache/snapshots");

function file(name: string) {
  return path.join(SNAPSHOT_DIR, `${name}.json`);
}

export async function saveSnapshot(name: string, data: unknown): Promise<void> {
  try {
    await mkdir(SNAPSHOT_DIR, { recursive: true });
    // Temporary name first, so an interrupted write cannot leave behind
    // half a file that would later parse as truth.
    const temporary = `${file(name)}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ savedAt: new Date().toISOString(), data }));
    await rename(temporary, file(name));
  } catch (err) {
    console.error(`[snapshot] could not save ${name}`, err);
  }
}

export async function readSnapshot<T>(name: string): Promise<{ data: T; savedAt: string } | null> {
  try {
    const parsed = JSON.parse(await readFile(file(name), "utf8"));
    return { data: parsed.data as T, savedAt: parsed.savedAt as string };
  } catch {
    return null;
  }
}

/**
 * Runs a read, keeping a copy of whatever it returns. If the read fails and a
 * copy exists, the copy is served and the response says so, so the frontend
 * can tell someone they are looking at something slightly old.
 */
export async function withSnapshot<T>(
  name: string,
  read: () => Promise<T>
): Promise<{ data: T; stale: boolean; savedAt?: string }> {
  try {
    const data = await read();
    void saveSnapshot(name, data);
    return { data, stale: false };
  } catch (err) {
    const cached = await readSnapshot<T>(name);
    if (!cached) throw err;

    console.warn(`[snapshot] serving cached ${name} from ${cached.savedAt}`);
    return { data: cached.data, stale: true, savedAt: cached.savedAt };
  }
}
