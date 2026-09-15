import {
  AIRCRAFT,
  type AircraftInfo as Info,
  type FlightId,
} from "../../../packages/core/src";

export function AircraftInfo({
  info,
  ids,
  onSelect,
  onClose,
  onLook,
}: {
  info: Info;
  ids: FlightId[];
  onSelect: (id: FlightId) => void;
  onClose: () => void;
  onLook: () => void;
}) {
  const status = info.paused
    ? "一時停止"
    : {
        preview: "飛行前のプレビュー",
        waiting: "飛行待ち",
        flying: "飛行中",
        tail: "飛行終了・音の余韻",
        complete: "飛行終了",
      }[info.state];
  const heading =
    info.headingDeg === null ? null : Math.round(info.headingDeg) % 360;
  return (
    <section className="aircraft-info" aria-label="選んだ機体の情報">
      <header>
        <div>
          <span className="info-eyebrow">機体を知る</span>
          <h2>
            {info.id} <small>{status}</small>
          </h2>
        </div>
        <button
          className="info-close"
          onClick={onClose}
          aria-label="機体情報を閉じる"
        >
          ×
        </button>
      </header>
      {ids.length > 1 && (
        <nav className="info-picker" aria-label="情報を見る機体">
          {AIRCRAFT.filter((a) => ids.includes(a.id)).map((a) => (
            <button
              key={a.id}
              aria-label={`${a.id}の情報を見る`}
              aria-pressed={info.id === a.id}
              onClick={() => onSelect(a.id)}
            >
              <i style={{ background: a.accent }} />
              {a.id}
            </button>
          ))}
        </nav>
      )}
      {info.visible ? (
        <>
          <div className="info-reading">
            <dl>
              <dt>
                {info.state === "preview" || info.paused ? "設定速度" : "速度"}
              </dt>
              <dd>
                <strong>{Math.round(info.speedMps! * 3.6)}</strong> km/h{" "}
                <small>{info.speedMps} m/s</small>
              </dd>
              <dt>進行方向</dt>
              <dd>
                <strong>{info.headingLabel}</strong> <span>{heading}°</span>
              </dd>
            </dl>
            <div className="info-compass" aria-hidden="true">
              <span>N</span>
              <b>E</b>
              <em>S</em>
              <i>W</i>
              <svg viewBox="0 0 72 72">
                <circle cx="36" cy="36" r="25" />
                <path
                  transform={`rotate(${info.headingDeg} 36 36)`}
                  d="M36 13 42 42 36 38 30 42Z"
                />
              </svg>
            </div>
          </div>
          <dl className="info-detail">
            <div>
              <dt>高さ</dt>
              <dd>{Math.round(info.altitudeM!)} m</dd>
            </div>
            <div>
              <dt>ここからの距離</dt>
              <dd>{(info.distanceM! / 1000).toFixed(2)} km</dd>
            </div>
          </dl>
          <p className="info-note">
            進行方向は、機体が進む向きです。北を0°として表示。
          </p>
          <button className="info-look" onClick={onLook}>
            この機体の方を向く ↗
          </button>
        </>
      ) : (
        <p className="info-empty">
          {info.state === "waiting"
            ? "飛行が始まると、速度と方向が表示されます。"
            : info.state === "preview"
              ? "追加機は、飛行が始まると空に現れます。"
              : "この機体の飛行は終わりました。次の周回でまた観察できます。"}
        </p>
      )}
    </section>
  );
}
