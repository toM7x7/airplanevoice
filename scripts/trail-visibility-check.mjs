import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const out = "output/trail-visibility";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 640 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("http://127.0.0.1:5173/");
  const result = await page.evaluate(
    async (threeUrl) => {
      const THREE = await import(threeUrl);
      const { TrailVisibility } = await import("/src/trail-visibility.ts");
      const mask = new TrailVisibility();
      const renderer = new THREE.WebGLRenderer({
        antialias: false,
        preserveDrawingBuffer: true,
      });
      renderer.setSize(512, 512);
      renderer.setClearColor(0x000000);
      const target = new THREE.WebGLRenderTarget(512, 512);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-5, 0, -5),
          new THREE.Vector3(5, 0, -5),
        ]),
        mask.apply(
          new THREE.LineBasicMaterial({
            color: "white",
            transparent: true,
            depthWrite: false,
            toneMapped: false,
          }),
        ),
      );
      const ring = new THREE.InstancedMesh(
        new THREE.RingGeometry(0.94, 1.06, 64),
        mask.apply(
          new THREE.MeshBasicMaterial({
            color: "white",
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false,
          }),
        ),
        1,
      );
      ring.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-1, 0, -5));
      ring.visible = false;
      scene.add(line, ring);
      const pixels = new Uint8Array(512 * 512 * 4);
      const render = () => {
        camera.updateMatrixWorld();
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, 512, 512, pixels);
      };
      const peak = (x, y = 256) => {
        let value = 0;
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            value = Math.max(value, pixels[((y + dy) * 512 + x + dx) * 4]);
        return value;
      };
      const images = [];
      const snapshot = (label) => {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        images.push({ label, url: renderer.domElement.toDataURL() });
      };
      render();
      const baseline = [peak(256), peak(300), peak(350)];
      snapshot("Before: an uninterrupted trail crosses the aircraft direction");
      mask.aircraft.value[0].set(0, 0, -10, 1.32);
      render();
      const faded = [peak(256), peak(300), peak(350)];
      snapshot("After: a soft opening; the surrounding trail remains");
      // Both nearby and distant trail fragments use the same apparent aircraft area.
      line.scale.setScalar(3);
      render();
      const distant = [peak(256), peak(300), peak(350)];
      line.scale.setScalar(1);
      const eyes = [];
      for (const eyeX of [-0.032, 0.032, 2]) {
        camera.position.x = eyeX;
        render();
        const centre = new THREE.Vector3(0, 0, -10).project(camera);
        eyes.push(peak(Math.round((centre.x + 1) * 256)));
      }
      camera.position.x = 0;
      mask.aircraft.value[1].set(3.67, 0, -10, 0.3);
      render();
      const secondAircraft = peak(350);
      mask.aircraft.value[1].w = 0;
      mask.aircraft.value[0].set(0, 0, 10, 1.32);
      render();
      const behindViewer = peak(256);
      mask.aircraft.value[0].set(0, 0, -10, 0);
      render();
      const removedAircraft = peak(256);
      line.visible = false;
      ring.visible = true;
      render();
      const ringBefore = [peak(256), peak(154)];
      mask.aircraft.value[0].w = 1.32;
      render();
      const ringAfter = [peak(256), peak(154)];
      snapshot("Sound ripple: only the overlapping arc fades");
      document.body.replaceChildren();
      document.body.style.cssText =
        "margin:0;background:#eef1e8;font:16px sans-serif;display:flex;flex-wrap:wrap";
      for (const { label, url } of images) {
        const figure = document.createElement("figure");
        figure.style.cssText = "width:300px;margin:16px";
        const img = new Image();
        img.src = url;
        img.style.width = "300px";
        const caption = document.createElement("figcaption");
        caption.textContent = label;
        figure.append(img, caption);
        document.body.append(figure);
      }
      line.geometry.dispose();
      line.material.dispose();
      ring.geometry.dispose();
      ring.material.dispose();
      target.dispose();
      renderer.dispose();
      return {
        baseline,
        faded,
        distant,
        eyes,
        secondAircraft,
        behindViewer,
        removedAircraft,
        ringBefore,
        ringAfter,
      };
    },
    `/@fs/${path.resolve("node_modules/three/build/three.module.js").replaceAll("\\", "/")}`,
  );
  await page.screenshot({ path: `${out}/comparison.png`, fullPage: true });
  await fs.writeFile(
    `${out}/measurements.json`,
    JSON.stringify({ result, errors }, null, 2),
  );
  assert(result.baseline.every((n) => n > 250));
  assert(result.faded[0] < 3);
  assert(result.faded[1] > 20 && result.faded[1] < 235);
  assert(result.faded[2] > 250);
  assert(result.distant[0] < 3 && result.distant[2] > 250);
  assert(result.eyes.every((n) => n < 3));
  assert(result.secondAircraft < 3);
  assert(result.behindViewer > 250 && result.removedAircraft > 250);
  assert(result.ringBefore.every((n) => n > 250));
  assert(result.ringAfter[0] < 3 && result.ringAfter[1] > 250);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${out}/comparison.png`, fullPage: true });
  await fs.writeFile(
    `${out}/result.json`,
    JSON.stringify({ passed: true, result, errors }, null, 2),
  );
  console.log(
    "Trail shader pixel checks passed: overlap, feather, depth, camera/eyes, multiple aircraft, removal and instanced ripples.",
  );
} finally {
  await browser.close();
}
