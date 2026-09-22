import { useEffect, useRef, useState } from "react";
import type { Experience, FlightId } from "../../../packages/core/src";
import type { RoomState } from "../../../packages/core/src/shared-room";
import { trafficDecision } from "../../../packages/core/src/traffic";
import type { SpatialControlSurface } from "./ui/spatial-control-surface";

export interface RadarSource {
  experience: Experience;
  names: { id: string; name: string }[];
  selected: FlightId | null;
  state: RoomState | null;
  now: number;
  select: (id: FlightId) => void;
}
type Target = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  press: () => void;
};
/** Shared PC/XR canvas. Sound dots represent received emissions, not measured sound pressure. */
export class FlightRadarSurface implements SpatialControlSurface {
  mode: "flight" | "sound" = "flight";
  private targets: Target[] = [];
  private cursors: { x: number; y: number }[] = [];
  private elapsed = 1;
  private extent = 1800;
  private selectedName = "";
  constructor(
    public source: () => RadarSource,
    public close: () => void,
  ) {}
  recall = () => {
    this.elapsed = 1;
  };
  setHands() {}
  setTouchCursors(cursors: { x: number; y: number }[]) {
    this.cursors = cursors;
  }
  targetAt(x: number, y: number) {
    return (
      this.targets.find(
        (t) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h,
      )?.id ?? null
    );
  }
  select(x: number, y: number) {
    const hits = this.targets.filter(
      (t) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h,
    );
    // Repeat a touch to cycle aircraft stacked at different altitudes.
    const planes = hits.filter((t) => t.id.startsWith("ST-"));
    const t =
      planes.length > 1
        ? planes[
            (planes.findIndex((p) => p.id === this.source().selected) + 1) %
              planes.length
          ]
        : hits[0];
    t?.press();
    this.elapsed = 1;
    return true;
  }
  draw(ctx: CanvasRenderingContext2D, dt: number) {
    this.elapsed += dt;
    if (this.elapsed < 0.2) return false;
    this.elapsed = 0;
    const {
      experience: e,
      names,
      selected,
      state,
      now,
      select,
    } = this.source();
    const snapshot = e.getSnapshot();
    const fleet = snapshot.fleet.filter(
      (f) => f.state === "flying" || f.state === "tail",
    );
    const routes = fleet.map((f) => ({
      id: f.id,
      points: e.routeFor(f.id).samples.filter((_, i) => i % 40 === 0),
    }));
    // Quantised stable range; aircraft movement alone never pans or zooms the map.
    const radius = Math.max(
      1500,
      Math.hypot(e.listener.x, e.listener.z),
      ...routes.flatMap((r) =>
        r.points.map((p) =>
          Math.max(Math.abs(p.position.x), Math.abs(p.position.z)),
        ),
      ),
    );
    this.extent = Math.ceil(radius / 500) * 500;
    const project = (p: { x: number; z: number }) => ({
      x: 350 + (p.x / this.extent) * 160,
      y: 278 + (p.z / this.extent) * 160,
    });
    ctx.clearRect(0, 0, 1024, 512);
    ctx.fillStyle = "#10272e";
    ctx.beginPath();
    ctx.roundRect(0, 0, 1024, 512, 24);
    ctx.fill();
    this.targets = [];
    const button = (
      id: string,
      label: string,
      x: number,
      w: number,
      press: () => void,
      active = false,
    ) => {
      this.targets.push({ id, label, x, y: 16, w, h: 50, press });
      ctx.fillStyle = active ? "#e9bd64" : "#28454d";
      ctx.beginPath();
      ctx.roundRect(x, 16, w, 50, 12);
      ctx.fill();
      ctx.fillStyle = active ? "#132a30" : "#e4efec";
      ctx.font = "bold 23px sans-serif";
      ctx.fillText(label, x + 16, 49, w - 28);
    };
    ctx.fillStyle = "#f0eee0";
    ctx.font = "bold 29px sans-serif";
    ctx.fillText("フライトレーダー", 24, 48);
    button(
      "radar.flight",
      "機体・航路",
      414,
      198,
      () => {
        this.mode = "flight";
      },
      this.mode === "flight",
    );
    button(
      "radar.sound",
      "音響マップ",
      624,
      198,
      () => {
        this.mode = "sound";
      },
      this.mode === "sound",
    );
    button("radar.close", "閉じる", 836, 164, this.close);
    ctx.strokeStyle = "#2b4850";
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(40, 278 + i * 80);
      ctx.lineTo(660, 278 + i * 80);
      ctx.moveTo(350 + i * 155, 118);
      ctx.lineTo(350 + i * 155, 438);
      ctx.stroke();
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(24, 90, 652, 364);
    ctx.clip();
    for (const r of routes) {
      ctx.beginPath();
      r.points.forEach((p, i) => {
        const q = project(p.position);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.strokeStyle = r.id === selected ? "#9abcb2" : "#345862";
      ctx.lineWidth = r.id === selected ? 2 : 1;
      ctx.stroke();
    }
    if (this.mode === "sound") {
      for (const t of e.trails.slice(-480)) {
        const age = e.nowMs - t.arrivalAtMs;
        if (age < 0 || age > 8000) continue;
        const p = project(t.position);
        ctx.globalAlpha = Math.max(0.12, 1 - age / 8000);
        ctx.fillStyle = t.flightId === selected ? "#ffe9a2" : "#e8bd6b";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (const f of fleet) {
        const sound = [...e.trails]
          .reverse()
          .find((t) => t.flightId === f.id && e.nowMs - t.arrivalAtMs < 8000);
        if (!sound) continue;
        const p = project(sound.position),
          q = project(f.pose.position);
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = "#e4b75e";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (const f of fleet) {
      if (f.state !== "flying") continue;
      const p = project(f.pose.position),
        angle = Math.atan2(f.pose.tangent.x, -f.pose.tangent.z);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      ctx.fillStyle = f.id === selected ? "#ffe6a0" : "#bcdfdd";
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(7, 9);
      ctx.lineTo(0, 5);
      ctx.lineTo(-7, 9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const name = names.find((n) => n.id === f.id)?.name ?? f.id;
      this.targets.push({
        id: f.id,
        label: name,
        x: p.x - 15,
        y: p.y - 15,
        w: 30,
        h: 30,
        press: () => select(f.id),
      });
      if (f.id === selected) {
        ctx.font = "bold 19px sans-serif";
        ctx.fillStyle = "#ffe6a0";
        ctx.fillText(name, p.x + 14, p.y - 8, 180);
      }
    }
    const listener = project(e.listener);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(listener.x, listener.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "17px sans-serif";
    ctx.fillText("あなた", listener.x + 9, listener.y + 17);
    ctx.restore();
    const focus = fleet.find((f) => f.id === selected);
    this.selectedName =
      names.find((n) => n.id === selected)?.name ?? "機体を選んで確認";
    ctx.fillStyle = "#edf2e8";
    ctx.font = "bold 25px sans-serif";
    ctx.fillText(this.selectedName, 710, 112, 290);
    ctx.font = "23px sans-serif";
    ctx.fillText(
      `飛行中 ${fleet.filter((f) => f.state === "flying").length}機`,
      710,
      154,
    );
    if (focus) {
      ctx.fillText(`高度 ${Math.round(focus.pose.position.y)}m`, 710, 192);
      ctx.fillText(
        `距離 ${Math.round(Math.hypot(focus.pose.position.x - e.listener.x, focus.pose.position.y - e.listener.y, focus.pose.position.z - e.listener.z))}m`,
        710,
        226,
      );
    }
    const waiting =
      state?.flights.filter((f) => !f.automatic && f.startsAt > now) ?? [];
    ctx.fillStyle = "#9fc1bd";
    ctx.font = "20px sans-serif";
    ctx.fillText(`参加者の出発待ち ${waiting.length}機`, 710, 278);
    waiting
      .slice(0, 3)
      .forEach((f, i) =>
        ctx.fillText(
          `${f.names?.[0] ?? "旅客機"} · ${Math.ceil((f.startsAt - now) / 1000)}秒`,
          710,
          310 + i * 30,
          290,
        ),
      );
    ctx.fillText(`縦の範囲 ±${this.extent}m / 上から見た図`, 28, 482, 650);
    ctx.font = "18px sans-serif";
    ctx.fillText(
      this.mode === "sound"
        ? "金：届いた音の発生位置 ／ 点線：機体とのずれ（音圧分布ではありません）"
        : "三角：機体（重なりは繰り返し選ぶ） ／ 線：航路 ／ 白丸：あなた",
      28,
      94,
      960,
    );
    if (state) {
      ctx.fillStyle = "#e6c786";
      ctx.font = "18px sans-serif";
      ctx.fillText(trafficDecision(state, now).note, 710, 410, 290);
      ctx.fillText(
        state.traffic?.note ?? "運用コメントはPCの部屋・運営で設定",
        710,
        440,
        290,
      );
    }
    for (const p of this.cursors) {
      ctx.strokeStyle = "#ffe6a0";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    return true;
  }
  get diagnostics() {
    return {
      mode: this.mode,
      selectedName: this.selectedName,
      extentM: this.extent,
      targets: this.targets.map(({ press, ...t }) => t),
    };
  }
}
export function FlightRadar({
  source,
  close,
}: {
  source: () => RadarSource;
  close: () => void;
}) {
  const [offset,setOffset]=useState({x:0,y:0});
  const drag=useRef<{id:number;x:number;y:number;left:number;top:number;width:number;height:number;ox:number;oy:number}|null>(null);
  const ref = useRef<HTMLCanvasElement>(null),
    current = useRef({ source, close });
  current.current = { source, close };
  const surface = useRef<FlightRadarSurface | null>(null);
  useEffect(() => {
    const s = new FlightRadarSurface(
      () => current.current.source(),
      () => current.current.close(),
    );
    surface.current = s;
    const ctx = ref.current!.getContext("2d")!;
    s.draw(ctx, 1);
    const timer = setInterval(() => s.draw(ctx, 0.2), 200);
    return () => {
      clearInterval(timer);
      surface.current = null;
    };
  }, []);
  return (
    <section className="flight-radar" aria-label="フライトレーダー" style={{transform:`translate(${offset.x}px,${offset.y}px)`}}>
      <div className="radar-grip" onPointerDown={event=>{
        if((event.target as HTMLElement).closest("button"))return;
        const box=event.currentTarget.parentElement!.getBoundingClientRect();
        drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,left:box.left,top:box.top,width:box.width,height:box.height,ox:offset.x,oy:offset.y};event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event=>{const d=drag.current;if(!d||d.id!==event.pointerId)return;setOffset({x:d.ox+Math.max(-d.left,Math.min(innerWidth-d.left-d.width,event.clientX-d.x)),y:d.oy+Math.max(-d.top,Math.min(innerHeight-d.top-d.height,event.clientY-d.y))});}}
      onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null}>
        <span>⠿ 掴んでレーダーを移動</span><button onClick={()=>setOffset({x:0,y:0})}>位置を戻す</button>
      </div>
      <div className="radar-accessible">
        <button
          onClick={() => {
            if (surface.current) surface.current.mode = "flight";
          }}
        >
          機体・航路
        </button>
        <button
          onClick={() => {
            if (surface.current) surface.current.mode = "sound";
          }}
        >
          音響マップ
        </button>
        <button onClick={close}>レーダーを閉じる</button>
      </div>
      <canvas
        ref={ref}
        width={1024}
        height={512}
        aria-label="機体と到来音の地図"
        onPointerDown={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          surface.current?.select(
            ((event.clientX - box.left) / box.width) * 1024,
            ((event.clientY - box.top) / box.height) * 512,
          );
        }}
      />
    </section>
  );
}
