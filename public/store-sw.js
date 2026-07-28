/* Service worker — acceso PWA tienda + push + badge */
/* eslint-disable no-restricted-globals */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {
    title: "Nuevo mensaje",
    body: "Tienes un mensaje de la tienda",
    url: "/",
    badgeCount: 1,
  };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    try {
      data.body = event.data ? event.data.text() : data.body;
    } catch {
      /* ignore */
    }
  }

  const title = data.title || "Nuevo mensaje";
  const options = {
    body: data.body || "",
    icon: data.icon || "/store-pwa-icon.svg",
    badge: data.icon || "/store-pwa-icon.svg",
    data: { url: data.url || "/" },
    tag: data.tag || "store-chat",
    renotify: true,
    vibrate: [120, 60, 120],
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      const count = Number(data.badgeCount) || 1;
      if (self.navigator && typeof self.navigator.setAppBadge === "function") {
        try {
          await self.navigator.setAppBadge(count);
        } catch {
          /* iOS / unsupported */
        }
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client && url) {
            try {
              await client.navigate(url);
            } catch {
              /* ignore */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "CLEAR_BADGE") {
    if (self.navigator && typeof self.navigator.clearAppBadge === "function") {
      event.waitUntil(self.navigator.clearAppBadge().catch(() => {}));
    }
  }
  if (type === "SET_BADGE") {
    const n = Number(event.data.count) || 0;
    if (self.navigator && typeof self.navigator.setAppBadge === "function") {
      event.waitUntil(
        n > 0 ? self.navigator.setAppBadge(n).catch(() => {}) : self.navigator.clearAppBadge().catch(() => {}),
      );
    }
  }
});
