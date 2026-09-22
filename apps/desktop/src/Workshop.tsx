import { CreationShelf } from "./CreationShelf";
import { useState } from "react";
import {
  DEFAULT_WORKSHOP,
  AIRCRAFT_PATTERNS,
  ROUTE_PATTERNS,
  parseWorkshop,
  type Experience,
  type WorkshopRecipe,
  type RouteGenerator,
  type Vec3,
} from "../../../packages/core/src";

export function Workshop({
  experience: e,
  onSave,
  onInspect,
}: {
  experience: Experience;
  onSave: () => void;
  onInspect: () => void;
}) {
  const [tab, setTab] = useState<"aircraft" | "route" | "recipe">("aircraft");
  const current = (): WorkshopRecipe => ({
    version: 1,
    aircraft: e.aircraftDesign,
    route: e.spec.generator ?? DEFAULT_WORKSHOP.route,
    flight: e.spec.flight ?? DEFAULT_WORKSHOP.flight,
  });
  const [draft, setDraft] = useState<WorkshopRecipe>(() =>
    structuredClone(current()),
  );
  const [code, setCode] = useState(() => JSON.stringify(current(), null, 2));
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  function apply(recipe: WorkshopRecipe) {
    try {
      e.applyWorkshop(recipe);
      onInspect();
      onSave();
      setError("");
      setStatus("航路と機体に反映しました。");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("");
      return false;
    }
  }
  function updateRoute(route: RouteGenerator) {
    const next = { ...draft, aircraft: e.aircraftDesign, route };
    setDraft(next);
    if (e.spec.generator) apply(next);
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(current(), null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "sound-trail-recipe.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const anchors = e.spec.generator ?? draft.route;
  return (
    <section className="workshop-panel" aria-label="つくる実験室">
      <CreationShelf
        recipe={current()}
        enabled={e.canEdit}
        onLoad={(recipe) => {
          e.applyWorkshop(recipe);
          setDraft(recipe);
          onSave();
        }}
      />
      <div className="segmented workshop-tabs">
        <button
          aria-pressed={tab === "aircraft"}
          onClick={() => setTab("aircraft")}
        >
          1 機体
        </button>
        <button aria-pressed={tab === "route"} onClick={() => setTab("route")}>
          2 航路
        </button>
        <button
          aria-pressed={tab === "recipe"}
          onClick={() => {
            setCode(JSON.stringify(current(), null, 2));
            setTab("recipe");
            setError("");
          }}
        >
          レシピ
        </button>
      </div>
      {tab === "aircraft" && (
        <>
          <h2>形をいじる、空で見る。</h2>
          <div className="pattern-grid" aria-label="機体のパターン">
            {AIRCRAFT_PATTERNS.map((p) => (
              <button
                key={p.name}
                onClick={() => {
                  e.setAircraftDesign(p.aircraft);
                  onInspect();
                  onSave();
                }}
              >
                {p.name}
                <small>
                  {p.aircraft.engineCount}基 · 翼 {p.aircraft.wingSpanM}m
                </small>
              </button>
            ))}
          </div>
          {(
            [
              ["bodyLengthM", "胴体の長さ", 50, 85],
              ["wingSpanM", "翼の幅", 45, 85],
            ] as const
          ).map(([key, label, min, max]) => (
            <label className="range-label" key={key}>
              {label}
              <span>{e.aircraftDesign[key]} m</span>
              <input
                aria-label={label}
                type="range"
                min={min}
                max={max}
                step={1}
                value={e.aircraftDesign[key]}
                onChange={(event) => {
                  e.setAircraftDesign({
                    ...e.aircraftDesign,
                    [key]: Number(event.target.value),
                  });
                  onSave();
                }}
              />
            </label>
          ))}
          <p className="workshop-label">エンジンの数</p>
          <div className="segmented">
            {([2, 4] as const).map((n) => (
              <button
                key={n}
                aria-pressed={e.aircraftDesign.engineCount === n}
                onClick={() => {
                  e.setAircraftDesign({ ...e.aircraftDesign, engineCount: n });
                  onSave();
                }}
              >
                {n}基
              </button>
            ))}
          </div>
          <button className="secondary workshop-action" onClick={onInspect}>
            機体を近くで見る
          </button>
          <p className="workshop-note">
            パターンを出発点に、寸法と配置を調律。双発と四発で合成音の厚みも変わります。
          </p>
        </>
      )}
      {tab === "route" && (
        <>
          <h2>ここから、あそこへ。</h2>
          <div className="pattern-grid" aria-label="航路のパターン">
            {ROUTE_PATTERNS.map((p) => (
              <button
                key={p.name}
                onClick={() => {
                  const next: WorkshopRecipe = {
                    version: 1,
                    aircraft: e.aircraftDesign,
                    route: structuredClone(p.route),
                    flight: { ...p.flight },
                  };
                  if (apply(next)) setDraft(next);
                }}
              >
                {p.name}
                <small>
                  {p.route.altitudeM}m · {p.flight.speedMps}m/s
                </small>
              </button>
            ))}
          </div>
          <p className="workshop-note">
            AとBを通る空中の往復航路。地図を押すか、数値で2地点を置けます。追加機は位置をずらして飛びます。
          </p>
          <AnchorMap
            generator={anchors}
            route={
              e.spec.generator ? e.route.samples.map((s) => s.position) : []
            }
            onChange={updateRoute}
          />
          <div className="anchor-fields">
            {(["a", "b"] as const).map((name) => (
              <fieldset key={name}>
                <legend>{name.toUpperCase()} 地点</legend>
                {(["x", "z"] as const).map((axis) => (
                  <label key={axis}>
                    {axis.toUpperCase()}
                    <input
                      aria-label={`${name.toUpperCase()}地点の${axis.toUpperCase()}`}
                      type="number"
                      step={100}
                      value={draft.route[name][axis]}
                      onChange={(event) =>
                        updateRoute({
                          ...draft.route,
                          [name]: {
                            ...draft.route[name],
                            [axis]: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          {(
            [
              ["altitudeM", "通過高度", 140, 500, 10, "m"],
              ["widthM", "回り込みの幅", 400, 1500, 50, "m"],
              ["variation", "ゆらぎの量", 0, 1, 0.05, ""],
            ] as const
          ).map(([key, label, min, max, step, unit]) => (
            <label className="range-label" key={key}>
              {label}
              <span>
                {draft.route[key]} {unit}
              </span>
              <input
                aria-label={label}
                type="range"
                min={min}
                max={max}
                step={step}
                value={draft.route[key]}
                onChange={(event) =>
                  updateRoute({
                    ...draft.route,
                    [key]: Number(event.target.value),
                  })
                }
              />
            </label>
          ))}
          {(
            [
              ["speedMps", "飛行速度", 35, 75, 1, "m/s"],
              ["bankResponseSec", "傾きの追従時間", 0, 3, 0.2, "秒"],
            ] as const
          ).map(([key, label, min, max, step, unit]) => (
            <label className="range-label" key={key}>
              {label}
              <span>
                {draft.flight[key]} {unit}
              </span>
              <input
                aria-label={label}
                type="range"
                min={min}
                max={max}
                step={step}
                value={draft.flight[key]}
                onChange={(event) => {
                  const next = {
                    ...draft,
                    aircraft: e.aircraftDesign,
                    flight: {
                      ...draft.flight,
                      [key]: Number(event.target.value),
                    },
                  };
                  setDraft(next);
                  if (e.spec.generator) apply(next);
                }}
              />
            </label>
          ))}
          <div className="seed-row">
            <label>
              シード
              <input
                aria-label="シード"
                type="number"
                min={0}
                max={2147483647}
                step={1}
                value={draft.route.seed}
                onChange={(event) =>
                  updateRoute({
                    ...draft.route,
                    seed: Number(event.target.value),
                  })
                }
              />
            </label>
            <button
              onClick={() =>
                updateRoute({
                  ...draft.route,
                  seed: (draft.route.seed + 1) % 2147483648,
                })
              }
            >
              別のゆらぎ
            </button>
          </div>
          <button
            className="secondary workshop-action"
            onClick={() => apply({ ...draft, aircraft: e.aircraftDesign })}
          >
            この2点で航路を作る
          </button>
          <p className="workshop-note">
            同じシードで同じ飛び方に戻せます。追従時間を長くすると、機体の傾きがゆっくり変わります。
          </p>
        </>
      )}
      {tab === "recipe" && (
        <>
          <h2>数値を、レシピに。</h2>
          <p className="workshop-note">
            JSONを書き換えて適用。画面の操作と同じ設定を使います。航路は2点往復の形式です。
          </p>
          <textarea
            aria-label="レシピJSON"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button
            className="secondary workshop-action"
            onClick={() => {
              try {
                const recipe = parseWorkshop(code);
                if (apply(recipe)) setDraft(recipe);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                setStatus("");
              }
            }}
          >
            レシピを適用
          </button>
          <button
            className="text-button"
            disabled={!e.spec.generator}
            onClick={download}
          >
            レシピを書き出す ↓
          </button>
          <p className="workshop-note">
            気に入った設定を書き出し、後から貼り付けて再現できます。
          </p>
        </>
      )}
      {e.route.notices.map((n) => (
        <p className="route-notice" key={n}>
          {n}
        </p>
      ))}
      {error && (
        <p className="workshop-error" role="alert">
          {error}
          <br />
          直前の有効な機体・航路を保っています。
        </p>
      )}
      {status && !error && (
        <p className="workshop-status" role="status">
          {status}
        </p>
      )}
    </section>
  );
}

export function AnchorMap({
  generator: g,
  onChange,
  route,
}: {
  generator: RouteGenerator;
  onChange: (g: RouteGenerator) => void;
  route: Vec3[];
}) {
  const [target, setTarget] = useState<"a" | "b">("a");
  const point = (p: { x: number; z: number }) => ({
    x: 12 + ((p.x + 3000) / 6000) * 260,
    y: 12 + ((p.z + 4200) / 4800) * 164,
  });
  const a = point(g.a),
    b = point(g.b);
  return (
    <div className="anchor-map">
      <div className="segmented">
        <button aria-pressed={target === "a"} onClick={() => setTarget("a")}>
          Aを置く
        </button>
        <button aria-pressed={target === "b"} onClick={() => setTarget("b")}>
          Bを置く
        </button>
      </div>
      <svg
        viewBox="0 0 284 188"
        aria-label="2地点の地図"
        role="img"
        onPointerDown={(event) => {
          const p = event.currentTarget.createSVGPoint();
          p.x = event.clientX;
          p.y = event.clientY;
          const local = p.matrixTransform(
            event.currentTarget.getScreenCTM()!.inverse(),
          );
          onChange({
            ...g,
            [target]: {
              x:
                Math.round(
                  Math.max(
                    -3000,
                    Math.min(3000, ((local.x - 12) / 260) * 6000 - 3000),
                  ) / 50,
                ) * 50,
              z:
                Math.round(
                  Math.max(
                    -4200,
                    Math.min(600, ((local.y - 12) / 164) * 4800 - 4200),
                  ) / 50,
                ) * 50,
            },
          });
          setTarget(target === "a" ? "b" : "a");
        }}
      >
        <rect width={284} height={188} fill="#e8eee4" />
        <path
          d={
            route
              .map((p, i) => {
                const q = point(p);
                return `${i ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
              })
              .join(" ") + (route.length ? " Z" : "")
          }
          fill="none"
          stroke="#326861"
          strokeWidth={1.5}
        />
        <line
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke="#91aaa0"
          strokeDasharray="4 4"
        />
        {[g.a, g.b].map((p, i) => {
          const q = point(p);
          return (
            <g key={i}>
              <circle
                cx={q.x}
                cy={q.y}
                r={6}
                fill={i ? "#a56a46" : "#326861"}
              />
              <text x={q.x + 10} y={q.y + 4} fontSize={12} fill="#29443e">
                {i ? "B" : "A"}
              </text>
            </g>
          );
        })}
        <text x={12} y={18} fontSize={9} fill="#748574">
          N ↑ · m
        </text>
      </svg>
    </div>
  );
}
