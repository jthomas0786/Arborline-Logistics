self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = payload.title || "ArborLine Connect";
  const options = {
    body: payload.body || "You have a new ArborLine Connect notification.",
    icon: "/brand/arborline-badge.png",
    badge: "/brand/arborline-badge.png",
    tag: payload.tag || "arborline-connect-notification",
    renotify: true,
    data: { url: payload.url || "/", ...(payload.data || {}) }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client && client.url === target) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
