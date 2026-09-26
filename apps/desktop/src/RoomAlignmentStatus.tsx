import {
  alignedParticipants,
  participantStatus,
} from "../../../packages/core/src/room-presence";
import type { VenueMap } from "../../../packages/core/src/venue";
import type { RoomClient } from "./room-client";

export function RoomAlignmentStatus({
  room,
  venue,
  now,
}: {
  room: RoomClient["snapshot"];
  venue: VenueMap;
  now: number;
}) {
  const connected = room.status === "connected";
  const ready = connected
    ? alignedParticipants(room.participants, venue, now).length
    : 0;
  return (
    <details className="room-alignment" open>
      <summary>運営PC・Questの接続状況</summary>
      <p>
        <strong>
          {connected
            ? `${room.peers}台が接続 / 展示はPC＋Quest 3`
            : "再接続を待っています"}
        </strong>
      </p>
      <p>
        ① PCとQuestで同じ部屋へ → ② 運営者がQuestで机を配置 → ③ 来場者へ交代
      </p>
      <ul aria-label="参加端末の位置合わせ状況">
        {room.participants.map((p) => (
          <li key={p.id}>
            <strong>
              端末{p.slot}
              {p.id === room.selfId ? "（この端末）" : ""}
            </strong>
            <span>
              {p.presence?.mode === "browser"
                ? "ブラウザ"
                : p.presence
                  ? p.presence.mode.toUpperCase()
                  : "状態未取得"}{" "}
              · {p.role === "editor" ? "共同操作" : "観覧"}
            </span>
            <span>
              {connected ? participantStatus(p, venue, now) : "接続待ち"}
            </span>
          </li>
        ))}
      </ul>
      <p>
        Quest内は「見え方・操作案内」→「机と会場」→「机の枠を目の前へ」。PCからの飛行・設定変更は共有されます。
      </p>
      <small>
        手動配置は目視確認で、測定精度を保証しません。追加測定の確認済み {ready}
        台。通信往復 {room.rtt === null ? "測定中" : `${room.rtt} ms`}
        （位置の誤差ではありません）。
      </small>
    </details>
  );
}
