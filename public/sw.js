self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: "Nadeef", body: event.data.text() };
  }

  const payload = data;
  const title = payload.title || "Nadeef Reminder";
  const body = payload.body || "You have pending tasks waiting for you.";
  const url = payload.url || "/tasks/due-today?window=today";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: payload.icon || "/nadeef-logo.png",
      badge: payload.badge || "/nadeef-logo.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/tasks/due-today?window=today";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.pathname === "/tasks/due-today") {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
