import type { SharedVrPanel } from "../vr";
import { DisclosureMotion, ICON_PATHS } from "./control-menu";
import type { SpatialControlSurface } from "./spatial-control-surface";

type Target = {
  id: string;
  label: string;
  role?: string;
  highlight?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  enabled: boolean;
  press: () => void;
};
const inside = (t: Target, x: number, y: number) =>
  x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h;

/** Shared room actions keep their permission checks; only presentation/input is adapted. */
export class SharedControlSurface implements SpatialControlSurface {
  private open = true;
  private hands = false;
  private motion = new DisclosureMotion();
  private targets: Target[] = [];
  private cursors: { x: number; y: number }[] = [];
  private drawn: SharedVrPanel | null = null;
  private signature = "";
  constructor(
    private source: () => SharedVrPanel | null,
    private recenter: () => void,
    private feedback: (kind: "press" | "open") => void = () => {},
  ) {}
  recall = () => {
    this.open = true;
  };
  close = () => {
    this.open = false;
  };
  get expanded() {
    return this.open || this.motion.progress > 0;
  }
  setHands(active: boolean) {
    this.hands = active;
  }
  setTouchCursors(cursors: { x: number; y: number }[]) {
    this.cursors = cursors;
  }
  private active(t: Pick<Target, "id" | "enabled">) {
    return (
      t.enabled &&
      (t.id.startsWith("dock.") || (this.open && this.motion.progress === 1))
    );
  }
  targetAt(x: number, y: number) {
    return (
      this.targets.find((t) => inside(t, x, y) && this.active(t))?.id ?? null
    );
  }
  select(x: number, y: number) {
    const t = this.targets.find(
      (t) => inside(t, x, y) && (t.id.startsWith("dock.") || this.open),
    );
    if (t && this.active(t)) {
      if (t.id.startsWith("dock.")) {
        this.feedback("open");
        t.press();
      } else {
        // A page can change between two XR frames. Never activate an old-page action.
        const current = this.source(),
          index = Number(t.id.split(":").at(-1));
        const b =
          current?.title === this.drawn?.title
            ? current?.buttons[index]
            : undefined;
        if (b && b.enabled !== false && b.label === t.label) {
          this.feedback("press");
          b.press();
        }
      }
    }
    return !!t || (this.expanded && y < 422 && x > 12 && x < 1012);
  }
  draw(ctx: CanvasRenderingContext2D, dt: number) {
    const p = this.source();
    if (!p) return false;
    this.drawn = p;
    const progress = this.motion.update(
      this.open,
      dt,
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    const signature = JSON.stringify([
      p.layout,
      p.title,
      p.status,
      p.detail,
      p.guided,
      p.environment?.label,
      p.environment?.enabled,
      p.lines,
      p.buttons.map((b) => [
        b.label,
        b.enabled,
        b.highlight,
        b.role,
        b.x,
        b.y,
        b.w,
        b.h,
      ]),
      this.open,
      progress,
      this.hands,
      this.cursors,
    ]);
    if (signature === this.signature) return false;
    this.signature = signature;
    this.targets = p.buttons.map((b, i) => ({
      ...b,
      id: `action:${p.title}:${i}`,
      enabled: b.enabled !== false,
      x: p.layout === "authored" ? b.x : 28 + (i % 2) * 497,
      y:
        p.layout === "authored"
          ? b.y
          : (p.lines ? 303 : 151) + Math.floor(i / 2) * (p.lines ? 58 : 65),
      w: p.layout === "authored" ? b.w : 467,
      h: p.layout === "authored" ? b.h : 55,
    }));
    const dock: Target[] = [
      {
        id: "dock.menu",
        label: this.open ? "メニューを閉じる" : "メニューを開く",
        x: 28,
        y: 440,
        w: p.environment ? 440 : 602,
        h: 64,
        enabled: true,
        press: () => {
          this.open = !this.open;
        },
      },
      {
        id: "dock.recenter",
        label: "手元へ呼ぶ",
        x: p.environment ? 750 : 648,
        y: 440,
        w: p.environment ? 246 : 266,
        h: 64,
        enabled: true,
        press: this.recenter,
      },
    ];
    if (p.environment)
      dock.push({
        id: "dock.environment",
        ...p.environment,
        x: 484,
        y: 440,
        w: 250,
        h: 64,
      });
    ctx.clearRect(0, 0, 1024, 512);
    const box = (
      x: number,
      y: number,
      w: number,
      h: number,
      fill: string,
      radius = 16,
    ) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fill();
    };
    if (progress > 0) {
      ctx.save();
      ctx.globalAlpha = this.motion.eased;
      ctx.translate(0, (1 - this.motion.eased) * 10);
      box(12, 6, 1000, 416, "#eef4ed", 24);
      if (p.guided) {
        ctx.strokeStyle = "#eebc54";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.roundRect(16, 10, 992, 408, 22);
        ctx.stroke();
      }
      box(28, 22, 5, 30, "#247871", 2);
      ctx.fillStyle = "#163e40";
      ctx.font = "bold 29px sans-serif";
      ctx.fillText(p.title, 46, 47, 690);
      ctx.font = "18px sans-serif";
      ctx.fillStyle = "#486967";
      ctx.fillText("左右の取っ手で移動", 780, 44, 210);
      ctx.font = "21px sans-serif";
      const chars = [...p.status];
      let line = "",
        row = 0;
      for (const char of chars) {
        if (ctx.measureText(line + char).width > 956 && row === 0) {
          ctx.fillText(line, 30, 79);
          row++;
          line = "";
        }
        line += char;
      }
      ctx.fillText(line, 30, row ? 103 : 79, 956);
      ctx.fillStyle = "#486967";
      ctx.font = "19px sans-serif";
      ctx.fillText(p.detail, 30, 131, 956);
      p.lines
        ?.slice(0, 4)
        .forEach((line, i) => ctx.fillText(line, 30, 171 + i * 32, 956));
      for (const t of this.targets) {
        const over = this.cursors.some((c) => inside(t, c.x, c.y));
        box(
          t.x,
          t.y,
          t.w,
          t.h,
          !t.enabled
            ? "#dfe7df"
            : t.highlight
              ? "#ffe19a"
              : over
                ? "#bce5d7"
                : t.role === "primary"
                  ? "#215e60"
                  : t.role === "utility" || t.role === "navigation"
                    ? "#eef4ed"
                    : "#d0e4da",
          12,
        );
        if (t.role === "navigation") {
          ctx.strokeStyle = "#87a8a0";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(t.x + 1, t.y + 1, t.w - 2, t.h - 2, 12);
          ctx.stroke();
        }
        ctx.fillStyle = !t.enabled
          ? "#738779"
          : t.role === "primary" && !t.highlight && !over
            ? "#ffffff"
            : "#123d3b";
        ctx.font = "bold 24px sans-serif";
        ctx.fillText(t.label, t.x + 18, t.y + t.h / 2 + 8, t.w - 36);
      }
      ctx.restore();
    }
    this.targets.push(...dock);
    ctx.fillStyle = "#d5e7dd";
    ctx.font = "16px sans-serif";
    ctx.fillText(
      this.hands
        ? "左右の取っ手をつまむ・手で握ると移動。手を開いて固定"
        : "左右の取っ手をトリガー・グリップでつかむ",
      115,
      434,
      800,
    );
    for (const t of dock) {
      box(t.x, t.y, t.w, t.h, t.enabled ? "#173f43" : "#344b4c", 22);
      ctx.fillStyle = t.enabled ? "#f1f7ec" : "#9dacac";
      ctx.font = "bold 24px sans-serif";
      ctx.fillText(
        t.label,
        t.x + (t.id === "dock.menu" ? 65 : 24),
        t.y + 41,
        t.w - 75,
      );
    }
    ctx.save();
    ctx.translate(48, 458);
    ctx.scale(1.3, 1.3);
    ctx.strokeStyle = "#cbeadd";
    ctx.lineWidth = 2;
    ctx.stroke(new Path2D(ICON_PATHS.menu));
    ctx.restore();
    for (const c of this.cursors) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 10, 0, Math.PI * 2);
      ctx.strokeStyle = "#219e87";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    return true;
  }
  get diagnostics() {
    return {
      open: this.open,
      progress: this.motion.progress,
      hands: this.hands,
      title: this.drawn?.title,
      targets: this.targets.map(({ press: _, ...t }) => ({
        ...t,
        enabled: this.active(t),
      })),
    };
  }
}
