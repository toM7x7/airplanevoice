import { cp, mkdir, writeFile } from "node:fs/promises";
const dir = new URL("../output/pages-release/", import.meta.url);
await mkdir(dir, { recursive: true });
await cp(new URL("../dist/", import.meta.url), dir, { recursive: true });
await cp(
  new URL("../pages/entry.js", import.meta.url),
  new URL("_worker.js", dir),
);
await writeFile(
  new URL("_routes.json", dir),
  JSON.stringify({ version: 1, include: ["/", "/api/*"], exclude: [] }),
);
console.log("Prepared Pages assets and same-origin API service binding.");
