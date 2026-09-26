/** Shared meaning for DOM buttons and spatial buttons. No remote/AI execution endpoint. */
export const ICON_PATHS = {
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6L6 18",
  sound: "M11 4L5 9H2v6h3l6 5V4M15 8a6 6 0 010 8M18 5a10 10 0 010 14",
  mute: "M11 4L5 9H2v6h3l6 5V4M16 9l6 6M22 9l-6 6",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 11-6 0 3 3 0 016 0",
  help: "M12 22a10 10 0 110-20 10 10 0 010 20M9 8a3 3 0 116 0c0 2-3 2-3 5M12 17v1",
  plane: "M12 2l2 7 8 5v2l-8-2v5l2 2H8l2-2v-5l-8 2v-2l8-5 2-7Z",
  clear: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M9 9l6 6M15 9l-6 6",
  back: "M20 12H4M10 6l-6 6 6 6",
  world:
    "M12 22a10 10 0 110-20 10 10 0 010 20M2 12h20M12 2c-6 6-6 14 0 20M12 2c6 6 6 14 0 20",
  minus: "M5 12h14",
  plus: "M5 12h14M12 5v14",
  motion: "M3 8h7M2 12h5M3 16h7M18 5l4 7-4 7M11 5l4 7-4 7",
  exit: "M10 4H4v16h6M10 12h12M17 7l5 5-5 5",
} as const;
export type ControlIcon = keyof typeof ICON_PATHS;
export type ControlPage = "home" | "sound" | "view" | "help";
export type ControlActionId =
  | "menu.toggle"
  | "menu.close"
  | "menu.home"
  | "menu.sound"
  | "menu.view"
  | "menu.help"
  | "flight.start"
  | "sound.toggle"
  | "sound.quieter"
  | "sound.louder"
  | "selection.clear"
  | "view.environment"
  | "motion.toggle"
  | "xr.exit";
export interface ControlAction {
  id: ControlActionId;
  label: string;
  description: string;
  icon: ControlIcon;
  scope: "device";
  disabledReason?: string;
  run: () => void;
}
export function activateControl(action: ControlAction) {
  if (action.disabledReason) return false;
  action.run();
  return true;
}

export class ControlMenuState {
  snapshot = {
    open: false,
    page: "home" as ControlPage,
    reduced: false,
  };
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  set(change: Partial<typeof this.snapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((listener) => listener());
  }
  open = () => this.set({ open: true });
  close = () => this.set({ open: false });
  toggle = () => this.set({ open: !this.snapshot.open });
  go = (page: ControlPage) => this.set({ open: true, page });
}

export interface ControlMenuView {
  title: string;
  description: string;
  lines?: string[];
  actions: ControlAction[];
  dock: ControlAction[];
}
export interface ControlContext {
  flying: boolean;
  flightLabel?: string;
  soundOn: boolean;
  audioPending: boolean;
  volume: number;
  selected: boolean;
  xr: boolean;
  canShowAR: boolean;
  ar: boolean;
  hands?: boolean;
  start: () => void;
  sound: () => void;
  volumeChange: (delta: number) => void;
  clear: () => void;
  environment: () => void;
  exit: () => void;
}
export function controlMenuView(
  menu: ControlMenuState,
  c: ControlContext,
): ControlMenuView {
  const action = (
    id: ControlActionId,
    label: string,
    icon: ControlIcon,
    description: string,
    run: () => void,
    disabledReason?: string,
  ): ControlAction => ({
    id,
    label,
    icon,
    description,
    run,
    disabledReason,
    scope: "device",
  });
  const sound = action(
    "sound.toggle",
    c.audioPending ? "音の準備中" : c.soundOn ? "音を止める" : "音を聴く",
    c.soundOn ? "sound" : "mute",
    "この端末のエンジン音",
    c.sound,
    c.audioPending ? "音を準備しています" : undefined,
  );
  const dock = [
    action(
      "menu.toggle",
      menu.snapshot.open ? "閉じる" : "メニュー",
      menu.snapshot.open ? "close" : "menu",
      "操作メニューを開く・閉じる",
      menu.toggle,
    ),
    sound,
    action(
      "selection.clear",
      "選択解除",
      "clear",
      "機体の選択を外す",
      c.clear,
      c.selected ? undefined : "機体は選ばれていません",
    ),
  ];
  const back = action(
    "menu.home",
    "メニューに戻る",
    "back",
    "操作の一覧へ",
    () => menu.go("home"),
  );
  const motion = action(
    "motion.toggle",
    menu.snapshot.reduced ? "動きをつける" : "動きを減らす",
    "motion",
    "メニューの開閉アニメーション",
    () => menu.set({ reduced: !menu.snapshot.reduced }),
  );
  if (menu.snapshot.page === "sound")
    return {
      title: "聴き方",
      description: `音量 ${c.volume}% · この端末だけ`,
      dock,
      actions: [
        sound,
        action(
          "sound.quieter",
          "音量を下げる",
          "minus",
          "5%ずつ小さくする",
          () => c.volumeChange(-5),
          c.volume <= 0 ? "最小の音量です" : undefined,
        ),
        action(
          "sound.louder",
          "音量を上げる",
          "plus",
          "5%ずつ大きくする",
          () => c.volumeChange(5),
          c.volume >= 70 ? "最大の音量です" : undefined,
        ),
        back,
      ],
    };
  if (menu.snapshot.page === "view")
    return {
      title: "見え方",
      description: "自分の視界と、操作の動き",
      dock,
      actions: [
        action(
          "view.environment",
          c.ar ? "仮想の空に戻る" : "現実に重ねる",
          "world",
          "飛行と音を保って背景を切り替える",
          () => {
            c.environment();
            menu.close();
          },
          c.canShowAR
            ? undefined
            : c.xr
              ? "この入場ではARを使えません"
              : "対応するQuestで空間に入ると使えます",
        ),
        motion,
        action(
          "xr.exit",
          "ブラウザに戻る",
          "exit",
          "VR・ARから退出する",
          c.exit,
          c.xr ? undefined : "いまはブラウザで表示しています",
        ),
        back,
      ],
    };
  if (menu.snapshot.page === "help")
    return {
      title: "操作案内",
      description: "空を見上げる時間を、ゆっくり。",
      dock,
      lines: c.xr
        ? c.hands
          ? [
              "遠く：指して、親指と人差し指でつまむ",
              "近く：指先で触れ、手前に戻すともう一度押せる",
              "下のバー：開く・閉じる ／ 空を選ぶ：選択解除",
            ]
          : [
              "バーを指してトリガー：開く・選ぶ",
              "グリップ：操作盤を正面に呼び戻す",
              "何もない空を選ぶ：機体の選択を外す",
            ]
        : [
            "下のバーをクリック：開く・選ぶ",
            "ドラッグ：見回す ／ 機体をクリック：選ぶ",
            "Esc：閉じる ／ Tab・Enter：ボタンを操作",
          ],
      actions: [
        back,
        action(
          "menu.close",
          "閉じて眺める",
          "eye",
          "バーだけを残す",
          menu.close,
        ),
      ],
    };
  return {
    title: "空のメニュー",
    description: "見たい・聴きたいことから選ぼう。",
    dock,
    actions: [
      action(
        "flight.start",
        c.flying ? (c.flightLabel ?? "飛行中") : "飛ばして眺める",
        "plane",
        c.flying
          ? "メニューを閉じても飛行は続きます"
          : "この試作の旅客機を飛ばす",
        () => {
          c.start();
          menu.close();
        },
        c.flying ? (c.flightLabel ?? "いま飛行しています") : undefined,
      ),
      action("menu.sound", "聴き方", "sound", "音量・音の休憩", () =>
        menu.go("sound"),
      ),
      action("menu.view", "見え方", "eye", "背景・操作の動き", () =>
        menu.go("view"),
      ),
      action("menu.help", "操作案内", "help", "いまできる操作を確認", () =>
        menu.go("help"),
      ),
    ],
  };
}

/** Reversible motion with a fixed maximum travel time; does not queue clicks. */
export class DisclosureMotion {
  progress = 0;
  update(open: boolean, dt: number, reduced: boolean) {
    const target = open ? 1 : 0;
    const step =
      Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1)) /
      (open ? 0.18 : 0.12);
    this.progress = reduced
      ? target
      : open
        ? Math.min(1, this.progress + step)
        : Math.max(0, this.progress - step);
    return this.progress;
  }
  get eased() {
    return 1 - (1 - this.progress) ** 3;
  }
}
