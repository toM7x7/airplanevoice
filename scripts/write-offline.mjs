import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const root = path.resolve("dist");
async function filesIn(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory()
          ? filesIn(path.join(dir, e.name))
          : [path.join(dir, e.name)],
      ),
    )
  ).flat();
}
const files = (await filesIn(root))
  .filter((f) => !f.endsWith("sw.js") && !f.endsWith(".map"))
  .sort();
const hash = createHash("sha256");
for (const f of files) hash.update(await fs.readFile(f));
const version = hash.digest("hex").slice(0, 16);
const assets = files.map(
  (f) => "./" + path.relative(root, f).replaceAll("\\", "/"),
);
// Scope-derived prefix isolates this app from other GitHub Pages projects.
const worker = `const ROOT = new URL('./', self.location.href);
const PREFIX = 'sound-trail:' + ROOT.pathname + ':';
const CACHE = PREFIX + '${version}';
const ASSETS = ${JSON.stringify(assets)}.map(p => new URL(p, ROOT).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match(new URL('index.html', ROOT).href)));
  } else if (ASSETS.includes(url.href)) {
    // These exact, public build assets have one representation. Preview servers
    // may add Vary: Origin; module requests carry Origin while precaching does not.
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(request, { ignoreVary: true })) || fetch(request)));
  }
});
`;
await fs.writeFile(path.join(root, "sw.js"), worker);
console.log(`Offline bundle ${version}: ${assets.length} files`);
