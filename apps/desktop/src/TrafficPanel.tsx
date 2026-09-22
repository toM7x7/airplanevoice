import type { RoomState } from "../../../packages/core/src/shared-room";
import { useMemo, useState } from "react";
import { trafficAssessment } from "../../../packages/core/src/traffic-analysis";
import {
  TRAFFIC_CAPACITIES,
  trafficCapacity,
  trafficDecision,
  trafficFacts,
  type TrafficSettings,
} from "../../../packages/core/src/traffic";

export function TrafficPanel({
  state,
  now,
  disabled,
  update,
}: {
  state: RoomState;
  now: number;
  disabled: boolean;
  update: (settings: TrafficSettings) => void;
}) {
  const [comment, setComment] = useState<string | null>(null);
  const settings = {
    capacity: trafficCapacity(state),
    jev: false,
    ...state.traffic,
  };
  const change = (patch: Partial<TrafficSettings>) =>
    update({ ...settings, ...patch });
  const capacity = trafficCapacity(state),
    facts = trafficFacts(state, now),
    decision = trafficDecision(state, now);
  const sampleAt = Math.floor(now / 5000) * 5000;
  const forecast = useMemo(
    () => trafficAssessment(state, sampleAt),
    [state, sampleAt],
  );
  const statuses = {
    selected: "判断を採用",
    applied: "出発へ反映",
    fallback: "規則へ切り替え",
    discarded: "判断を取り消し",
  };
  return (
    <section className="av-traffic" aria-label="空の運行管理">
      <h3>空の運行管理</h3>
      <label>
        同時に飛ばす機体数{" "}
        <select
          aria-label="同時に飛ばす機体数"
          value={capacity}
          disabled={disabled}
          onChange={(event) =>
            change({
              capacity: Number(event.target.value),
              jev: state.traffic?.jev ?? false,
            })
          }
        >
          {TRAFFIC_CAPACITIES.map((n) => (
            <option value={n} key={n}>
              {n}機
              {n === 6 ? "（標準）" : n >= 9 ? "（負荷を確認して使用）" : ""}
            </option>
          ))}
        </select>
      </label>
      <p>
        飛行中 {facts.airborne}機 / 出発待ち {facts.waiting}機 / 音の余韻{" "}
        {facts.soundTails}機
      </p>
      <label>
        <input
          type="checkbox"
          checked={state.traffic?.jev ?? false}
          disabled={disabled}
          onChange={(event) => change({ jev: event.target.checked })}
        />
        Jevで出発間隔・高度候補を自動調整
      </label>
      <fieldset disabled={disabled}>
        <legend>自動で飛ばす機体</legend>
        <p>
          参加者が押した「飛ばす」は優先して出発待ちへ入ります。この選択は自動便だけに使います。
        </p>
        <button onClick={() => change({ automaticIds: undefined })}>
          すべて使う
        </button>
        <button onClick={() => change({ automaticIds: [] })}>
          自動便だけ止める
        </button>
        {(state.hangar ?? []).map((entry) => (
          <label key={entry.id} style={{ display: "block" }}>
            <input
              type="checkbox"
              checked={
                settings.automaticIds === undefined ||
                settings.automaticIds.includes(entry.id)
              }
              onChange={(event) =>
                change({
                  automaticIds: event.target.checked
                    ? [
                        ...(settings.automaticIds ??
                          state.hangar!.map((e) => e.id)),
                        entry.id,
                      ]
                    : (
                        settings.automaticIds ?? state.hangar!.map((e) => e.id)
                      ).filter((id) => id !== entry.id),
                })
              }
            />{" "}
            {entry.name}
          </label>
        ))}
        {!state.hangar?.length && (
          <small>
            保存した機体がここに並びます。未選択なら自動便は休止します。
          </small>
        )}
        <label>
          運行方針{" "}
          <select
            value={settings.objective ?? "balanced"}
            onChange={(event) =>
              change({
                objective: event.target.value as TrafficSettings["objective"],
              })
            }
          >
            <option value="balanced">空きに合わせる</option>
            <option value="lively">次々に飛ばす（15秒間隔）</option>
            <option value="spacious">ゆったり眺める（45秒間隔）</option>
          </select>
        </label>
        <label>
          運用コメント（Jevの判断に渡す）
          <textarea
            aria-label="運用コメント"
            maxLength={160}
            value={comment ?? settings.note ?? ""}
            onChange={(event) => setComment(event.target.value)}
            placeholder="低い音の余韻をじっくり聴けるように"
          />
        </label>
        <button
          disabled={comment === null}
          onClick={() => {
            change({ note: comment ?? "" });
            setComment(null);
          }}
        >
          コメントを反映
        </button>
        <small>
          Jevがオフの間は選んだ運行方針で動きます。飛行中の便はそのまま飛び続けます。
        </small>
      </fieldset>
      <details>
        <summary>
          参加者の出発待ち（
          {state.flights.filter((f) => !f.automatic && f.startsAt > now).length}
          機）
        </summary>
        <ol>
          {state.flights
            .filter((f) => !f.automatic && f.startsAt > now)
            .map((f) => (
              <li key={f.id}>
                {f.names?.[0] ?? "旅客機"} · 約
                {Math.ceil((f.startsAt - now) / 1000)}秒後
              </li>
            ))}
        </ol>
      </details>
      <p>
        会話やメニューを開かず、裏側で判断します。自動出発がオンで利用中の端末がある間、最短30秒間隔でAPIを使います。
      </p>
      <p role="status">
        {decision.source === "jev" ? "Jev" : "規則"}で運行：{decision.note}
      </p>
      {(state.traffic?.jev || state.trafficAgent) && (
        <small>
          APIリクエスト {state.trafficAgent?.requests ?? 0}回（失敗も含む） ·{" "}
          {!state.traffic?.jev
            ? "Jevオフ"
            : state.trafficAgent?.status === "fallback"
              ? "Jevを利用できないため規則で継続"
              : state.trafficAgent?.status === "waiting"
                ? "判断中"
                : "自動調整オン"}
        </small>
      )}
      <p>
        変更は次の自動出発から。高度の重なりを減らし、混雑時は間隔を空けます。保存機体と飛行中の航路は変更しません。
      </p>
      <details>
        <summary>空の混み具合と判断の履歴</summary>
        <p>
          巡航の近接予測：{forecast.closePairs}組（180m未満） /
          音の重なりの目安：{forecast.soundOverlap}機
        </p>
        <p>
          {forecast.nearest
            ? `${forecast.nearest.names.join(" と ")}：約${forecast.nearest.distanceM}m（${forecast.nearest.inSec}秒後）`
            : "比較できる巡航機がありません"}
        </p>
        <small>
          今後30秒を3秒ごとに比較。離陸中・瞬間的な交差は対象外です。音は地上の原点から1200m以内の巡航機数で、実際の音量ではありません。
        </small>
        <ol className="traffic-history">
          {[...(state.trafficHistory ?? [])].reverse().map((entry, i) => (
            <li key={`${entry.at}-${i}`}>
              <strong>
                {new Date(entry.at).toLocaleTimeString("ja-JP")} ·{" "}
                {statuses[entry.status]}
              </strong>
              <div>
                {entry.source === "jev" ? "Jev" : "規則"}：{entry.note}
              </div>
              <small>
                {entry.aircraft ? `${entry.aircraft} · ` : ""}
                {entry.gapSec ? `間隔 ${entry.gapSec}秒 ` : ""}
                {entry.altitudeM ? `高度 ${entry.altitudeM}m` : ""}
                {entry.closePairs !== undefined
                  ? ` · 近接予測 ${entry.closePairs}組`
                  : ""}
              </small>
            </li>
          ))}
        </ol>
        <small>直近20件。高度は出発時の空きに合わせて確定します。</small>
      </details>
    </section>
  );
}
