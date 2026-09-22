import { spawn } from "node:child_process";
import { mkdir, open, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const output = path.join(root, "docs/concepts/2026-09-18-motion-v2");
await mkdir(output, { recursive: true });
await mkdir("output/motion-v2", { recursive: true });
const cli = path.join(
  root,
  "motion-film/node_modules/@remotion/cli/remotion-cli.js",
);
const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["PC-lift", "PC-trail", "PC-ripple", "VR-lift", "VR-trail", "VR-ripple"];
for (const id of targets) {
  if (!/^(PC|VR)-(lift|trail|ripple)$/.test(id))
    throw new Error("Unknown film");
  const log = await open(`output/motion-v2/${id}.log`, "w");
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        cli,
        "render",
        id,
        path.join(output, `${id.toLowerCase()}.mp4`),
        "--codec=h264",
        "--crf=18",
      ],
      {
        cwd: path.join(root, "motion-film"),
        windowsHide: true,
        stdio: ["ignore", log.fd, log.fd],
      },
    );
    child.on("error", reject);
    child.on("close", resolve);
  });
  await log.close();
  if (code !== 0)
    throw new Error(`Render failed: ${id}. See output/motion-v2/${id}.log`);
  console.log(`Rendered ${id}: 1280x720, 60fps, 540 frames, 9 seconds.`);
}
const files = (await readdir(output))
  .filter((f) => /^(pc|vr)-(lift|trail|ripple)\.mp4$/.test(f))
  .sort();
await writeFile(
  path.join(output, "render-manifest.json"),
  JSON.stringify(
    {
      renderer: "Remotion 4.0.526",
      fps: 60,
      width: 1280,
      height: 720,
      frames: 540,
      durationSeconds: 9,
      files,
      source: "apps/desktop/src/ui/MotionArtwork.tsx",
      motion: "packages/core/src/menu-motion.ts",
      note: "Designed motion studies. VR clips are spatial UI illustrations, not headset recordings.",
    },
    null,
    2,
  ),
);
