/**
 * What the picker offers, and what it turns away.
 *
 * One list, because there were two and they disagreed — with each other and
 * with the server. GIF was refused here and accepted there; HEIC was refused
 * everywhere, which meant refusing most of a phone's camera roll.
 *
 * The rule to hold on to: `file.type` is the browser's guess from the file
 * extension, not a fact about the bytes. It is empty for anything the browser
 * does not recognise, and an empty guess is not evidence of a bad file. Only
 * the server reads the magic bytes, so this check exists to spare someone a
 * pointless upload — never to be the thing that decides.
 */

export const IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
];

/**
 * HEIC often arrives with an empty `type`, so the extensions are named too —
 * without them macOS greys the files out in the chooser and the photograph
 * cannot even be selected.
 */
export const IMAGE_ACCEPT = [...IMAGE_MIME, ".heic", ".heif"].join(",");

export const VIDEO_ACCEPT = "video/*,.mov,.mp4,.m4v";

/**
 * Returns why a file is obviously wrong, or null to let the server decide.
 *
 * Deliberately permissive: it rejects a file only when the browser is
 * confident and wrong-kind — a video dropped into a photo channel. Anything
 * unrecognised goes to the server, which knows how to read it.
 */
export function fileProblem(file: File, wants: "image" | "video"): string | null {
  const guess = file.type;

  if (wants === "video") {
    if (guess && !guess.startsWith("video/")) return `${file.name} is not a video.`;
    return null;
  }

  if (guess.startsWith("video/")) return `${file.name} is a video, not a photo.`;
  if (guess && !IMAGE_MIME.includes(guess)) {
    return `${file.name} is not a photo the archive can read.`;
  }

  return null;
}
