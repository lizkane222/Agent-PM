/**
 * Agent PM — Web Push service worker.
 *
 * Handles push events sent by the Django backend via pywebpush/VAPID and
 * shows an OS-level desktop notification. Also handles notificationclick to
 * focus or open the app window.
 */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Reminder", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Reminder";
  const options = {
    body: data.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: data.reminder_id ? `reminder-${data.reminder_id}` : "reminder",
    renotify: true,
    data: {
      url: "/",
      reminder_id: data.reminder_id,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Focus an existing tab if one is open
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            return client.focus();
          }
        }
        // Otherwise open a new tab
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
