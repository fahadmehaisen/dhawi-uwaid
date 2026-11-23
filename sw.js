/* ==========================================================================
   Offline Service Worker for Dhawi Uwaid PWA
   ========================================================================== */

const CACHE_NAME = "dhawi-uwaid-v13";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./supabase-client.js",
  "./data/tree-data.js",
  "./manifest.webmanifest",
  "./assets/logo-seal-clean.svg",
  "./assets/logo-seal-emerald.svg",
  "./assets/logo-wordmark-clean.svg",
  "./assets/logo-wordmark-emerald.svg",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.hostname.endsWith(".supabase.co")) return;
  // Admin panel & gated brand/letterhead studio: always straight from network, never cached.
  if (/\/admin\.(html|js|css)$/.test(url.pathname)) return;
  if (/\/brand\/(logo-studio|letterhead-clean|letterhead-official|occasion-studio|brand-guard)\.(html|js)$/.test(url.pathname)) return;
  if (url.hostname === "cdn.jsdelivr.net") return;

  // Google Fonts: never fall back to index.html
  if (url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && (res.ok || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  if (url.hostname === "fonts.googleapis.com") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  const isCacheFirst = url.origin === self.location.origin && url.pathname.includes("/assets/");

  if (isCacheFirst) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // Network-first with cache fallback for same-origin HTML, JS, CSS, and tree data
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((c) => c || (req.mode === "navigate" ? caches.match("./index.html") : Response.error()))
      )
  );
});
