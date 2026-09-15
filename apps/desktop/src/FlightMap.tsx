import { useMemo } from "react";
import type { Experience } from "../../../packages/core/src";

export function FlightMap({ experience: e }: { experience: Experience }) {
  const map = useMemo(() => {
    const points = e.route.samples.map((s) => s.position);
    const xs = points.map((p) => p.x),
      zs = points.map((p) => p.z);
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
      path:
        points
          .filter((_, i) => i % 4 === 0)
          .map((p, i) => {
            const q = project(p);
            return `${i ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
          })
          .join(" ") + " Z",
    };
  }, [e.route]);
  const flight = e.flights[0];
  const pose = flight?.started && !flight.ended ? e.pose() : null;
  const point = pose ? map.project(pose.position) : null;
  return (
    <svg
      viewBox="0 0 220 170"
      role="img"
      aria-label="現在の主航路を上から見た図"
    >
      <text x="15" y="14">
        N ↑
      </text>
      <path d={map.path} fill="none" stroke="currentColor" strokeWidth="1.1" />
      {point && pose && (
        <path
          d="M0 -8 5 5 0 2 -5 5Z"
          fill="currentColor"
          transform={`translate(${point.x} ${point.y}) rotate(${(Math.atan2(pose.tangent.x, -pose.tangent.z) * 180) / Math.PI})`}
        />
      )}
      <text x="110" y="165" textAnchor="middle">
        ST-01 · 現在の航路
      </text>
    </svg>
  );
}
