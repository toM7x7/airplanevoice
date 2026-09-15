import {
  compileRoute,
  compileShow,
  workshopSpec,
  finitePoint,
  generatedPoints,
  OBSERVERS,
  validateAircraft,
  validateFlight,
  validateGenerator,
  type Experience,
  type RouteSpec,
  type AircraftDesign,
  type AirspaceConfig,
  type EvolutionSettings,
  type ShowRecipe,
} from "../../../packages/core/src";

export interface SkyRecipe {
  version: 1 | 2;
  show?: ShowRecipe;
  route: RouteSpec;
  aircraft: AircraftDesign;
  airspace: AirspaceConfig;
  evolution: EvolutionSettings;
  delayScale: number;
  observer: string;
}
export const SKY_OPTIONS_KEY = "sound-trail.desktop.options.v1";
const MAX_JSON = 131072;
const MAX_CODE = 48000;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function parseSky(value: unknown): SkyRecipe {
  if (!object(value) || ![1, 2].includes(value.version as number))
    throw new Error("この空の設定形式には対応していません。");
  if (value.version === 1 && value.show !== undefined)
    throw new Error("演目の共有には新しい設定形式が必要です。");
  const show = value.version === 2 ? compileShow(value.show).recipe : undefined;
  const r = value.route;
  if (
    !object(r) ||
    typeof r.id !== "string" ||
    r.id.length > 80 ||
    !Number.isSafeInteger(r.revision) ||
    Number(r.revision) < 0 ||
    r.closed !== true ||
    !Array.isArray(r.rawPoints) ||
    r.rawPoints.length < 3 ||
    r.rawPoints.length > 1000 ||
    !r.rawPoints.every(
      (p) =>
        object(p) &&
        finitePoint(p) &&
        Math.abs(Number(p.x)) <= 6000 &&
        Math.abs(Number(p.z)) <= 6000 &&
        Number(p.y) >= 0 &&
        Number(p.y) <= 2000,
    )
  )
    throw new Error("航路のデータを確認してください。");
  if (r.generator !== undefined) validateGenerator(r.generator);
  if (r.flight !== undefined) validateFlight(r.flight);
  validateAircraft(value.aircraft);
  const a = value.airspace,
    ev = value.evolution;
  if (
    !object(a) ||
    ![1, 2, 3].includes(a.aircraftCount as number) ||
    ![0, 8, 16].includes(a.spacingSec as number)
  )
    throw new Error("機数・開始間隔を確認してください。");
  if (
    !object(ev) ||
    typeof ev.enabled !== "boolean" ||
    typeof ev.amount !== "number" ||
    !Number.isFinite(ev.amount) ||
    ev.amount < 0 ||
    ev.amount > 1
  )
    throw new Error("周回の設定を確認してください。");
  if (
    typeof value.delayScale !== "number" ||
    !Number.isFinite(value.delayScale) ||
    value.delayScale < 1 ||
    value.delayScale > 3 ||
    !OBSERVERS.some((o) => o.id === value.observer)
  )
    throw new Error("音・観察地点の設定を確認してください。");
  const route: RouteSpec = {
    id: r.id,
    revision: r.revision as number,
    closed: true,
    rawPoints: r.rawPoints.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    ...(r.generator ? { generator: structuredClone(r.generator) } : {}),
    ...(r.flight ? { flight: structuredClone(r.flight) } : {}),
  };
  compileRoute(route);
  if (show && (a.aircraftCount !== show.flights.length || ev.enabled))
    throw new Error("演目の機数と周回設定を確認してください。");
  return {
    version: value.version as 1 | 2,
    ...(show ? { show } : {}),
    route: show ? workshopSpec(show.flights[0].recipe, 1) : route,
    aircraft: { ...(show?.flights[0].recipe.aircraft ?? value.aircraft) },
    airspace: {
      aircraftCount: a.aircraftCount,
      spacingSec: show ? 0 : a.spacingSec,
    } as AirspaceConfig,
    evolution: { enabled: ev.enabled, amount: ev.amount },
    delayScale: value.delayScale,
    observer: value.observer as string,
  };
}
export function captureSky(
  e: Experience,
  delayScale = e.recipe.delayScale,
  observer: string = OBSERVERS.find(
    (o) =>
      Math.hypot(o.position.x - e.listener.x, o.position.z - e.listener.z) < 1,
  )?.id ?? "garden",
): SkyRecipe {
  return parseSky({
    version: e.show ? 2 : 1,
    ...(e.show ? { show: e.show } : {}),
    route: e.spec,
    aircraft: e.aircraftDesign,
    airspace: e.airspace,
    evolution: e.evolution,
    delayScale,
    observer,
  });
}
export function skyOptions(sky: SkyRecipe) {
  const { version, airspace, evolution, delayScale, observer, show } = sky;
  return {
    version,
    airspace,
    evolution,
    delayScale,
    observer,
    ...(show ? { show } : {}),
  };
}
export function applySky(e: Experience, input: SkyRecipe, remember = true) {
  if (!e.canEdit)
    throw new Error("飛行を終えて、編集画面で取り込んでください。");
  const sky = parseSky(input);
  e.setRoute(sky.route, remember);
  e.setAircraftDesign(sky.aircraft);
  e.setAirspace(sky.airspace);
  e.setEvolution(sky.evolution);
  if (sky.show) e.applyShow(sky.show);
  e.setListener(OBSERVERS.find((o) => o.id === sky.observer)!.position);
  e.recipe = { ...e.recipe, delayScale: sky.delayScale };
  e.setMix("balanced");
}
export async function encodeSky(input: SkyRecipe): Promise<string> {
  const sky = parseSky(input);
  const generator = sky.route.generator;
  const generated =
    generator && generatedPoints(generator, generator.widthM, 16);
  // Omit only exactly reproducible preview points. Custom points must survive,
  // since the evolution seed also depends on them.
  const compact =
    generated &&
    sky.route.rawPoints.length === generated.length &&
    generated.every(
      (p, i) =>
        p.x === sky.route.rawPoints[i].x &&
        p.y === sky.route.rawPoints[i].y &&
        p.z === sky.route.rawPoints[i].z,
    );
  const text = JSON.stringify(
    compact
      ? {
          ...sky,
          route: {
            ...sky.route,
            rawPoints: undefined,
            pointSource: "generator16",
          },
        }
      : sky,
  );
  if (new TextEncoder().encode(text).length > MAX_JSON)
    throw new Error(
      "設定が大きすぎます。航路の点を減らしてから渡してください。",
    );
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const code = btoa(Array.from(bytes, (n) => String.fromCharCode(n)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  if (code.length > MAX_CODE)
    throw new Error("URLに収まるように航路の点を減らしてください。");
  return `${sky.version}.${code}`;
}
export async function decodeSky(code: string): Promise<SkyRecipe> {
  if (
    !/^[12]\./.test(code) ||
    code.length > MAX_CODE + 2 ||
    !/^[A-Za-z0-9_-]+$/.test(code.slice(2))
  )
    throw new Error("共有URLの形式を確認してください。");
  try {
    const bytes = Uint8Array.from(
      atob(code.slice(2).replaceAll("-", "+").replaceAll("_", "/")),
      (c) => c.charCodeAt(0),
    );
    const reader = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"))
      .getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_JSON) throw new Error("共有データが大きすぎます。");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.length;
    }
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(all),
    );
    if (
      object(value) &&
      object(value.route) &&
      value.route.pointSource === "generator16" &&
      value.route.rawPoints === undefined
    ) {
      validateGenerator(value.route.generator);
      value.route.rawPoints = generatedPoints(
        value.route.generator,
        value.route.generator.widthM,
        16,
      );
    }
    if (!object(value) || String(value.version) !== code[0])
      throw new Error("Version mismatch");
    return parseSky(value);
  } catch {
    throw new Error(
      "この共有URLを読み込めません。送り元で作り直してください。",
    );
  }
}
