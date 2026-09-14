import { useRef, useState } from "react";
import { clamp, type Experience, type Vec3 } from "../../../packages/core/src";

const W = 288,
  H = 220;

export function RouteEditor({
  experience: e,
  onChange,
  onError,
}: {
  experience: Experience;
  onChange: () => void;
  onError: (message: string) => void;
}) {
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<Vec3[] | null>(null);
  const active = useRef<{
    index: number | null;
    points: Vec3[];
    drawing: boolean;
  } | null>(null);
  const altitude = e.spec.rawPoints.reduce(
    (s, p) => s + p.y / e.spec.rawPoints.length,
    0,
  );
  const visiblePoints = [
    ...e.spec.rawPoints,
    ...e.route.samples.map((s) => s.position),
    e.listener,
  ];
  const minX = Math.min(-1500, ...visiblePoints.map((p) => p.x)) - 150;
  const maxX = Math.max(1500, ...visiblePoints.map((p) => p.x)) + 150;
  const minZ = Math.min(-3100, ...visiblePoints.map((p) => p.z)) - 150;
  const maxZ = Math.max(80, ...visiblePoints.map((p) => p.z)) + 150;
  const toMap = (p: Vec3) => ({
    x: 14 + ((p.x - minX) / (maxX - minX)) * (W - 28),
    y: 14 + ((p.z - minZ) / (maxZ - minZ)) * (H - 28),
  });
  const path = (points: Vec3[], closed = false) =>
    points
      .map((p, i) => {
        const q = toMap(p);
        return `${i ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
      })
      .join(" ") + (closed ? "Z" : "");
  const observer = toMap(e.listener);
  function location(event: React.PointerEvent<SVGSVGElement>) {
    const svg = event.currentTarget,
      point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(svg.getScreenCTM()!.inverse());
    return {
      x: minX + ((clamp(local.x, 14, W - 14) - 14) / (W - 28)) * (maxX - minX),
      y: altitude,
      z: minZ + ((clamp(local.y, 14, H - 14) - 14) / (H - 28)) * (maxZ - minZ),
    };
  }
  function commit() {
    const edit = active.current;
    active.current = null;
    if (edit && edit.points.length >= 4) {
      try {
        e.setRoute({
          id: "drawn",
          revision: e.spec.revision + 1,
          rawPoints: edit.points,
          closed: true,
        });
        onChange();
      } catch (error) {
        onError(String(error));
      }
    } else if (edit?.drawing) onError("もう少し長く線を描いてみてください。");
    setDraft(null);
    setDrawing(false);
  }
  return (
    <div className="route-editor">
      <div className="map-head">
        <span>空から見た航路</span>
        <span>N ↑</span>
      </div>
      <svg
        data-testid="route-map"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="航路編集。点をドラッグ、または一筆で描くボタンを選択。"
        className={drawing ? "drawing" : ""}
        onPointerDown={(event) => {
          if (!e.canEdit) return;
          const point = location(event);
          const target = event.target as SVGElement;
          const index =
            target.dataset.point === undefined
              ? null
              : Number(target.dataset.point);
          if (!drawing && index === null) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          active.current = {
            index,
            points: drawing ? [point] : structuredClone(e.spec.rawPoints),
            drawing,
          };
          setDraft([...active.current.points]);
        }}
        onPointerMove={(event) => {
          if (!active.current) return;
          const p = location(event),
            edit = active.current;
          if (edit.drawing) {
            const last = edit.points[edit.points.length - 1];
            if (
              Math.hypot(last.x - p.x, last.z - p.z) > 20 &&
              edit.points.length < 1000
            )
              edit.points.push(p);
          } else if (edit.index !== null) edit.points[edit.index] = p;
          setDraft([...edit.points]);
        }}
        onPointerUp={commit}
        onPointerCancel={() => {
          active.current = null;
          setDraft(null);
          setDrawing(false);
        }}
      >
        <defs>
          <pattern
            id="map-grid"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M24 0H0V24"
              fill="none"
              stroke="#c9d4cc"
              strokeWidth="0.55"
            />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#map-grid)" />
        <path
          d={path(
            e.route.samples.map((s) => s.position),
            true,
          )}
          fill="none"
          stroke="#31696c"
          strokeWidth="2"
        />
        <path
          d={path(draft ?? e.spec.rawPoints, !drawing)}
          fill="none"
          stroke="#84958b"
          strokeWidth="1"
          strokeDasharray="3 4"
        />
        {!drawing &&
          (draft ?? e.spec.rawPoints).map((p, i) => {
            const q = toMap(p);
            return (
              <circle
                key={i}
                data-point={i}
                cx={q.x}
                cy={q.y}
                r="5"
                fill="#f5f4ee"
                stroke="#49726d"
                strokeWidth="1.5"
                className="control-point"
              />
            );
          })}
        <circle cx={observer.x} cy={observer.y} r="4" fill="#bc7250" />
        <path
          d={`M${observer.x - 8} ${observer.y - 6}l8-9 8 9`}
          fill="none"
          stroke="#bc7250"
          strokeWidth="1"
        />
        <text
          x={observer.x + 12}
          y={observer.y + 4}
          fontSize="9"
          fill="#7e725b"
        >
          観測地点
        </text>
      </svg>
      <button
        className={`draw-button ${drawing ? "selected" : ""}`}
        onClick={() => {
          setDrawing(!drawing);
          setDraft(null);
        }}
      >
        {drawing ? "描画をやめる" : "＋ 一筆で描く"}
      </button>
      <p className="map-hint">
        {drawing
          ? "枠の中をドラッグ。離すと、ひとつの輪に。"
          : "点をつまんで、見たい飛び方に。"}
      </p>
    </div>
  );
}
