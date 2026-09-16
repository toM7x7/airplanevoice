import * as THREE from "three";
import {
  aircraftInfo,
  type Experience,
  type FlightId,
  type Vec3,
} from "../../../packages/core/src";
import type { AircraftAudio } from "./audio";

type VrStatus =
  "checking" | "unsupported" | "ready" | "entering" | "presenting";
export interface SharedVrPanel {
  hint?: string;
  title: string;
  status: string;
  detail: string;
  buttons: {
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
    enabled?: boolean;
    press: () => void;
  }[];
}
type Action =
  | "primary"
  | "sound"
  | "exit"
  | "settings"
  | "back"
  | "all"
  | "focus"
  | "profile"
  | "quieter"
  | "louder"
  | "clear"
  | FlightId;
const BUTTONS: {
  x: number;
  y: number;
  w: number;
  h: number;
  action: Action;
}[] = [
  { x: 30, y: 205, w: 470, h: 78, action: "primary" },
  { x: 524, y: 205, w: 470, h: 78, action: "sound" },
  ...(["ST-01", "ST-02", "ST-03"] as FlightId[]).map((action, i) => ({
    x: 30 + i * 332,
    y: 315,
    w: 300,
    h: 62,
    action,
  })),
  { x: 724, y: 426, w: 270, h: 60, action: "exit" },
  { x: 30, y: 426, w: 270, h: 60, action: "settings" },
  { x: 330, y: 426, w: 360, h: 60, action: "clear" },
];
const AUDIO_BUTTONS: typeof BUTTONS = [
  { x: 30, y: 205, w: 470, h: 78, action: "all" },
  { x: 524, y: 205, w: 470, h: 78, action: "focus" },
  { x: 30, y: 315, w: 470, h: 62, action: "profile" },
  { x: 524, y: 315, w: 220, h: 62, action: "quieter" },
  { x: 774, y: 315, w: 220, h: 62, action: "louder" },
  { x: 30, y: 426, w: 270, h: 60, action: "back" },
  { x: 724, y: 426, w: 270, h: 60, action: "exit" },
  { x: 330, y: 426, w: 360, h: 60, action: "clear" },
];

/** Single-user, stationary observation. Metres and the original audio clock stay shared. */
export class VrRuntime {
  snapshot = {
    status: "checking" as VrStatus,
    error: "",
    arSupported: false,
    displayMode: "vr" as "vr" | "ar",
  };
  private sessionMode: XRSessionMode | null = null;
  private floor: THREE.Mesh | null = null;
  private subscribers = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  };
  private state(status: VrStatus, error = "") {
    this.snapshot = { ...this.snapshot, status, error };
    this.subscribers.forEach((fn) => fn());
  }
  private renderer: THREE.WebGLRenderer | null = null;
  private camera: THREE.Camera | null = null;
  private scene: THREE.Scene | null = null;
  private cameraParent: THREE.Object3D | null = null;
  private session: XRSession | null = null;
  private savedListener: Vec3 | null = null;
  private rig = new THREE.Group();
  private panel: THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshBasicMaterial
  > | null = null;
  private marker: THREE.Mesh | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private controls: THREE.Group[] = [];
  private cleanups: (() => void)[] = [];
  private raycaster = new THREE.Raycaster();
  private position = new THREE.Vector3();
  private orientation = new THREE.Quaternion();
  private forward = new THREE.Vector3();
  private up = new THREE.Vector3();
  private scratch = new THREE.Vector3();
  private panelPlaced = false;
  private panelAt = 0;
  private lastFrameAt = 0;
  private frameIntervals: number[] = [];
  private frames = 0;
  private views = 0;
  private selected: FlightId | null = null;
  private tracked = false;
  private soundOn = false;
  private audioPage = false;
  onPrimary = () => {};
  onSound = () => {};
  onVolume = (_delta: number) => {};
  onProfile = () => {};
  onSelect = (_id: FlightId) => {};
  onClear = () => {};
  onLocalRest: (() => void) | null = null;
  sharedPanel: SharedVrPanel | null = null;

  constructor(
    private experience: Experience,
    private audio: AircraftAudio,
  ) {}
  get active() {
    return this.session !== null || this.snapshot.status === "entering";
  }

  async checkSupport() {
    if (this.active) return;
    try {
      if (!window.isSecureContext || !navigator.xr) {
        this.state("unsupported");
        return;
      }
      const [supported, arSupported] = await Promise.all([
        navigator.xr.isSessionSupported("immersive-vr").catch(() => false),
        navigator.xr.isSessionSupported("immersive-ar").catch(() => false),
      ]);
      this.snapshot = { ...this.snapshot, arSupported };
      this.state(supported ? "ready" : "unsupported");
    } catch {
      this.state("unsupported");
    }
  }

  attach(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    scene: THREE.Scene,
  ) {
    this.renderer = renderer;
    this.camera = camera;
    this.scene = scene;
    void this.checkSupport();
    navigator.xr?.addEventListener("devicechange", this.deviceChange);
    return () => {
      navigator.xr?.removeEventListener("devicechange", this.deviceChange);
      void this.exit();
      this.finish();
      this.renderer = null;
      this.camera = null;
      this.scene = null;
    };
  }
  private deviceChange = () => {
    void this.checkSupport();
  };

  async enter(preferAR = false) {
    if (
      this.snapshot.status !== "ready" ||
      !this.renderer ||
      !this.camera ||
      !navigator.xr
    )
      return;
    this.state("entering");
    try {
      // Must run directly in the button's user gesture, before awaiting audio or anything else.
      const mode =
        preferAR && this.snapshot.arSupported ? "immersive-ar" : "immersive-vr";
      const session = await navigator.xr.requestSession(mode, {
        requiredFeatures: ["local-floor"],
      });
      this.session = session;
      this.sessionMode = mode;
      session.addEventListener("end", this.finish);
      this.savedListener = { ...this.experience.listener };
      if (!this.onLocalRest) this.pause();
      this.rig.position.set(
        this.savedListener.x,
        this.savedListener.y - 1.7,
        this.savedListener.z,
      );
      this.cameraParent = this.camera.parent;
      this.rig.add(this.camera);
      this.scene!.add(this.rig);
      this.rig.updateMatrixWorld(true);
      this.createControls();
      this.frames = 0;
      this.views = 0;
      this.lastFrameAt = 0;
      this.frameIntervals = [];
      this.panelPlaced = false;
      this.audioPage = false;
      this.panelAt = 0;
      this.tracked = false;
      session.addEventListener("visibilitychange", this.visibilityChange);
      this.renderer.xr.setReferenceSpaceType("local-floor");
      this.renderer.xr.setFramebufferScaleFactor(1);
      this.renderer.xr.setFoveation(0.5);
      await this.renderer.xr.setSession(session);
      if (this.session !== session) return;
      this.renderer.xr
        .getReferenceSpace()
        ?.addEventListener("reset", this.referenceReset);
      this.state("presenting");
    } catch (error) {
      const session = this.session;
      if (session) {
        try {
          await session.end();
        } catch {
          /* already ended */
        }
      }
      this.finish();
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError");
      this.state(
        "ready",
        denied
          ? "空間への入場が許可されませんでした。ブラウザの許可を確認し、もう一度試してください。"
          : "空間を開けませんでした。Questの床設定とブラウザを確認してください。",
      );
    }
  }
  async exit() {
    try {
      await this.session?.end();
    } catch {
      this.state(
        "presenting",
        "VRを終了できませんでした。Questのシステムメニューから終了できます。",
      );
    }
  }
  get canShowAR() {
    return (
      this.sessionMode === "immersive-ar" &&
      this.session?.environmentBlendMode !== "opaque"
    );
  }
  toggleEnvironment() {
    if (!this.canShowAR) return;
    const displayMode = this.snapshot.displayMode === "ar" ? "vr" : "ar";
    this.snapshot = { ...this.snapshot, displayMode };
    if (this.floor) this.floor.visible = displayMode !== "ar";
    this.state(this.snapshot.status);
  }
  hidePanel() {
    if (this.panel) this.panel.visible = false;
  }
  private pause() {
    if (this.onLocalRest) {
      this.onLocalRest();
      this.audio.stop();
      return;
    }
    if (this.experience.phase !== "EDIT" && !this.experience.paused)
      this.experience.togglePause();
    this.audio.stop();
  }
  private visibilityChange = () => {
    if (this.session?.visibilityState !== "visible") {
      this.pause();
      this.lastFrameAt = 0;
    }
  };
  private referenceReset = () => {
    this.pause();
    this.panelPlaced = false;
  };
  private finish = () => {
    if (this.savedListener) {
      this.pause();
      this.experience.setListener(this.savedListener);
      this.savedListener = null;
    }
    this.session?.removeEventListener("end", this.finish);
    this.session?.removeEventListener(
      "visibilitychange",
      this.visibilityChange,
    );
    this.renderer?.xr
      .getReferenceSpace()
      ?.removeEventListener("reset", this.referenceReset);
    this.cleanups.splice(0).forEach((fn) => fn());
    if (this.camera?.parent === this.rig) {
      this.rig.remove(this.camera);
      this.cameraParent?.add(this.camera);
    }
    this.rig.removeFromParent();
    this.session = null;
    this.sessionMode = null;
    this.floor = null;
    this.snapshot = { ...this.snapshot, displayMode: "vr" };
    this.tracked = false;
    this.panel = null;
    this.marker = null;
    this.canvas = null;
    this.ctx = null;
    this.controls = [];
    if (this.snapshot.status !== "unsupported") this.state("ready");
  };

  private createControls() {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.2),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    this.panel = panel;
    this.rig.add(panel);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1.2, 48),
      new THREE.MeshBasicMaterial({
        color: "#b4c7ab",
        transparent: true,
        opacity: 0.6,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.floor = floor;
    floor.position.y = 0.01;
    this.rig.add(floor);
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.93, 1, 48),
      new THREE.MeshBasicMaterial({
        color: "#e9fbd0",
        side: THREE.DoubleSide,
        depthWrite: false,
        transparent: true,
        opacity: 0.7,
      }),
    );
    this.marker = marker;
    this.scene!.add(marker);
    const owned: THREE.Mesh[] = [panel, floor, marker];
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer!.xr.getController(i);
      this.rig.add(controller);
      this.controls.push(controller);
      const ray = new THREE.Mesh(
        new THREE.CylinderGeometry(0.003, 0.003, 3, 6),
        new THREE.MeshBasicMaterial({ color: "#d9ffd3" }),
      );
      ray.rotation.x = Math.PI / 2;
      ray.position.z = -1.5;
      controller.add(ray);
      owned.push(ray);
      const select = () => this.select(controller);
      const recall = () => {
        this.panelPlaced = false;
        if (this.panel) this.panel.visible = true;
      };
      controller.addEventListener("selectstart", select);
      controller.addEventListener("squeezestart", recall);
      this.cleanups.push(() => {
        controller.removeEventListener("selectstart", select);
        controller.removeEventListener("squeezestart", recall);
        controller.removeFromParent();
      });
    }
    this.cleanups.push(() => {
      texture.dispose();
      owned.forEach((mesh) => {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    });
  }

  private select(controller: THREE.Group) {
    if (
      !this.tracked ||
      !controller.visible ||
      this.session?.visibilityState !== "visible"
    )
      return;
    controller.updateWorldMatrix(true, false);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction
      .set(0, 0, -1)
      .transformDirection(controller.matrixWorld);
    if (this.panel?.visible) {
      this.panel.updateWorldMatrix(true, false);
      const hit = this.raycaster.intersectObject(this.panel)[0];
      if (hit?.uv) {
        const x = hit.uv.x * 1024,
          y = (1 - hit.uv.y) * 512;
        if (this.sharedPanel) {
          const shared = this.sharedPanel.buttons.find(
            (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h,
          );
          if (shared && shared.enabled !== false) shared.press();
          this.panelAt = 0;
          return;
        }
        const button = (this.audioPage ? AUDIO_BUTTONS : BUTTONS).find(
          (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h,
        );
        if (button) this.act(button.action);
        return;
      }
    }
    let nearest: { id: FlightId; along: number } | null = null;
    for (const id of this.experience.flightIds) {
      if (!aircraftInfo(this.experience, id)?.visible) continue;
      const p = this.experience.pose(id).position;
      this.scratch.set(p.x, p.y, p.z);
      const along = this.scratch
        .clone()
        .sub(this.raycaster.ray.origin)
        .dot(this.raycaster.ray.direction);
      const radius = Math.max(
        this.experience.designFor(id).wingSpanM / 2,
        along * 0.025,
      );
      if (
        along > 0 &&
        this.raycaster.ray.distanceSqToPoint(this.scratch) < radius * radius &&
        (!nearest || along < nearest.along)
      )
        nearest = { id, along };
    }
    if (nearest) this.act(nearest.id);
    else this.act("clear");
  }
  private act(action: Action) {
    if (action === "primary") this.onPrimary();
    else if (action === "sound") this.onSound();
    else if (action === "exit") void this.exit();
    else if (action === "settings" || action === "back")
      this.audioPage = action === "settings";
    else if (action === "all") this.experience.setMix("balanced");
    else if (action === "focus") {
      if (this.selected) this.experience.setMix("focus", this.selected);
    } else if (action === "clear") {
      this.selected = null;
      this.onClear();
    } else if (action === "profile") this.onProfile();
    else if (action === "quieter") this.onVolume(-5);
    else if (action === "louder") this.onVolume(5);
    else if (this.experience.flightIds.includes(action)) {
      this.selected = action;
      this.onSelect(action);
    }
    this.panelAt = 0;
  }

  /** Called before simulation and audio. Use the centre head pose, not either eye's camera. */
  update(frame: XRFrame | undefined, dt: number) {
    if (!this.session || !frame || !this.renderer || !this.camera) return false;
    const reference = this.renderer.xr.getReferenceSpace();
    const pose = reference && frame.getViewerPose(reference);
    this.tracked = !!pose && this.session.visibilityState === "visible";
    if (!this.tracked || !pose) {
      this.pause();
      this.lastFrameAt = 0;
      return true;
    }
    const { position, orientation } = pose.transform;
    this.position
      .set(position.x, position.y, position.z)
      .add(this.rig.position);
    this.orientation.set(
      orientation.x,
      orientation.y,
      orientation.z,
      orientation.w,
    );
    this.forward.set(0, 0, -1).applyQuaternion(this.orientation);
    this.up.set(0, 1, 0).applyQuaternion(this.orientation);
    this.experience.trackListener(this.position);
    this.audio.setListener(this.position, this.forward, this.up);
    this.rig.updateMatrixWorld(true);
    if (this.camera instanceof THREE.PerspectiveCamera)
      this.renderer.xr.updateCamera(this.camera);
    this.frames++;
    this.views = pose.views.length;
    if (this.lastFrameAt && dt > 0) {
      this.frameIntervals.push(dt * 1000);
      if (this.frameIntervals.length > 600) this.frameIntervals.shift();
    }
    this.lastFrameAt = performance.now();
    if (!this.panelPlaced && this.panel) {
      const yaw = Math.atan2(-this.forward.x, -this.forward.z);
      this.panel.rotation.set(0, yaw, 0);
      this.panel.position.set(
        -Math.sin(yaw) * 2.8 + position.x,
        Math.max(0.75, position.y - 0.45),
        -Math.cos(yaw) * 2.8 + position.z,
      );
      this.panelPlaced = true;
    }
    return true;
  }
  get canAdvance() {
    return !this.active || this.tracked;
  }
  draw(selected: FlightId | null, soundOn: boolean) {
    this.selected = selected;
    this.soundOn = soundOn;
    if (!this.session || !this.panel || !this.ctx || !this.marker) return;
    const info = selected ? aircraftInfo(this.experience, selected) : null;
    this.marker.visible = !!info?.visible && this.snapshot.displayMode !== "ar";
    if (info?.visible) {
      const p = this.experience.pose(info.id).position;
      this.marker.position.set(p.x, p.y, p.z);
      this.marker.quaternion.copy(this.orientation);
      this.marker.scale.setScalar(
        Math.max(
          this.experience.designFor(info.id).wingSpanM,
          this.experience.designFor(info.id).bodyLengthM,
        ) * 0.7,
      );
    }
    if (performance.now() - this.panelAt < 200) return;
    this.panelAt = performance.now();
    const ctx = this.ctx,
      e = this.experience;
    if (this.sharedPanel) {
      const panel = this.sharedPanel;
      ctx.fillStyle = "#132e31";
      ctx.fillRect(0, 0, 1024, 512);
      ctx.fillStyle = "#eaf4db";
      ctx.font = "bold 32px sans-serif";
      ctx.fillText(panel.title, 30, 47);
      ctx.font = "24px sans-serif";
      ctx.fillText(panel.status, 30, 90, 964);
      ctx.fillText(panel.detail, 30, 126, 964);
      for (const b of panel.buttons) {
        ctx.fillStyle = b.enabled === false ? "#1c373a" : "#36585b";
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = b.enabled === false ? "#8aa39d" : "#f4f6ea";
        ctx.font = "bold 25px sans-serif";
        ctx.fillText(b.label, b.x + 16, b.y + b.h / 2 + 9, b.w - 30);
      }
      ctx.fillStyle = "#b9d6d0";
      ctx.font = "18px sans-serif";
      ctx.fillText(
        panel.hint ?? "人差し指：決定 ／ 側面のボタン：操作盤を呼ぶ",
        30,
        505,
      );
      this.panel.material.map!.needsUpdate = true;
      return;
    }
    ctx.fillStyle = "#132e31";
    ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = "#eaf4db";
    ctx.font = "bold 34px sans-serif";
    ctx.fillText("音航跡  /  空を見上げて、音を待つ", 30, 52);
    ctx.font = "26px sans-serif";
    const status = e.paused
      ? "ひと休み中"
      : e.phase === "EDIT"
        ? "準備できたら、飛ばしてみよう"
        : e.phase === "COMPILE"
          ? "まもなく飛行開始"
          : e.phase === "INTERLAP"
            ? e.evolution.enabled
              ? "次の空を待っています"
              : "もう一周、眺められます"
            : e.flights.every((f) => f.arrivedCount === 0)
              ? "音の到来を待っています"
              : "姿は先へ。音はあとから。";
    ctx.fillText(
      this.audioPage
        ? `音量 ${this.audio.volumeLevel}%  /  ${this.audio.outputProfile === "speaker" ? "本体スピーカー向け" : "ヘッドホン向け"}`
        : status,
      30,
      100,
    );
    const detail = info?.visible
      ? `${info.id}   ${Math.round(info.speedMps!)} m/s   ${info.headingLabel} ${Math.round(info.headingDeg!)}°   距離 ${Math.round(info.distanceM!)} m`
      : info
        ? `${info.id}  ${info.state === "waiting" ? "飛行開始を待っています" : "飛行を終えました"}`
        : "機体を指してトリガーで選択 → 速度・方向";
    ctx.fillStyle = "#b9d6d0";
    const mixLabel =
      e.mixMode === "balanced"
        ? "空全体を聴いています"
        : `${e.focusId}を強めに聴いています`;
    ctx.fillText(this.audioPage ? mixLabel : detail, 30, 152);
    for (const b of this.audioPage ? AUDIO_BUTTONS : BUTTONS) {
      const isPlane = b.action.startsWith("ST-");
      const enabled = isPlane
        ? e.flightIds.includes(b.action as FlightId)
        : b.action === "focus"
          ? selected !== null
          : b.action === "clear"
            ? selected !== null || e.mixMode !== "balanced"
            : true;
      ctx.fillStyle = !enabled
        ? "#1c373a"
        : b.action === selected
          ? "#538079"
          : "#36585b";
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = enabled ? "#f4f6ea" : "#6b8583";
      ctx.font = "bold 28px sans-serif";
      const primary = e.paused
        ? "飛行を再開"
        : e.phase === "EDIT"
          ? "この航路で飛ばす"
          : e.phase === "INTERLAP" && !e.evolution.enabled
            ? "もう一周、眺める"
            : "ひと休み";
      const label =
        b.action === "primary"
          ? primary
          : b.action === "sound"
            ? soundOn
              ? "音をオフ"
              : "音をオン"
            : b.action === "exit"
              ? "VRを終了"
              : b.action === "settings"
                ? "音の設定"
                : b.action === "back"
                  ? "空の操作へ"
                  : b.action === "all"
                    ? "空全体を聴く"
                    : b.action === "clear"
                      ? "選択を外す"
                      : b.action === "focus"
                        ? selected
                          ? `${selected}を強めに聴く`
                          : "機体を選ぶと強調できます"
                        : b.action === "profile"
                          ? this.audio.outputProfile === "speaker"
                            ? "ヘッドホン向けに切替"
                            : "本体スピーカー向けに切替"
                          : b.action === "quieter"
                            ? "音量 −5"
                            : b.action === "louder"
                              ? "音量 ＋5"
                              : b.action;
      ctx.fillText(label, b.x + 22, b.y + b.h / 2 + 10);
      if (isPlane && enabled) {
        const db = this.audio.levels.flights[b.action as FlightId]?.db ?? -120;
        const sounding =
          soundOn &&
          this.audio.volumeLevel > 0 &&
          !e.paused &&
          this.audio.context?.state === "running";
        ctx.fillStyle = "#9ee6c9";
        ctx.fillRect(
          b.x + 16,
          b.y + b.h - 6,
          (b.w - 32) *
            (sounding ? Math.max(0, Math.min(1, (db + 70) / 60)) : 0),
          3,
        );
      }
    }
    ctx.fillStyle = "#b9d6d0";
    ctx.font = "22px sans-serif";
    ctx.fillText(
      this.audioPage
        ? "音量はアプリ内の値です。本体の音量は別に調整。"
        : `${mixLabel}  /  バー：各機体の音の信号`,
      30,
      410,
    );
    ctx.font = "18px sans-serif";
    ctx.fillText(
      "グリップ：操作盤を呼ぶ  /  選択を外すと空全体の音へ",
      30,
      507,
    );
    this.panel.material.map!.needsUpdate = true;
  }

  get diagnostics() {
    const sorted = [...this.frameIntervals].sort((a, b) => a - b);
    const panel = this.panel;
    panel?.updateWorldMatrix(true, false);
    return {
      ...this.snapshot,
      sessionMode: this.sessionMode,
      environmentBlendMode: this.session?.environmentBlendMode ?? null,
      canShowAR: this.canShowAR,
      panelVisible: this.panel?.visible ?? false,
      frames: this.frames,
      views: this.views,
      tracked: this.tracked,
      visibility: this.session?.visibilityState ?? null,
      inputSources: this.session?.inputSources.length ?? 0,
      head: this.session
        ? {
            position: this.position.toArray(),
            forward: this.forward.toArray(),
            up: this.up.toArray(),
          }
        : null,
      origin: this.rig.position.toArray(),
      sampleFrames: sorted.length,
      frameMsP50: sorted[Math.floor(sorted.length * 0.5)] ?? null,
      frameMsP95: sorted[Math.floor(sorted.length * 0.95)] ?? null,
      panel: panel
        ? { matrix: panel.matrixWorld.toArray(), width: 2.4, height: 1.2 }
        : null,
      selected: this.selected,
      selectionMarkerVisible: this.marker?.visible ?? false,
      soundOn: this.soundOn,
      audioPage: this.audioPage,
      sharedPage: this.sharedPanel?.title ?? null,
    };
  }
}
