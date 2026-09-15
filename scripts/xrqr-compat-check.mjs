// Optional online integration check. Camera input is synthetic; this does not
// measure physical Quest recognition, permissions, distance or comfort.
import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const target =
  process.env.TEST_URL || "https://tom7x7.github.io/airplanevoice/";
const out = "output/xrqr-compat";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
try {
  const source = await browser.newPage();
  await source.goto(target);
  await source
    .getByRole("button", { name: "この空をQuestへ渡す", exact: true })
    .click();
  const qr = source.getByAltText("この空の設定を開くQRコード", { exact: true });
  await qr.waitFor();
  const qrImage = await qr.getAttribute("src");
  const link = await source.getByLabel("渡すURL", { exact: true }).inputValue();
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await context.addInitScript(
    ({ qrImage }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 800;
      const image = new Image();
      image.src = qrImage;
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          await image.decode();
          const ctx = canvas.getContext("2d");
          const stream = canvas.captureStream(5);
          setInterval(() => ctx.drawImage(image, 0, 0, 800, 800), 150);
          return stream;
        },
      });
      Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
        value: async () => [
          {
            deviceId: "synthetic-qr",
            groupId: "test",
            kind: "videoinput",
            label: "back camera (synthetic)",
          },
        ],
      });
    },
    { qrImage },
  );
  const page = await context.newPage();
  // XRQR's documented-in-source developer switch selects its receiver screen.
  await page.goto("https://xrqr.net/?dev=true");
  const open = page.getByRole("button", {
    name: "ブラウザで開く",
    exact: true,
  });
  await open.waitFor({ timeout: 30000 });
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link);
  await page.screenshot({ path: `${out}/receiver.png`, fullPage: true });
  const popup = page.waitForEvent("popup");
  await open.click();
  const received = await popup;
  await received
    .getByRole("button", { name: "この空を取り込む", exact: true })
    .waitFor();
  assert.equal(new URL(received.url()).hash, new URL(link).hash);
  await received
    .getByRole("button", { name: "この空を取り込む", exact: true })
    .click();
  assert.equal(
    await received.evaluate(
      () => JSON.parse(window.render_game_to_text()).phase,
    ),
    "EDIT",
  );
  await fs.writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        passed: true,
        target,
        receiver: "https://xrqr.net/?dev=true",
        camera: "synthetic video",
        checks: [
          "actual XRQR QR decoder",
          "complete clipboard URL",
          "browser opening preserves fragment",
          "SOUND TRAIL explicit import",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "XRQR live receiver accepted the QR and opened the complete recipe URL (synthetic camera only).",
  );
} finally {
  await browser.close();
}
