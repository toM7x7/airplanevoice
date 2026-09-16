import {
  describeRoom,
  type RoomObservation,
} from "../../../packages/core/src/room-observation";
import type { SpeechOutput } from "./room-speech";

export function RoomTower({
  facts,
  speech,
  canRead,
  onRead,
  onStop,
  showDraft,
  resting,
}: {
  facts: RoomObservation;
  speech: SpeechOutput["snapshot"];
  canRead: boolean;
  onRead: () => void;
  onStop: () => void;
  showDraft: boolean;
  resting: boolean;
}) {
  const text = describeRoom(facts);
  return (
    <details className="room-tower">
      <summary>管制 / いまの状況と予定</summary>
      <ul>
        {text.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {showDraft && text.draft && (
        <p>
          次に予約する設定：{text.draft}
          <br />
          予約済みの便には反映されません。
        </p>
      )}
      <div className="shared-actions">
        <button onClick={onRead} disabled={!canRead}>
          状況を読み上げる
        </button>
        <button onClick={onStop} disabled={!speech.speaking}>
          案内を止める
        </button>
      </div>
      <p role="status">{speech.message}</p>
      <small>
        状況に合わせた定型案内です。声は自分の端末だけに流れます。
        {resting &&
          "「音を聴く」または「この画面で体験する」で音を開始できます。"}
      </small>
    </details>
  );
}
