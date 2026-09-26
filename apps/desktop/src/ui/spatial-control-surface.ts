import {
  activateControl,
  DisclosureMotion,
  ICON_PATHS,
  type ControlAction,
  type ControlMenuState,
  type ControlMenuView,
} from "./control-menu";

export interface SpatialControlSurface {
  recall: () => void;
  close: () => void;
  draw: (ctx: CanvasRenderingContext2D, dt: number) => boolean;
  select: (x: number, y: number) => boolean;
  targetAt: (x: number, y: number) => string | null;
  setTouchCursors: (cursors: { x: number; y: number }[]) => void;
  setHands: (active: boolean) => void;
  diagnostics: object;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Target extends Rect {
  action: ControlAction;
}
const BOARD: Rect = { x: 64, y: 14, w: 896, h: 384 };
const inside = (p: Rect, x: number, y: number) =>
  x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;

/** One reusable spatial renderer. Hit regions follow the animated artwork. */
export class SpatialControlMenu implements SpatialControlSurface {
  view: ControlMenuView = { title: "", description: "", dock: [], actions: [] };
  readonly motion = new DisclosureMotion();
  private targets: Target[] = [];
  private drawnBoard: Rect | null = null;
  private drawnDock: Rect = { x: 152, y: 420, w: 720, h: 80 };
  private signature = "";

  private hands = false;
  private cursors: { x: number; y: number }[] = [];
  constructor(readonly menu: ControlMenuState) {}
  setHands(active: boolean) {
    this.hands = active;
  }
  setTouchCursors(cursors: { x: number; y: number }[]) {
    this.cursors = cursors;
  }
  targetAt(x: number, y: number) {
    return (
      this.targets.find(
        (t) =>
          inside(t, x, y) &&
          !t.action.disabledReason &&
          (t.y >= 420 ||
            (this.menu.snapshot.open && this.motion.progress === 1)),
      )?.action.id ?? null
    );
  }
  invalidate() {
    this.signature = "";
  }
  recall = () => this.menu.open();
  close = () => this.menu.close();
  select(x: number, y: number) {
    const onBoard = this.drawnBoard && inside(this.drawnBoard, x, y);
    if (!onBoard && !inside(this.drawnDock, x, y)) return false;
    // A closing panel remains a surface, but its hidden controls are already inactive.
    const target = this.targets.find((t) => inside(t, x, y));
    if (
      target &&
      (target.action.id === "menu.toggle" ||
        y >= 420 ||
        (this.menu.snapshot.open && this.motion.progress === 1))
    )
      activateControl(target.action);
    return true;
  }
  draw(ctx: CanvasRenderingContext2D, dt: number) {
    const { open, reduced, page } = this.menu.snapshot;
    this.motion.update(open, dt, reduced);
    const p = this.motion.eased;
    const signature = JSON.stringify([
      p,
      this.hands,
      this.cursors.map((c) => [Math.round(c.x), Math.round(c.y)]),
      page,
      this.view.title,
      this.view.description,
      this.view.lines,
      ...[...this.view.actions, ...this.view.dock].map((a) => [
        a.id,
        a.label,
        a.description,
        a.disabledReason,
      ]),
    ]);
    // React may supply fresh handlers without changing labels. Hit targets use the current actions.
    for (const t of this.targets)
      t.action =
        [...this.view.actions, ...this.view.dock].find(
          (a) => a.id === t.action.id,
        ) ?? t.action;
    if (signature === this.signature) return false;
    this.signature = signature;
    this.targets = [];
    ctx.clearRect(0, 0, 1024, 512);
    const rounded = (r: Rect, color: string, radius = 18) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, radius);
      ctx.fill();
    };
    const button = (action: ControlAction, r: Rect, compact = false) => {
      this.targets.push({ ...r, action });
      rounded(
        r,
        action.disabledReason ? "#e8e9e1" : "#e5eeea",
        compact ? 28 : 14,
      );
      ctx.save();
      ctx.translate(r.x + 18, r.y + (compact ? 25 : 21));
      ctx.scale(1.15, 1.15);
      ctx.strokeStyle = action.disabledReason ? "#82918b" : "#224e50";
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(new Path2D(ICON_PATHS[action.icon]));
      ctx.restore();
      ctx.fillStyle = action.disabledReason ? "#6c7c75" : "#173f45";
      ctx.font = "bold 27px sans-serif";
      ctx.fillText(action.label, r.x + 56, r.y + (compact ? 46 : 42), r.w - 72);
      if (!compact) {
        ctx.font = "20px sans-serif";
        ctx.fillText(
          action.disabledReason || action.description,
          r.x + 20,
          r.y + 73,
          r.w - 40,
        );
      }
    };
    this.drawnBoard = null;
    if (p > 0) {
      const dy = 8 * (1 - p);
      this.drawnBoard = { ...BOARD, y: BOARD.y + dy };
      ctx.save();
      ctx.globalAlpha = p;
      rounded(this.drawnBoard, "#f4f2e8", 20);
      ctx.fillStyle = "#173f45";
      ctx.font = "bold 32px sans-serif";
      ctx.fillText(this.view.title, 94, 65 + dy);
      ctx.font = "22px sans-serif";
      ctx.fillStyle = "#526e65";
      ctx.fillText(this.view.description, 94, 104 + dy, 820);
      this.view.lines?.forEach((line, i) => {
        ctx.font = "24px sans-serif";
        ctx.fillText(line, 94, 153 + i * 38 + dy, 820);
      });
      this.view.actions.forEach((action, i) =>
        button(action, {
          x: 88 + (i % 2) * 432,
          y: (this.view.lines ? 266 : 131) + Math.floor(i / 2) * 104 + dy,
          w: 416,
          h: 93,
        }),
      );
      ctx.font = "18px sans-serif";
      ctx.fillStyle = "#526e65";
      ctx.fillText(
        this.hands
          ? "指してつまむ ／ 指先で触れて、手前に戻す"
          : "トリガー：選ぶ ／ グリップ：正面に呼ぶ",
        94,
        380 + dy,
      );
      ctx.restore();
    }
    rounded(this.drawnDock, "#f4f2e8", 38);
    this.view.dock.forEach((a, i) =>
      button(a, { x: 160 + i * 236, y: 426, w: 232, h: 68 }, true),
    );
    for (const cursor of this.cursors) {
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, 12, 0, Math.PI * 2);
      ctx.strokeStyle = "#ad8034";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    return true;
  }
  get diagnostics() {
    return {
      ...this.menu.snapshot,
      progress: this.motion.progress,
      title: this.view.title,
      targets: this.targets
        .filter((t) => t.y >= 420 || this.menu.snapshot.open)
        .map((t) => ({
          id: t.action.id,
          label: t.action.label,
          enabled: !t.action.disabledReason,
          x: t.x,
          y: t.y,
          w: t.w,
          h: t.h,
        })),
    };
  }
}
