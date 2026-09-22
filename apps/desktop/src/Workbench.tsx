import { useEffect, useState } from "react";
import {
  AIRCRAFT_PATTERNS,
  ROUTE_PATTERNS,
  type WorkshopRecipe,
} from "../../../packages/core/src";
import {
  AIRCRAFT_COLORS,
  SOUND_CHOICES,
  type CreationState,
} from "../../../packages/core/src/creation";
import type { HangarEntry } from "../../../packages/core/src/hangar";
import "./workbench.css";
import { exportCreations, importCreations } from "./creation-workspace";

export type DesktopPlace = "hangar" | "edit" | "observe" | "operator";
export type PreviewBackground = "hangar" | "airport" | "sky" | "live";
export type EditorCategory = "shape" | "color" | "sound" | "route" | "name";
export const CATEGORIES: [EditorCategory, string][] = [
  ["shape", "形"],
  ["color", "色"],
  ["sound", "音"],
  ["route", "航路"],
  ["name", "名前"],
];

export function Workbench({
  place,
  navigate,
  category,
  setCategory,
  background,
  setBackground,
  state,
  library,
  run,
  patch,
  select,
  fresh,
  message,
  canFly,
  canShare,
  cloud,
  cloudSaved,
  cloudBusy,
  localOnlyCount,
  uploadLocal,
  model,
  resting,
  listen,
  rest,
  volume,
  setVolume,
  flightLabel,
  highlight,
  ai,
  ambience,
  toggleAmbience,
  interfaceSound,
  toggleInterfaceSound,
  soundDisplay,
}: {
  place: DesktopPlace;
  navigate: (place: DesktopPlace) => void;
  category: EditorCategory;
  setCategory: (category: EditorCategory) => void;
  background: PreviewBackground;
  setBackground: (background: PreviewBackground) => void;
  state: CreationState;
  library: { entry: HangarEntry; place: string }[];
  run: (value: string) => void;
  patch: (recipe: WorkshopRecipe) => void;
  select: (entry: HangarEntry) => void;
  fresh: () => void;
  message: string;
  canFly: boolean;
  canShare: boolean;
  cloud?: boolean;
  cloudSaved?: boolean;
  cloudBusy?: boolean;
  localOnlyCount?: number;
  uploadLocal?: () => void;
  model: (command: number) => void;
  resting: boolean;
  listen: () => void;
  rest: () => void;
  volume: number;
  setVolume: (volume: number) => void;
  flightLabel: string;
  highlight?: string;
  ai: () => void;
  ambience: boolean;
  toggleAmbience: () => void;
  interfaceSound: boolean;
  soundDisplay?: import("react").ReactNode;
  toggleInterfaceSound: () => void;
}) {
  const { recipe, name } = state.entry;
  const [nameInput, setNameInput] = useState(name);
  const [transferNote, setTransferNote] = useState("");
  useEffect(() => setNameInput(name), [name, state.entry.id]);
  const commitName = () => {
    if (nameInput.trim() && nameInput.trim() !== name) run(`name:${nameInput}`);
    else if (!nameInput.trim()) setNameInput(name);
  };
  const action = (value: string, label: string, chosen = false) => (
    <button
      key={value}
      data-creation-action={value}
      data-guide={highlight === value || undefined}
      aria-pressed={chosen}
      onClick={() => run(value)}
    >
      {label}
    </button>
  );
  const aircraft = recipe.aircraft;
  const numeric = (
    label: string,
    value: number,
    min: number,
    max: number,
    unit: string,
    change: (value: number) => void,
    step = 1,
  ) => (
    <label className="wb-range">
      {label}
      <output>
        {Math.round(value * 100) / 100}
        {unit}
      </output>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => change(Number(e.target.value))}
      />
    </label>
  );
  if (place === "operator") return null;
  return (
    <div className={`workbench wb-${place}`} data-ai-control="creation">
      {place !== "observe" && (
        <>
          <div className="wb-heading">
            <span className="wb-kicker">
              {place === "hangar" ? "YOUR HANGAR" : "AIRCRAFT STUDIO"}
            </span>
            <h1>
              {place === "hangar"
                ? "あなたの一機を、空へ。"
                : "空に映える一機をつくる。"}
            </h1>
            <p>
              {place === "hangar"
                ? "形を選び、響きを整え、飛んでいく姿を見上げる。"
                : "同じ機体を、格納庫・空港・空で見比べよう。"}
            </p>
          </div>
          <div
            className="wb-background"
            role="group"
            aria-label="背景を見比べる"
          >
            {(
              [
                ["hangar", "格納庫"],
                ["airport", "空港"],
                ["sky", "空"],
                ["live", "飛行中の空"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                aria-pressed={background === id}
                onClick={() => setBackground(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            className="wb-model-tools"
            role="group"
            aria-label="模型を見回す"
          >
            <span>
              機体の周りをドラッグで回転 · Shiftを押しながらドラッグで移動
            </span>
            {[
              "左へ回す",
              "右へ回す",
              "大きく",
              "小さく",
              "手元へ戻す",
              "向きを戻す",
            ].map((label, i) => (
              <button key={label} onClick={() => model(i)}>
                {label}
              </button>
            ))}
            <button aria-pressed={ambience} onClick={toggleAmbience}>
              風の環境音 {ambience ? "オン" : "オフ"}
            </button>
            <button
              aria-pressed={interfaceSound}
              onClick={toggleInterfaceSound}
            >
              操作音 {interfaceSound ? "オン" : "オフ"}
            </button>
            {soundDisplay}
          </div>
        </>
      )}
      {place === "hangar" && (
        <aside className="wb-library" data-ai-control="hangar">
          <div className="wb-section-title">
            <h2>{cloud ? "クラウド格納庫" : "格納庫"}</h2>
            <span>{library.length}機</span>
          </div>
          <button className="wb-primary" onClick={fresh}>
            新しい一機をつくる
          </button>
          <p>保存した機体を選ぶと、模型で確認できます。</p>
          {cloud && (
            <p>
              PC・Questで同じ機体を呼び出せます。編集後は保存して反映します。
            </p>
          )}
          {cloud && !!localOnlyCount && (
            <button disabled={cloudBusy} onClick={uploadLocal}>
              この端末の{localOnlyCount}機をクラウドへ保存
            </button>
          )}
          <details className="wb-hangar-transfer">
            <summary>
              {cloud
                ? "機体のバックアップ・以前のURLから読み込む"
                : "格納庫を別のURLへ引っ越す"}
            </summary>
            <button
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob(
                    [exportCreations(library.map((item) => item.entry))],
                    { type: "application/json" },
                  ),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = "airplanevoice-hangar.json";
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              格納庫をファイルに保存
            </button>
            <label>
              格納庫ファイルを読み込む
              <input
                type="file"
                accept="application/json,.json"
                onChange={async (event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (!file) return;
                  try {
                    setTransferNote(
                      `${importCreations(await file.text())}機を格納庫に用意しました。`,
                    );
                  } catch (error) {
                    setTransferNote(
                      error instanceof Error
                        ? error.message
                        : "ファイルを確認してください。",
                    );
                  }
                }}
              />
            </label>
            <p>
              {transferNote ||
                (cloud
                  ? "一覧の機体をファイルに保存できます。読み込み後は「この端末の機体をクラウドへ保存」で反映します。"
                  : "このブラウザに保存した機体だけを移します。")}
            </p>
          </details>
          <div className="wb-aircraft-list">
            {library.length === 0 ? (
              <p className="wb-empty">
                まだ保存した機体はありません。
                <br />
                まずは、目の前の一機から。
              </p>
            ) : (
              library.map(({ entry, place }) => (
                <button
                  key={`${place}-${entry.id}`}
                  aria-pressed={state.entry.id === entry.id}
                  onClick={() => select(entry)}
                >
                  <i
                    style={{
                      background: entry.recipe.aircraft.color ?? "#205963",
                    }}
                  />
                  <span>
                    <strong>{entry.name}</strong>
                    <small>
                      {entry.recipe.aircraft.engineCount}発 / 全長{" "}
                      {entry.recipe.aircraft.bodyLengthM}m · {place}
                    </small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              ))
            )}
          </div>
        </aside>
      )}
      {place === "edit" && (
        <>
          <nav className="wb-categories" aria-label="機体の編集項目">
            <label>
              保存した機体を呼び出す
              <select
                aria-label="保存した機体を呼び出す"
                value=""
                onChange={(event) => {
                  const item = library[Number(event.target.value)];
                  if (item) select(item.entry);
                }}
              >
                <option value="" disabled>
                  名前を選んで再編集
                </option>
                {library.map(({ entry, place }, index) => (
                  <option key={`${place}-${entry.id}`} value={index}>
                    {entry.name}（{place}）
                  </option>
                ))}
              </select>
            </label>
            {CATEGORIES.map(([id, label], i) => (
              <button
                key={id}
                aria-current={category === id ? "page" : undefined}
                onClick={() => setCategory(id)}
              >
                <span>0{i + 1}</span>
                {label}
              </button>
            ))}
            <button
              className="wb-undo"
              data-creation-action="undo"
              onClick={() => run("undo")}
            >
              ひとつ戻す
            </button>
            <button onClick={ai}>AIと相談する</button>
          </nav>
          <aside className="wb-inspector" aria-label="選んだ項目の設定">
            <span className="wb-kicker">CUSTOMIZE</span>
            <h2>{CATEGORIES.find(([id]) => id === category)?.[1]}を整える</h2>
            {category === "shape" && (
              <>
                <p>基本の形を選び、長さや翼幅を調整します。</p>
                <div className="wb-choices">
                  {AIRCRAFT_PATTERNS.map((p, i) =>
                    action(
                      `shape:${i}`,
                      p.name,
                      p.aircraft.bodyLengthM === aircraft.bodyLengthM &&
                        p.aircraft.wingSpanM === aircraft.wingSpanM &&
                        p.aircraft.engineCount === aircraft.engineCount,
                    ),
                  )}
                </div>
                {numeric("機体の長さ", aircraft.bodyLengthM, 50, 85, "m", (v) =>
                  patch({
                    ...recipe,
                    aircraft: { ...aircraft, bodyLengthM: v },
                  }),
                )}
                {numeric("翼の幅", aircraft.wingSpanM, 45, 85, "m", (v) =>
                  patch({ ...recipe, aircraft: { ...aircraft, wingSpanM: v } }),
                )}
                <small>模型の表示倍率と、飛行時の実寸は別です。</small>
                {numeric("胴体の太さ",aircraft.bodyWidthM??6.2,4.5,8,"m",v=>run(`width:${v}`),.1)}
                {numeric("翼の後退角",aircraft.wingSweepDeg??30,20,38,"°",v=>run(`sweep:${v}`))}
                {numeric("エンジンの大きさ",aircraft.engineScale??1,.8,1.3,"倍",v=>run(`engineSize:${v}`),.05)}
                {numeric("翼端の高さ",aircraft.wingletHeightM??0,0,3,"m",v=>run(`winglet:${v}`),.1)}
                <div className="wb-choices">{[2,4].map(n=>action(`engines:${n}`,`${n}発`,aircraft.engineCount===n))}</div>
              </>
            )}
            {category === "color" && (
              <>
                <p>尾翼とエンジンの色を変えます。</p>
                <div className="wb-colors">
                  {AIRCRAFT_COLORS.map((c, i) => (
                    <button
                      key={c.color}
                      data-creation-action={`color:${i}`}
                      data-guide={highlight === `color:${i}` || undefined}
                      aria-pressed={(aircraft.color ?? "#205963") === c.color}
                      onClick={() => run(`color:${i}`)}
                    >
                      <i style={{ background: c.color }} />
                      {c.name}
                    </button>
                  ))}
                </div>
                <p>背景を切り替えて、空との映え方を比べてみよう。</p>
                <label>尾翼の自由色 <input aria-label="尾翼の自由色" type="color" value={aircraft.color??"#205963"} onChange={e=>run(`accent:${e.target.value}`)}/></label>
                <label>胴体の色 <input aria-label="胴体の色" type="color" value={aircraft.bodyColor??"#eceeea"} onChange={e=>run(`paint:${e.target.value}`)}/></label>
              </>
            )}
            {category === "sound" && (
              <>
                <p>旅客機の深い響きを土台に、少しずつ整えます。</p>
                <div className="wb-choices">
                  {SOUND_CHOICES.map((p, i) =>
                    action(
                      `tone:${i}`,
                      p.name,
                      JSON.stringify(p.sound) ===
                        JSON.stringify(aircraft.sound),
                    ),
                  )}
                </div>
                {(
                  [
                    ["body", "低い響き"],
                    ["fan", "ファンの響き"],
                    ["air", "気流の響き"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    {numeric(
                      label,
                      Math.round(
                        (aircraft.sound?.[key] ?? SOUND_CHOICES[0].sound[key]) *
                          100,
                      ),
                      0,
                      100,
                      "%",
                      (v) =>
                        patch({
                          ...recipe,
                          aircraft: {
                            ...aircraft,
                            sound: {
                              ...(aircraft.sound ?? SOUND_CHOICES[0].sound),
                              [key]: v / 100,
                            },
                          },
                        }),
                    )}
                  </div>
                ))}
                <div className="wb-inline">
                  {action("listen", "今の音を聴く")}
                  {action("compare", "基準と聴き比べる")}
                </div>
                <small>
                  飛行時には、距離・向き・音の届く時間で響きが変わります。
                </small>
              </>
            )}
            {category === "route" && (
              <>
                <p>
                  飛び方の出発点を選びます。変更は次に飛ばす機体へ反映されます。
                </p>
                <div className="wb-choices">
                  {ROUTE_PATTERNS.map((p) => (
                    <button
                      key={p.name}
                      onClick={() =>
                        patch({
                          ...recipe,
                          route: structuredClone(p.route),
                          flight: { ...p.flight },
                        })
                      }
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
                {numeric(
                  "飛行する高さ",
                  recipe.route.altitudeM,
                  140,
                  500,
                  "m",
                  (v) =>
                    patch({
                      ...recipe,
                      route: { ...recipe.route, altitudeM: v },
                    }),
                  10,
                )}
                {numeric(
                  "飛行速度",
                  recipe.flight.speedMps,
                  35,
                  75,
                  "m/s",
                  (v) =>
                    patch({
                      ...recipe,
                      flight: { ...recipe.flight, speedMps: v },
                    }),
                )}
              </>
            )}
            {category === "name" && (
              <>
                <p>格納庫から呼び出すときの名前です。</p>
                <label className="wb-name">
                  機体の名前
                  <input
                    aria-label="制作中の機体の名前"
                    maxLength={40}
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onBlur={commitName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        commitName();
                        e.currentTarget.blur();
                      }
                    }}
                  />
                </label>
                <small>40文字まで。日本語も使えます。</small>
              </>
            )}
          </aside>
        </>
      )}
      {place === "observe" ? (
        <>
          <div className="wb-observation-title">
            <span className="wb-kicker">LISTEN TO THE SKY</span>
            <h1>音のする方へ。</h1>
            <p>{flightLabel}</p>
          </div>
          <div className="wb-observation-dock">
            <button onClick={() => navigate("hangar")}>格納庫へ</button>
            <button onClick={() => navigate("edit")}>この機体を編集</button>
            <button
              className="wb-primary"
              data-ai-control="sound"
              onClick={resting ? listen : rest}
            >
              {resting ? "音を聴く" : "音を止める"}
            </button>
            <label>
              音量{" "}
              <input
                aria-label="観察の音量"
                data-ai-control="volume"
                type="range"
                min={0}
                max={70}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
              />
              <output>{volume}%</output>
            </label>
          </div>
        </>
      ) : (
        <footer className="wb-footer">
          <div>
            <strong>{name}</strong>
            <small>
              {aircraft.engineCount}発 · 全長 {aircraft.bodyLengthM}m · 翼幅{" "}
              {aircraft.wingSpanM}m{" "}
              <span>
                {cloud
                  ? cloudBusy
                    ? "保存中…"
                    : cloudSaved
                      ? "クラウド保存済み"
                      : "クラウド未保存"
                  : state.dirty
                    ? "未保存"
                    : "保存済み"}
              </span>
            </small>
          </div>
          <div className="wb-footer-actions">
            {place === "hangar" ? (
              <button onClick={() => navigate("edit")}>この機体を編集</button>
            ) : (
              <>
                <button
                  data-creation-action="save"
                  data-guide={highlight === "save" || undefined}
                  disabled={cloudBusy}
                  onClick={() => run("save")}
                >
                  {cloud ? "クラウド格納庫に保存" : "格納庫に保存"}
                </button>
                {canShare && !cloud && (
                  <button
                    data-creation-action="share"
                    onClick={() => run("share")}
                  >
                    部屋にも保存
                  </button>
                )}
              </>
            )}
            <button
              className="wb-primary"
              data-creation-action="fly"
              data-guide={highlight === "fly" || undefined}
              disabled={!canFly}
              onClick={() => {
                commitName();
                run("fly");
              }}
            >
              この機体を飛ばす <span aria-hidden="true">↗</span>
            </button>
          </div>
        </footer>
      )}
      {message && (
        <p className="wb-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
