import { readFileSync, existsSync } from "node:fs";

/**
 * The scratch archive's photographs.
 *
 * This used to synthesise PNGs pixel by pixel with a hand-rolled encoder. The
 * bytes were honest — a real PNG, through the real magic-byte upload check —
 * but what they drew was flat coloured rectangles, and the owner's verdict on
 * seeing them was the correct one: they are very ugly.
 *
 * That matters more than a fixture's appearance usually would, because these
 * images are not decoration in three separate places:
 *
 *   - spec 24 layer 2 blurs the channel's current photo to 46px and puts it
 *     behind every channel screen. A flat rectangle blurs to a flat rectangle,
 *     so the whole ambient design is unjudgeable.
 *   - channel 00's cards are 200×280 thumbnails of it (24c).
 *   - it is the picture printed on the front of a postcard (22a).
 *
 * So they are drawn properly now — a warm mid-century hand, real subjects,
 * enough tonal depth that a heavy blur reads as a room. `scenes.py` in the
 * scratchpad generated them; the JPEGs it produced are committed beside this
 * file so seeding needs no Python and no network.
 */
const DIR = new URL("./scenes/", import.meta.url).pathname;

/** Every scene, and which channel it belongs to. */
export const SCENE_NAMES = [
  "house", "garden", "table", "kettle", "pouring", "cup",
  "plants", "farm", "drawer", "album", "wedding", "street",
];

const cache = new Map();

function load(name) {
  if (cache.has(name)) return cache.get(name);
  const path = `${DIR}${name}.jpg`;
  if (!existsSync(path)) {
    throw new Error(
      `No scene image at ${path}. The scratch photographs live in ` +
        `backend/scripts/lib/scenes/ and are committed — if they are missing, ` +
        `the checkout is incomplete rather than the seeder being wrong.`
    );
  }
  const bytes = readFileSync(path);
  cache.set(name, bytes);
  return bytes;
}

/**
 * `SCENES.house()` returns JPEG bytes, the same shape the old encoder had, so
 * the seeder did not have to change to use them.
 */
export const SCENES = Object.fromEntries(SCENE_NAMES.map((n) => [n, () => load(n)]));

/** What the upload call needs alongside the bytes. */
export const SCENE_MIME = "image/jpeg";
export const SCENE_EXT = "jpg";
