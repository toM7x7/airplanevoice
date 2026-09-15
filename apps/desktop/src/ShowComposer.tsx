import { useState } from "react";
import {
  AIRCRAFT,
  AIRCRAFT_PATTERNS,
  ROUTE_PATTERNS,
  SHOW_PATTERNS,
  compileShow,
  showPattern,
  type Experience,
  type FlightId,
  type ShowRecipe,
  type ShowFlight,
} from "../../../packages/core/src";
import { AnchorMap } from "./Workshop";
import { ObservationDeck } from "./ObservationDeck";

export const SHOW_DRAFT_KEY = "sound-trail.desktop.show-draft.v1";
function initial(e: Experience) {
  if (e.show) return structuredClone(e.show);
  try {
    const s = localStorage.getItem(SHOW_DRAFT_KEY);
    if (s) return compileShow(JSON.parse(s)).recipe;
  } catch {
    /* A saved draft is optional. */
  }
  return showPattern();
}
export function ShowComposer({
  experience: e,
  onSave,
  onInspect,
}: {
  experience: Experience;
  onSave: () => void;
  onInspect: (id: FlightId) => void;
}) {
  const [draft, setDraft] = useState(() => initial(e));
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [code, setCode] = useState("");
  function apply(next: ShowRecipe) {
    setDraft(next);
    try {
      e.applyShow(next);
      onSave();
      try {
        localStorage.setItem(SHOW_DRAFT_KEY, JSON.stringify(e.show));
      } catch {
        /* Playing does not require storage. */
      }
      setError("");
      setStatus("この演目で飛ばせます。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("");
    }
  }
  function update(flight: ShowFlight) {
    const next = structuredClone(draft);
    next.flights[selected] = flight;
    apply(next);
  }
  const f = draft.flights[selected] ?? draft.flights[0],
    recipe = f.recipe,
    id = AIRCRAFT[selected].id;
  return (
    <section className="show-composer" aria-label="空の演目づくり">
      <h2>空に、順番と余白を。</h2>
      <p className="workshop-note">
        1機ずつ形・航路・開始時刻を決め、同じ空で試演します。
      </p>
      <div className="pattern-grid" aria-label="演目のパターン">
        {SHOW_PATTERNS.map((name, i) => (
          <button
            key={name}
            onClick={() => {
              setSelected(0);
              apply(showPattern(i));
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <label className="show-field">
        演目の名前
        <input
          aria-label="演目の名前"
          maxLength={48}
          value={draft.title}
          onChange={(event) => apply({ ...draft, title: event.target.value })}
        />
      </label>
      <label className="show-field">
        演目の機数
        <select
          aria-label="演目の機数"
          value={draft.flights.length}
          onChange={(event) => {
            const count = Number(event.target.value),
              next = structuredClone(draft);
            next.flights = Array.from(
              { length: count },
              (_, i) => next.flights[i] ?? showPattern(2).flights[i],
            );
            setSelected(Math.min(selected, count - 1));
            apply(next);
          }}
        >
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n}機
            </option>
          ))}
        </select>
      </label>
      {!e.show && (
        <button className="primary" onClick={() => apply(draft)}>
          この演目を反映
        </button>
      )}
      <div className="segmented show-flight-tabs" aria-label="編集する機体">
        {draft.flights.map((_, i) => (
          <button
            key={i}
            aria-label={`${AIRCRAFT[i].id}を編集`}
            aria-pressed={i === selected}
            onClick={() => {
              setSelected(i);
              if (e.show) onInspect(AIRCRAFT[i].id);
            }}
          >
            {AIRCRAFT[i].id}
          </button>
        ))}
      </div>
      <h3 style={{ color: AIRCRAFT[selected].accent }}>{id} のつくり方</h3>
      <label className="range-label">
        飛び始める時刻<span>{f.startSec} 秒後</span>
        <input
          aria-label={`${id}の開始時刻`}
          type="range"
          min={0}
          max={180}
          step={1}
          disabled={selected === 0}
          value={f.startSec}
          onChange={(event) =>
            update({ ...f, startSec: Number(event.target.value) })
          }
        />
      </label>
      <label className="show-field">
        機体のパターン
        <select
          aria-label="演目の機体パターン"
          value=""
          onChange={(event) => {
            update({
              ...f,
              recipe: {
                ...recipe,
                aircraft: {
                  ...AIRCRAFT_PATTERNS[Number(event.target.value)].aircraft,
                },
              },
            });
            onInspect(id);
          }}
        >
          <option value="" disabled>
            形の出発点を選ぶ
          </option>
          {AIRCRAFT_PATTERNS.map((p, i) => (
            <option key={p.name} value={i}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="show-field">
        航路のパターン
        <select
          aria-label="演目の航路パターン"
          value=""
          onChange={(event) => {
            const p = ROUTE_PATTERNS[Number(event.target.value)];
            update({
              ...f,
              recipe: {
                ...recipe,
                route: structuredClone(p.route),
                flight: { ...p.flight },
              },
            });
          }}
        >
          <option value="" disabled>
            飛び方の出発点を選ぶ
          </option>
          {ROUTE_PATTERNS.map((p, i) => (
            <option key={p.name} value={i}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="show-summary">
        翼 {recipe.aircraft.wingSpanM}m · {recipe.aircraft.engineCount}基<br />
        高度 {recipe.route.altitudeM}m · {recipe.flight.speedMps}m/s
      </div>
      <details className="show-details">
        <summary>機体・航路を細かく調整</summary>
        {(
          [
            ["bodyLengthM", "演目の胴体の長さ", 50, 85],
            ["wingSpanM", "演目の翼の幅", 45, 85],
          ] as const
        ).map(([key, label, min, max]) => (
          <label className="range-label" key={key}>
            {label}
            <span>{recipe.aircraft[key]}m</span>
            <input
              type="range"
              aria-label={label}
              min={min}
              max={max}
              value={recipe.aircraft[key]}
              onChange={(event) =>
                update({
                  ...f,
                  recipe: {
                    ...recipe,
                    aircraft: {
                      ...recipe.aircraft,
                      [key]: Number(event.target.value),
                    },
                  },
                })
              }
            />
          </label>
        ))}
        <label className="show-field">
          エンジン数
          <select
            aria-label="演目のエンジン数"
            value={recipe.aircraft.engineCount}
            onChange={(event) =>
              update({
                ...f,
                recipe: {
                  ...recipe,
                  aircraft: {
                    ...recipe.aircraft,
                    engineCount: Number(event.target.value) as 2 | 4,
                  },
                },
              })
            }
          >
            <option value={2}>2基</option>
            <option value={4}>4基</option>
          </select>
        </label>
        <AnchorMap
          generator={recipe.route}
          route={e.show ? e.routeFor(id).samples.map((s) => s.position) : []}
          onChange={(route) => update({ ...f, recipe: { ...recipe, route } })}
        />
        <div className="anchor-fields">
          {(["a", "b"] as const).map((name) => (
            <fieldset key={name}>
              <legend>{name.toUpperCase()} 地点</legend>
              {(["x", "z"] as const).map((axis) => (
                <label key={axis}>
                  {axis.toUpperCase()}
                  <input
                    type="number"
                    step={50}
                    aria-label={`演目の${name.toUpperCase()}地点${axis.toUpperCase()}`}
                    value={recipe.route[name][axis]}
                    onChange={(event) =>
                      update({
                        ...f,
                        recipe: {
                          ...recipe,
                          route: {
                            ...recipe.route,
                            [name]: {
                              ...recipe.route[name],
                              [axis]: Number(event.target.value),
                            },
                          },
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
            ["altitudeM", "演目の高度", 140, 500, 10],
            ["widthM", "演目の幅", 400, 1500, 50],
            ["variation", "演目のゆらぎ", 0, 1, 0.05],
          ] as const
        ).map(([key, label, min, max, step]) => (
          <label className="range-label" key={key}>
            {label}
            <span>{recipe.route[key]}</span>
            <input
              type="range"
              aria-label={label}
              min={min}
              max={max}
              step={step}
              value={recipe.route[key]}
              onChange={(event) =>
                update({
                  ...f,
                  recipe: {
                    ...recipe,
                    route: {
                      ...recipe.route,
                      [key]: Number(event.target.value),
                    },
                  },
                })
              }
            />
          </label>
        ))}
        <label className="show-field">
          シード
          <input
            aria-label="演目のシード"
            type="number"
            min={0}
            max={2147483647}
            step={1}
            value={recipe.route.seed}
            onChange={(event) =>
              update({
                ...f,
                recipe: {
                  ...recipe,
                  route: { ...recipe.route, seed: Number(event.target.value) },
                },
              })
            }
          />
        </label>
        <label className="range-label">
          演目の速度<span>{recipe.flight.speedMps}m/s</span>
          <input
            aria-label="演目の速度"
            type="range"
            min={35}
            max={75}
            value={recipe.flight.speedMps}
            onChange={(event) =>
              update({
                ...f,
                recipe: {
                  ...recipe,
                  flight: {
                    ...recipe.flight,
                    speedMps: Number(event.target.value),
                  },
                },
              })
            }
          />
        </label>
        <label className="range-label">
          演目の傾きの追従<span>{recipe.flight.bankResponseSec}秒</span>
          <input
            aria-label="演目の傾きの追従"
            type="range"
            min={0}
            max={3}
            step={0.2}
            value={recipe.flight.bankResponseSec}
            onChange={(event) =>
              update({
                ...f,
                recipe: {
                  ...recipe,
                  flight: {
                    ...recipe.flight,
                    bankResponseSec: Number(event.target.value),
                  },
                },
              })
            }
          />
        </label>
        <button className="secondary" onClick={() => onInspect(id)}>
          この機体を近くで見る
        </button>
      </details>
      {error && (
        <p role="alert" className="workshop-error">
          {error}
          <br />
          直前の有効な演目を保っています。
        </p>
      )}
      {status && (
        <p role="status" className="workshop-status">
          {status}
        </p>
      )}
      {e.show && <ObservationDeck experience={e} />}
      <details className="show-details">
        <summary>演目をJSONで保存・読み込み</summary>
        <textarea
          aria-label="演目JSON"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          rows={8}
          spellCheck={false}
        />
        <button
          className="secondary"
          onClick={() => setCode(JSON.stringify(e.show ?? draft, null, 2))}
        >
          現在の演目をJSONにする
        </button>
        <button
          className="secondary"
          onClick={() => {
            try {
              if (code.length > 40000)
                throw new Error("演目JSONが大きすぎます。");
              const next = compileShow(JSON.parse(code)).recipe;
              setSelected(0);
              apply(next);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          演目JSONを適用
        </button>
        <button
          className="text-button"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(e.show ?? draft, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "sound-trail-show.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          演目を書き出す ↓
        </button>
      </details>
    </section>
  );
}
