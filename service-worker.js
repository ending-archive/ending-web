const APP_CACHE = "ending-app-v1";
const BOOK_CACHE = "ending-books-v1";
const BASE_URL = new URL("./", self.registration.scope);
const APP_ASSETS = [
  "index.html",
  "reader.html",
  "manifest.webmanifest",
  "books.json",
  "css/index.css",
  "css/reader.css",
  "js/index.js",
  "js/reader.js",
  "js/pwa.js",
  "fonts/fraunces.woff2",
  "fonts/literata.woff2",
  "fonts/spacemono.woff2",
  "fonts/worksans.woff2",
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
  "apple-touch-icon.png",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) =>
        cache.addAll(APP_ASSETS.map((asset) => new URL(asset, BASE_URL))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("ending-app-") && key !== APP_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function getBookRequest(path) {
  if (typeof path !== "string") throw new Error("Invalid book path.");
  const url = new URL(path, BASE_URL);
  const bookPrefix = new URL("books/", BASE_URL).pathname;
  const bookSegments = url.pathname.slice(bookPrefix.length).split("/");
  let hasInvalidSegment = false;
  try {
    hasInvalidSegment = bookSegments.some((segment) => {
      const decoded = decodeURIComponent(segment);
      return (
        !decoded ||
        decoded === "." ||
        decoded === ".." ||
        decoded.includes("/") ||
        decoded.includes("\\")
      );
    });
  } catch {
    hasInvalidSegment = true;
  }
  if (
    url.origin !== BASE_URL.origin ||
    !url.pathname.startsWith(bookPrefix) ||
    !url.pathname.toLowerCase().endsWith(".txt") ||
    hasInvalidSegment ||
    url.search ||
    url.hash
  ) {
    throw new Error("Only archive text books can be saved offline.");
  }
  return new Request(url.href, { method: "GET" });
}

async function getBookStatuses(paths) {
  if (!Array.isArray(paths) || paths.length > 100) {
    throw new Error("Invalid book status request.");
  }
  const cache = await caches.open(BOOK_CACHE);
  return Promise.all(
    paths.map(async (path) => {
      const request = getBookRequest(path);
      return { path, saved: Boolean(await cache.match(request)) };
    }),
  );
}

async function saveBook(path) {
  const request = getBookRequest(path);
  const cache = await caches.open(BOOK_CACHE);
  if (await cache.match(request)) return { saved: true };

  const response = await fetch(request);
  if (!response.ok) {
    throw new Error(`Book download failed (HTTP ${response.status}).`);
  }
  if (response.type === "opaque") {
    throw new Error("The book response could not be verified.");
  }
  await cache.put(request, response);
  return { saved: true };
}

async function removeBook(path) {
  const request = getBookRequest(path);
  const cache = await caches.open(BOOK_CACHE);
  return { saved: false, removed: await cache.delete(request) };
}

async function handleMessage(data) {
  switch (data?.action) {
    case "get-book-statuses":
      return { statuses: await getBookStatuses(data.paths) };
    case "save-book":
      return await saveBook(data.path);
    case "remove-book":
      return await removeBook(data.path);
    default:
      throw new Error("Unsupported offline action.");
  }
}

self.addEventListener("message", (event) => {
  const replyPort = event.ports[0];
  if (!replyPort) return;
  event.waitUntil(
    handleMessage(event.data)
      .then((result) => replyPort.postMessage({ ok: true, result }))
      .catch((error) =>
        replyPort.postMessage({
          ok: false,
          error:
            error instanceof Error ? error.message : "Offline request failed.",
        }),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== BASE_URL.origin) return;

  if (url.pathname === new URL("books.json", BASE_URL).pathname) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            try {
              const cache = await caches.open(APP_CACHE);
              await cache.put(
                new URL("books.json", BASE_URL),
                response.clone(),
              );
            } catch (error) {
              console.error(
                "Unable to refresh the offline catalog cache.",
                error,
              );
            }
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(new URL("books.json", BASE_URL));
          if (cached) return cached;
          throw new Error("The archive catalog is unavailable offline.");
        }),
    );
    return;
  }

  if (url.pathname.startsWith(BASE_URL.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((r) => {
            if (r.ok) cache.put(request, r.clone());
            return r;
          })
          .catch(() => null);
        if (cached) {
          event.waitUntil(network);
          return cached;
        }
        return (await network) || Response.error();
      })(),
    );
  }

  if (request.mode === "navigate") {
    const requestedPath = url.pathname;
    const indexPath = new URL("index.html", BASE_URL).pathname;
    const readerPath = new URL("reader.html", BASE_URL).pathname;
    if (
      requestedPath !== BASE_URL.pathname &&
      requestedPath !== indexPath &&
      requestedPath !== readerPath
    ) {
      return;
    }
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(APP_CACHE);
        const page =
          requestedPath === readerPath
            ? new URL("reader.html", BASE_URL)
            : new URL("index.html", BASE_URL);
        const cached = await cache.match(page);
        if (cached) return cached;
        throw new Error("This page is unavailable offline.");
      }),
    );
    return;
  }

  if (url.pathname.startsWith(BASE_URL.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request)),
    );
  }
});
