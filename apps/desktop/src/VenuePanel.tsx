import { useEffect, useState } from "react";
import { checkedVenue, type VenueMap } from "../../../packages/core/src/venue";
import type { VrRuntime } from "./vr";

export function VenuePanel({
  venue,
  enabled,
  editable,
  vr,
  onSave,
  onLook,
}: {
  venue: VenueMap;
  enabled: boolean;
  editable: boolean;
  vr: VrRuntime;
  onSave: (venue: VenueMap) => void;
  onLook: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(venue));
  const [error, setError] = useState("");
  const sharedValue = JSON.stringify(venue);
  useEffect(() => {
    setDraft(JSON.parse(sharedValue) as VenueMap);
  }, [sharedValue]);
  const changePoint = (i: number, field: "name" | "x" | "z", value: string) => {
    const copy = structuredClone(draft);
    if (field === "name") copy.points[i].name = value;
    else copy.points[i][field] = value.trim() ? Number(value) : NaN;
    setDraft(copy);
  };
  const span = Math.max(
    4,
    ...venue.points.flatMap((p) => [Math.abs(p.x) + 1, Math.abs(p.z) + 1]),
  );
  const px = (x: number) => 160 + (x / span) * 140;
  const pz = (z: number) => 155 + (z / span) * 130;
  return (
    <details className="venue-panel">
      <summary>机の位置合わせ・会場マップ</summary>
      <p>PCで運営し、来場者はQuest 3で体験します。最初は仮の3地点です。</p>
      <svg viewBox="0 0 320 310" role="img" aria-label="会場の地点配置図">
        <rect width="320" height="310" rx="12" fill="#12353a" />
        <path d="M20 155H300M160 25V290" stroke="#476769" />
        <text x="160" y="300" textAnchor="middle" fontSize="12" fill="#fff">
          A 原点 / 右が+X・奥が−Z
        </text>
        {venue.points.map((p) => (
          <g key={p.id}>
            <circle
              cx={px(p.x)}
              cy={pz(p.z)}
              r="6"
              fill={p.id === venue.selectedId ? "#ffcc66" : "#8dddd0"}
            />
            <text
              x={px(p.x)}
              y={pz(p.z) - 12}
              textAnchor="middle"
              fill="#fff"
              fontSize="13"
            >
              {p.name.length > 10 ? `${p.name.slice(0, 10)}…` : p.name}
            </text>
          </g>
        ))}
      </svg>
      <div className="shared-actions">
        <button
          aria-pressed={
            vr.snapshot.showVenue && vr.snapshot.venueView === "overview"
          }
          onClick={() => vr.showVenue("overview")}
        >
          小さな地図で見る
        </button>
        <button
          aria-pressed={
            vr.snapshot.showVenue && vr.snapshot.venueView === "space"
          }
          onClick={() => {
            vr.showVenue("space");
            onLook();
          }}
        >
          実寸の地点を見る
        </button>
        <button
          disabled={!vr.snapshot.showVenue}
          onClick={() => vr.hideVenue()}
        >
          地図を隠す
        </button>
        <button
          onClick={() => {
            vr.toggleCalibrationMarkers();
            onLook();
          }}
        >
          {vr.snapshot.showCalibration ? "基準点を隠す" : "基準点を見る"}
        </button>
      </div>
      <p>
        小さな地図は目の前の配置図です。実寸表示は登録した距離で重ねます。
        ARで現地に合わせるには、運営者がQuestを装着して机の枠を配置してください。
        地図を縮めても飛行と音は変わりません。会場図の画像はまだ未登録です。
      </p>
      <p role="status">{vr.snapshot.calibrationMessage}</p>
      <p>
        Quest内の「見え方・操作案内」→「机と会場」→「机の枠を目の前へ」。
        A・Bが手前、C・Dが奥です。前後・左右・高さ・向きを調整し「この位置で使う」で確定します。
        指で操作できます。詳細なA・B・C測定はコントローラーを使う追加確認です。
      </p>
      <p>
        地点の配置・選択を共有します。表示の切り替えは自分だけです。ブース間の飛行は準備中です。
      </p>
      <div className="venue-selections">
        {venue.points.map((p) => (
          <button
            key={p.id}
            disabled={!enabled}
            aria-pressed={venue.selectedId === p.id}
            onClick={() => onSave({ ...venue, selectedId: p.id })}
          >
            {p.name}を選ぶ
          </button>
        ))}
        <button
          disabled={!enabled || !venue.selectedId}
          onClick={() => onSave({ ...venue, selectedId: null })}
        >
          地点の選択を外す
        </button>
      </div>
      {editable && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            try {
              const checked = checkedVenue(draft);
              setError("");
              onSave(checked);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "設定を確認してください。",
              );
            }
          }}
        >
          <fieldset className="shared-editor" disabled={!enabled}>
            <legend>この部屋の会場配置（m）</legend>
            <label>
              AとBの間隔
              <input
                aria-label="基準点の間隔"
                type="number"
                min="0.3"
                max="2"
                step="0.01"
                required
                value={Number.isFinite(draft.baselineM) ? draft.baselineM : ""}
                onChange={(e) =>
                  setDraft({ ...draft, baselineM: e.target.valueAsNumber })
                }
              />
            </label>
            <label>
              AとCの間隔（奥行き）
              <input
                aria-label="机の奥行き"
                type="number"
                min="0.3"
                max="2"
                step="0.01"
                required
                value={draft.tableDepthM ?? draft.baselineM}
                onChange={(e) =>
                  setDraft({ ...draft, tableDepthM: e.target.valueAsNumber })
                }
              />
            </label>
            <label>
              机の高さ
              <input
                aria-label="机の高さ"
                type="number"
                min="0.4"
                max="1.4"
                step="0.01"
                required
                value={
                  Number.isFinite(draft.tableHeightM) ? draft.tableHeightM : ""
                }
                onChange={(e) =>
                  setDraft({ ...draft, tableHeightM: e.target.valueAsNumber })
                }
              />
            </label>
            {draft.points.map((p, i) => (
              <div className="venue-edit-row" key={p.id}>
                <label>
                  地点{i + 1}
                  <input
                    aria-label={`地点${i + 1}の名前`}
                    required
                    maxLength={24}
                    value={p.name}
                    onChange={(e) => changePoint(i, "name", e.target.value)}
                  />
                </label>
                {(["x", "z"] as const).map((axis) => (
                  <label key={axis}>
                    {axis.toUpperCase()}
                    <input
                      aria-label={`地点${i + 1}の${axis}`}
                      type="number"
                      min="-25"
                      max="25"
                      step="0.1"
                      required
                      value={Number.isFinite(p[axis]) ? p[axis] : ""}
                      onChange={(e) => changePoint(i, axis, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            ))}
            {error && <p role="alert">{error}</p>}
            <button type="submit">会場の配置を共有に保存</button>
          </fieldset>
        </form>
      )}
    </details>
  );
}
