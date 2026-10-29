const CACHE = "caremate-univ-v7";
const ASSETS = ["./", "index.html", "styles.css", "app.js", "auth.js", "store.js", "exam.js", "admin.js", "firebase.js", "manifest.json", "assets/cmu-icon.png"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request)));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const fallback = new URL("./?page=admin", self.location.href).href;
  let target = fallback;
  try {
    const candidate = new URL(event.notification.data?.url || fallback, self.location.origin);
    if (candidate.origin === self.location.origin) target = candidate.href;
  } catch (_) {}
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) return existing.navigate(target).then(() => existing.focus());
    return clients.openWindow(target);
  }));
});
