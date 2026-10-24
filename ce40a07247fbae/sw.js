// Install-only. Nothing is cached: every answer is private and every open must see the live ladder, so fetches
// pass straight to the network. iOS needs no worker for a standalone install; this one just completes the manifest.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
