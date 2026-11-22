// Static PWA shell; network-first for current prices and UI. Never cache checkout data.
const CACHE = 'tbc-shell-v28';
const SHELL = ['./','./index.html','./style.css','./photos.css','./experience.css','./happy-bowl.css','./customer-v24.css','./menu.js','./food-photos.js','./funnel-v26.js','./app.js','./location.js','./happy-bowl.js','./push-client-v25.js','./account.js','./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png','./assets/icon-maskable.png','./assets/app-icon.svg','./photo-credits.html'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('push',event=>{let p={};try{p=event.data?.json()||{}}catch{}event.waitUntil(self.registration.showNotification(p.title||'KhaoKhao',{body:p.body||'Open KhaoKhao for an update.',icon:'/assets/icon-192.png',data:{path:p.path==='/merchant'?'/merchant':'/'}}))});
self.addEventListener('notificationclick',event=>{event.notification.close();const path=event.notification.data?.path==='/merchant'?'/merchant':'/';event.waitUntil(self.clients.openWindow(path))});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('tbc-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname==='/merchant.html' || url.pathname==='/merchant') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok && (event.request.mode === 'navigate' || SHELL.some(path => new URL(path,self.registration.scope).pathname === url.pathname) || /\/assets\/dishes\//.test(url.pathname))) {
        await cache.put(event.request,response.clone());
      }
      return response;
    } catch {
      const saved = await cache.match(event.request);
      if (saved) return saved;
      if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
