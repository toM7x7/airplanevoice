import { useMemo } from "react";
import { AIRCRAFT, type Experience } from "../../../packages/core/src";

export function FlightMap({
  experience: e,
  sound = false,
}: {
  experience: Experience;
  sound?: boolean;
}) {
  const map = useMemo(() => {
    const routes =
      e.compiledShow?.flights ??
      (e.flights.length ? e.flights : [{ id: "ST-01", route: e.route }]);
    const points = routes.flatMap((f) =>
      f.route.samples.map((s) => s.position),
    );
    const xs = [...points.map((p) => p.x), e.listener.x],
      zs = [...points.map((p) => p.z), e.listener.z];
    const left = Math.min(...xs),
      right = Math.max(...xs);
    const top = Math.min(...zs),
      bottom = Math.max(...zs);
    const scale = Math.min(
      180 / Math.max(1, right - left),
      125 / Math.max(1, bottom - top),
    );
    const project = (p: { x: number; z: number }) => ({
      x: 110 + (p.x - (left + right) / 2) * scale,
      y: 82 + (p.z - (top + bottom) / 2) * scale,
    });
    return {
      project,
      routes: routes.map((f) => ({
        id: f.id,
        accent: AIRCRAFT.find((a) => a.id === f.id)!.accent,
        path:
          f.route.samples
            .map((s) => s.position)
            .filter((_, i) => i % 4 === 0)
            .map((p, i) => {
              const q = project(p);
              return `${i ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
            })
            .join(" ") + " Z",
      })),
    };
  }, [e.route, e.compiledShow, e.flights, e.listener.x, e.listener.z]);
  const listener = map.project(e.listener);
  return (
    <svg
      viewBox="0 0 220 170"
      role="img"
      aria-label={
        e.show
          ? "演目の航路と観察地点を上から見た図"
          : "現在の主航路を上から見た図"
      }
    >
      <text x="15" y="14">
        N ↑
      </text>
      {map.routes.map((r) => (
        <path
          key={r.id}
          d={r.path}
          fill="none"
          stroke={r.accent}
          strokeWidth="1.1"
          opacity={sound ? 0.3 : 0.75}
        />
      ))}
      {sound &&
        e.trails
          .filter((_, i) => i % 4 === 0)
          .map((t) => {
            const p = map.project(t.position);
            return (
              <circle
                key={`${t.flightId}-${t.emissionId}`}
                cx={p.x}
                cy={p.y}
                r={2.8}
                fill={AIRCRAFT.find((a) => a.id === t.flightId)!.accent}
                opacity={Math.max(
                  0,
                  1 -
                    (e.nowMs - t.arrivalAtMs) /
                      (e.recipe.trailPersistenceSec * 1000),
                )}
              />
            );
          })}
      {e.flights
        .filter((f) => f.started && !f.ended)
        .map((f) => {
          const pose = e.pose(f.id),
            point = map.project(pose.position);
          return (
            <path
              key={f.id}
              d="M0 -8 5 5 0 2 -5 5Z"
              fill={f.accent}
              transform={`translate(${point.x} ${point.y}) rotate(${(Math.atan2(pose.tangent.x, -pose.tangent.z) * 180) / Math.PI})`}
            />
          );
        })}
      <circle
        cx={listener.x}
        cy={listener.y}
        r={3}
        fill="#29443e"
        stroke="#fff"
        strokeWidth={1}
      />
      <text x={listener.x + 6} y={listener.y + 3}>
        耳
      </text>
      <text x="110" y="165" textAnchor="middle">
        {sound
          ? "点 = ここで出た音が、今届いた"
          : e.show
            ? "各機の航路 · ● 観察地点"
            : "ST-01 · 現在の航路"}
      </text>
    </svg>
  );
}
