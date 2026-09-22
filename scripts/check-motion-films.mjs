import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const exec = promisify(execFile);
const root = process.cwd(),
  out = path.join(root, "docs/concepts/2026-09-18-motion-v2");
const binaries = path.join(
  root,
  "motion-film/node_modules/@remotion/compositor-win32-x64-msvc",
);
const results = [];
for (const mode of ["pc", "vr"])
  for (const style of ["lift", "trail", "ripple"]) {
    const id = `${mode}-${style}`,
      file = path.join(out, `${id}.mp4`);
    const { stdout } = await exec(
      path.join(binaries, "ffprobe.exe"),
      [
        "-v",
        "error",
        "-count_frames",
        "-show_entries",
        "stream=codec_type,r_frame_rate,avg_frame_rate,nb_read_frames,duration",
        "-of",
        "json",
        file,
      ],
      { windowsHide: true },
    );
    const streams = JSON.parse(stdout).streams;
    const video = streams.find((s) => s.codec_type === "video");
    assert.equal(video.r_frame_rate, "60/1");
    assert.equal(video.avg_frame_rate, "60/1");
    assert.equal(Number(video.nb_read_frames), 540);
    assert.equal(Number(video.duration), 9);
    assert(streams.some((s) => s.codec_type === "audio"));
    await exec(
      path.join(binaries, "ffmpeg.exe"),
      [
        "-v",
        "error",
        "-y",
        "-ss",
        "1.35",
        "-i",
        file,
        "-frames:v",
        "1",
        "-update",
        "1",
        path.join(out, `${id}.png`),
      ],
      { windowsHide: true },
    );
    // Decode all frames, not just metadata: inspect the panel region during opening.
    const decoded = await exec(
      path.join(binaries, "ffmpeg.exe"),
      [
        "-v",
        "error",
        "-i",
        file,
        "-vf",
        "scale=160:90",
        "-pix_fmt",
        "rgb24",
        "-c:v",
        "rawvideo",
        "-f",
        "image2pipe",
        "pipe:1",
      ],
      { windowsHide: true, encoding: "buffer", maxBuffer: 40 * 1024 * 1024 },
    );
    const pixels = decoded.stdout,
      frameSize = 160 * 90 * 3;
    assert.equal(pixels.length / frameSize, 540);
    const hashes = new Set();
    for (let n = 46; n < 143; n++) {
      const hash = createHash("sha256");
      for (let y = 30; y < 65; y++)
        hash.update(
          pixels.subarray(
            n * frameSize + (y * 160 + 40) * 3,
            n * frameSize + (y * 160 + 120) * 3,
          ),
        );
      hashes.add(hash.digest("hex"));
    }
    assert(hashes.size > 90, `${id}: frozen/repeated opening frames`);
    results.push({
      id,
      videoFrames: 540,
      fps: 60,
      videoDuration: 9,
      openingPanelFramesChecked: 97,
      uniqueOpeningPanelFrames: hashes.size,
      audio: true,
    });
    console.log(
      `OK ${id}: 540 frames / 60fps; ${hashes.size}/97 opening frames distinct`,
    );
  }
await writeFile(
  path.join(out, "verification.json"),
  JSON.stringify(
    {
      checks: results,
      scope:
        "File cadence and changing panel pixels verified. These are not hardware performance or perceived-comfort measurements.",
    },
    null,
    2,
  ),
);
