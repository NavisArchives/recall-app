const backendUrl = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:4000";

/**
 * The same origin the fetch helpers use, for the rare link the browser should
 * follow itself — a streamed download that must not be held in the tab's
 * memory (M241's archive export). Exported so nobody writes a second copy of
 * this line that can drift from it.
 */
export const API_ORIGIN = backendUrl;

/*
  What a person reads when the request never reached a server.

  This used to say "Check that it is running (npm run dev in backend)" in
  every build, which is the right sentence for a developer and the wrong one
  for Margaret's daughter: it names a command she has no terminal for, about
  a machine she does not own, and it reads as though she broke something.

  The developer's version survives where it belongs — `import.meta.env.DEV` is
  true only in `npm run dev`, so a laptop keeps the hint and a family gets a
  sentence about what happened and what to do about it. Both begin with "The
  server is not responding" so anything matching on that prefix still works;
  the classification in `absenceKind` keys on a missing status rather than
  prose, and stays correct either way.
*/
export const UNREACHABLE_MESSAGE = import.meta.env.DEV
  ? "The server is not responding. Check that it is running (npm run dev in backend)."
  : "The server is not responding. This is at our end, not yours — nothing you did caused it, and nothing has been lost. Please try again in a moment.";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;

  try {
    res = await fetch(`${backendUrl}/api${path}`, {
      ...options,
      // Sends the httpOnly session cookies.
      credentials: "include",
      headers:
        options?.body && !(options.body instanceof FormData)
          ? { "Content-Type": "application/json", ...options.headers }
          : options?.headers,
    });
  } catch {
    // fetch only rejects when the request never reached a server, which in
    // practice means the backend is not running. Saying so beats a generic
    // failure that sends someone hunting through their own form.
    throw new Error(UNREACHABLE_MESSAGE);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error ?? `The request failed (${res.status}).`);
    // Some refusals carry a machine-readable name beside the sentence
    // (e.g. "screen_taken"), so a page can offer the way through instead
    // of string-matching prose that is allowed to change.
    if (typeof body.code === "string") {
      (error as Error & { code?: string }).code = body.code;
    }
    /*
      The status travels with the refusal (M201).

      Without it every failure looks the same to a page, and three of them
      answered by guessing the kindest-sounding cause: "Channel not found",
      "This person was not found" — on a 503. That is worse than F70's
      "nothing here", because it does not merely fail to know, it asserts a
      specific and wrong reason, and somebody goes looking for a memory they
      think was deleted.

      Only 404 means the thing is genuinely absent. Everything else means we
      could not ask, and a page can now tell the two apart without reading
      the prose, which is allowed to change.
    */
    (error as Error & { status?: number }).status = res.status;
    throw error;
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * A POST that can say how far along it is.
 *
 * `fetch` cannot report upload progress, and the files here are family videos
 * of up to 50 MB from a phone on home wifi — a save that sits silent for a
 * minute reads as frozen. XHR only for this one job; everything else stays on
 * `request` above.
 */
function upload<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${backendUrl}/api${path}`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (xhr.status === 204 || !xhr.responseText) return resolve(undefined as T);
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          resolve(undefined as T);
        }
        return;
      }
      let message = `The request failed (${xhr.status}).`;
      try {
        message = JSON.parse(xhr.responseText).error ?? message;
      } catch {
        /* the status line is the best we have */
      }
      reject(new Error(message));
    };

    xhr.onerror = () =>
      reject(new Error(UNREACHABLE_MESSAGE));

    xhr.send(form);
  });
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  upload,
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
