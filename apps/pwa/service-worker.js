const CACHE_VERSION = "stamp-shell-v16-20260729-barista-redesign";
const APP_SHELL_CACHE = CACHE_VERSION;
const APP_SHELL_URLS = [
  "/",
  "/wallet",
  "/customer-wallet",
  "/cafe-scanner",
  "/cafe-profile",
  "/cafe-dashboard",
  "/favicon.svg",
  "/favicon.ico",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
  "/theme.css",
  "/pwa/manifest.webmanifest",
  "/pwa/manifest-customer.webmanifest",
  "/pwa/manifest-cafe.webmanifest",
  "/pwa/icons/icon-32.png",
  "/pwa/icons/icon-192.png",
  "/pwa/icons/icon-512.png",
  "/pwa/icons/apple-touch-icon.png",
  "/pwa/icons/customer-icon-192.png",
  "/pwa/icons/customer-icon-512.png",
  "/pwa/icons/customer-apple-touch-icon.png",
  "/pwa/icons/customer-brand-32.png",
  "/pwa/icons/customer-brand-192.png",
  "/pwa/icons/customer-brand-512.png",
  "/pwa/icons/customer-brand-apple-touch-icon.png",
  "/pwa/icons/cafe-icon-192.png",
  "/pwa/icons/cafe-icon-512.png",
  "/pwa/icons/cafe-apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("message", (event) => {
  try {
    if (event && event.data === "SKIP_WAITING") {
      self.skipWaiting();
    }
  } catch (e) {}
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== APP_SHELL_CACHE) {
              return caches.delete(key);
            }
            return Promise.resolve(false);
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isHttpRequest(request) {
  return request && request.url && request.url.startsWith("http");
}

function isApiRequest(url) {
  return url.pathname === "/api" || url.pathname.startsWith("/api/");
}

function isAppShellRequest(url) {
  if (url.pathname === "/" || url.pathname === "/wallet" || url.pathname === "/customer-wallet") return true;
  if (url.pathname === "/cafe-scanner") return true;
  if (url.pathname === "/cafe-profile") return true;
  if (url.pathname === "/cafe-dashboard") return true;
  if (url.pathname === "/customer-wallet.html") return true;
  if (url.pathname === "/cafe-scanner.html") return true;
  if (url.pathname === "/cafe-scanner-new.html") return true;
  if (url.pathname === "/cafe-profile.html") return true;
  if (url.pathname === "/cafe-dashboard.html") return true;
  return false;
}

function staleWhileRevalidate(request) {
  return caches.open(APP_SHELL_CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    }),
  );
}

function networkFirst(request, fallbackPath) {
  return fetch(request)
    .then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() =>
      caches.match(request).then((cached) => {
        if (cached) return cached;
        if (fallbackPath) return caches.match(fallbackPath);
        return Response.error();
      }),
    );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!isHttpRequest(request) || request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApiRequest(url)) return;

  if (
    url.pathname.startsWith("/pwa/") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".svg")
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isAppShellRequest(url)) {
    event.respondWith(networkFirst(request, "/wallet"));
  }
});
