// 旧的官方 Excalidraw PWA 会在浏览器里注册 Service Worker 并缓存整套旧前端;
// 换成本项目后,旧 SW 会继续把旧页面塞给用户(表现为"改了没生效")。
// 这里放一个同名 sw.js:浏览器下次导航时会拉它,新脚本安装后立即注销自己并清缓存。
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch {
        // 清缓存失败也要继续注销
      }
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) client.navigate(client.url);
    })(),
  );
});

self.addEventListener("fetch", () => {
  // 不拦截任何请求:交给网络
});
