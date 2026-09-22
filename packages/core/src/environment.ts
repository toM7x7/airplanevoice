export const ENVIRONMENT_PRESETS = {
  airfield: {
    label: "空港",
    density: 0,
    heightM: 12,
    streetWidthM: 60,
    greenery: 0.2,
  },
  park: {
    label: "公園",
    density: 0.1,
    heightM: 18,
    streetWidthM: 80,
    greenery: 1,
  },
  city: {
    label: "都市",
    density: 0.85,
    heightM: 105,
    streetWidthM: 48,
    greenery: 0.12,
  },
  suburb: {
    label: "住宅街",
    density: 0.65,
    heightM: 10,
    streetWidthM: 30,
    greenery: 0.55,
  },
  coast: {
    label: "海辺",
    density: 0.18,
    heightM: 16,
    streetWidthM: 70,
    greenery: 0.35,
  },
} as const;
export interface EnvironmentRecipe {
  preset: keyof typeof ENVIRONMENT_PRESETS;
  name?: string;
  buildingSound?: boolean;
  seed: number;
  density: number;
  heightM: number;
  streetWidthM: number;
  greenery: number;
}
export function environmentPreset(
  preset: EnvironmentRecipe["preset"],
): EnvironmentRecipe {
  const { label: _, ...parameters } = ENVIRONMENT_PRESETS[preset];
  return { preset, seed: 7, ...parameters };
}
export const DEFAULT_ENVIRONMENT = environmentPreset("airfield");
export function checkedEnvironment(input: unknown): EnvironmentRecipe {
  if (!input || typeof input !== "object")
    throw new Error("景色の設定を確認してください。");
  const r = input as EnvironmentRecipe;
  if (
    !Object.hasOwn(ENVIRONMENT_PRESETS, r.preset) ||
    Object.keys(r).some(
      (k) =>
        ![
          "preset",
          "name",
          "buildingSound",
          "seed",
          "density",
          "heightM",
          "streetWidthM",
          "greenery",
        ].includes(k),
    )
  )
    throw new Error("景色の種類を確認してください。");
  if (
    r.name !== undefined &&
    (typeof r.name !== "string" ||
      !r.name.trim() ||
      r.name.length > 40 ||
      /[\u0000-\u001f]/.test(r.name))
  )
    throw new Error("景色の名前は1〜40文字で入力してください。");
  if (r.buildingSound !== undefined && typeof r.buildingSound !== "boolean")
    throw new Error("建物の音の設定を確認してください。");
  for (const [key, min, max] of [
    ["seed", 0, 9999],
    ["density", 0, 1],
    ["heightM", 4, 120],
    ["streetWidthM", 20, 100],
    ["greenery", 0, 1],
  ] as const)
    if (!Number.isFinite(r[key]) || r[key] < min || r[key] > max)
      throw new Error(`${key}の範囲を確認してください。`);
  if (!Number.isInteger(r.seed))
    throw new Error("配置番号は整数で指定してください。");
  return { ...r };
}
export type EnvironmentObject = {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  tone: number;
};
/** Bounded deterministic assets. The centre and runway/apron remain clear in every preset. */
export function environmentObjects(input: EnvironmentRecipe) {
  const r = checkedEnvironment(input),
    buildings: EnvironmentObject[] = [],
    trees: EnvironmentObject[] = [];
  let state = r.seed || 1;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let ix = -5; ix <= 5; ix++)
    for (let iz = -5; iz <= 5; iz++) {
      const x = ix * 68 + (random() - 0.5) * 14,
        z = iz * 68 + (random() - 0.5) * 14;
      if (
        Math.abs(x) < r.streetWidthM / 2 + 12 ||
        (z > -450 && z < -85) ||
        (r.preset === "coast" && x > 100)
      )
        continue;
      if (random() < r.density)
        buildings.push({
          x,
          z,
          width: 18 + random() * 17,
          depth: 19 + random() * 18,
          height: r.heightM * (0.5 + random() * 0.5),
          tone: random(),
        });
      else if (random() < r.greenery)
        trees.push({
          x,
          z,
          width: 5 + random() * 3,
          depth: 5 + random() * 3,
          height: 6 + random() * 6,
          tone: random(),
        });
    }
  return { buildings, trees };
}
export function changeEnvironment(source: EnvironmentRecipe, value: string) {
  if (value in ENVIRONMENT_PRESETS)
    return {
      ...environmentPreset(value as EnvironmentRecipe["preset"]),
      ...(source.name ? { name: source.name } : {}),
      ...(source.buildingSound !== undefined
        ? { buildingSound: source.buildingSound }
        : {}),
    };
  if (value.startsWith("name:"))
    return checkedEnvironment({ ...source, name: value.slice(5).trim() });
  if (value === "buildingSound:on" || value === "buildingSound:off")
    return { ...source, buildingSound: value.endsWith(":on") };
  const [key, raw] = value.split(":");
  if (
    !["seed", "density", "heightM", "streetWidthM", "greenery"].includes(key) ||
    !/^\d+(\.\d{1,2})?$/.test(raw ?? "")
  )
    throw new Error("景色の操作を確認してください。");
  return checkedEnvironment({ ...source, [key]: Number(raw) });
}
