/* Минимальный service worker для PWA-установки.
   Стратегия: network-first, без агрессивного кэша.
   Браузер при этом получает «installable PWA» статус. */

const CACHE = "studio-mvp-v1";

self.addEventListener("install", (event) => {
  // активируемся сразу, не ждём перезапуска
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // забираем контроль над всеми вкладками
  event.waitUntil(self.clients.claim());
  // подчищаем старые кэши
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  // network-first: всегда пытаемся свежую версию, кэш — резерв на офлайн
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        // в кэш только успешные ответы и только наши же файлы
        if (resp.ok && new URL(event.request.url).origin === location.origin) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
