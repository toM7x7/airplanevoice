import * as THREE from "three";
import { FlightRadarSurface, type RadarSource } from "./FlightRadar";
import {
  aircraftInfo,
  type Experience,
  type FlightId,
  type Vec3,
} from "../../../packages/core/src";
import type { AircraftAudio } from "./audio";
import type { SpatialControlSurface } from "./ui/spatial-control-surface";
import { SharedControlSurface } from "./ui/shared-control-surface";
import { SpatialHandInput } from "./ui/spatial-hand-input";
import { SpatialGrab } from "./ui/spatial-grab";
import {
  createPanelHandles,
  nearPanelHandle,
  highlightPanelHandles,
  PANEL_HANDLES,
} from "./ui/panel-handles";
import {
  DEFAULT_TABLE,
  tableDepth,
  tableInFront,
  placementAlignment,
  moveTable,
  type TablePlacement,
  checkAlignment,
  type AlignmentCheck,
  solveAlignment,
  type Alignment,
  type TableFrame,
} from "../../../packages/core/src/spatial-alignment";

type VrStatus =
  "checking" | "unsupported" | "ready" | "entering" | "presenting";
export interface SharedVrPanel {
  environment?: { label: string; enabled: boolean; press: () => void };
  layout?: "authored";
  hint?: string;
  lines?: string[];
  title: string;
  status: string;
  detail: string;
  guided?: boolean;
  buttons: {
    label: string;
    role?: string;
    highlight?: boolean;
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

/** Per-device XR view. Shared flight coordinates stay in metres; calibration moves the local rig. */
export class VrRuntime {
  snapshot = {
    status: "checking" as VrStatus,
    error: "",
    arSupported: false,
    displayMode: "vr" as "vr" | "ar",
    calibration: "none" as
      | "none"
      | "a"
      | "b"
      | "c"
      | "checking"
      | "aligned"
      | "lost"
      | "placing"
      | "placed",
    alignmentCheck: null as AlignmentCheck | null,
    calibrationMessage: "机の枠は、Questを装着した運営者が配置します。",
    showCalibration: false,
    showVenue: false,
    venueView: "space" as "overview" | "space",
    overviewPlacement: 0,
    inputMode: "controllers" as "controllers" | "hands",
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
  private grips: THREE.Group[] = [];
  private tips: THREE.Mesh[] = [];
  private frameConfig: TableFrame = DEFAULT_TABLE;
  private frameKey = "";
  private captureA: Vec3 | null = null;
  private captureHand = -1;
  private alignment: Alignment | null = null;
  private placement: TablePlacement | null = null;
  private rawHead = new THREE.Vector3();
  private rawOrientation = new THREE.Quaternion();
  private tipOffset = new THREE.Vector3(0, 0, -0.05);
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
  creationModel: {
    begin: (controller: THREE.Group, ray: THREE.Ray) => boolean;
    near: (point: THREE.Vector3) => boolean;
    beginNear: (controller: THREE.Group, point: THREE.Vector3) => boolean;
    end: (controller?: THREE.Group) => void;
    command: (index: number) => void;
    inspect: () => unknown;
  } | null = null;
  creationAnchor = new THREE.Vector3();
  creationAnchorVersion = 0;

  /** Component lab override. Shared rooms use the same hand/touch input contract. */
  controlSurface: SpatialControlSurface | null = null;
  private sharedSurface: SharedControlSurface | null = null;
  private get surface() {
    return this.controlSurface ?? this.sharedSurface;
  }
  private surfaceAt = 0;
  private handInput: SpatialHandInput | null = null;
  private panelGrab = new SpatialGrab();
  private panelHandles: THREE.Group | null = null;
  private radarGrab = new SpatialGrab();
  private radarPlaced = false;
  radarSource: (() => RadarSource) | null = null;
  private radar: {
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    surface: FlightRadarSurface;
    hand: SpatialHandInput;
    ctx: CanvasRenderingContext2D;
    texture: THREE.CanvasTexture;
    handles: THREE.Group;
  } | null = null;
  toggleRadar() {
    if (!this.radar || !this.active) return;
    const r = this.radar;
    r.mesh.visible = !r.mesh.visible;
    if (r.mesh.visible) {
      this.surface?.close();
      r.surface.recall();
    } else {
      this.radarGrab.end();
      r.hand.reset();
      this.surface?.recall();
    }
  }
  private radarHandleNear(point: THREE.Vector3) {
    return !!this.radar?.mesh.visible && nearPanelHandle(this.radar.mesh, point);
  }
  private panelHandleNear(point: THREE.Vector3) {
    if (!this.panel?.visible || !this.sharedSurface?.expanded) return false;
    return nearPanelHandle(this.panel, point);
  }

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
        ...(this.controlSurface || this.sharedPanel
          ? { optionalFeatures: ["hand-tracking"] }
          : {}),
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
      this.rig.quaternion.identity();
      this.alignment = null;
      this.captureA = null;
      this.snapshot = {
        ...this.snapshot,
        calibration: "none",
        showCalibration: false,
        alignmentCheck: null,
        calibrationMessage: "机の位置合わせを行ってください。",
      };
      this.cameraParent = this.camera.parent;
      this.rig.add(this.camera);
      this.scene!.add(this.rig);
      this.rig.updateMatrixWorld(true);
      this.createControls();
      this.frames = 0;
      this.views = 0;
      this.lastFrameAt = 0;
      this.handInput?.reset();
      this.surface?.setTouchCursors([]);
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
  /** Open in its existing position; only explicit recall or a handle grab relocates it. */
  showPanel() {
    if (this.panel) this.panel.visible = true;
    this.surface?.recall();
  }
  hidePanel() {
    this.panelGrab.end();
    if (this.surface) {
      this.surface.close();
      return;
    }
    if (this.panel) this.panel.visible = false;
  }
  /** Explicit editing entry summons only the miniature; the user's placed menu stays fixed. */
  recallCreation() {
    if (!this.active || !this.tracked) return;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.rawOrientation);
    const yaw = Math.atan2(-f.x, -f.z);
    this.creationAnchor
      .set(
        this.rawHead.x - Math.sin(yaw) * 0.62,
        Math.max(0.4, this.rawHead.y + 0.12),
        this.rawHead.z - Math.cos(yaw) * 0.62,
      )
      .applyMatrix4(this.rig.matrixWorld);
    this.creationAnchorVersion++;
  }
  get panelVisible() {
    return this.sharedSurface?.expanded ?? this.panel?.visible ?? false;
  }
  /** A local presentation choice; never changes the rig, listener or room. */
  showVenue(view: "overview" | "space") {
    this.snapshot = {
      ...this.snapshot,
      showVenue: true,
      venueView: view,
      overviewPlacement: this.snapshot.overviewPlacement + 1,
    };
    if (view === "overview") this.hidePanel();
    this.state(this.snapshot.status);
  }
  hideVenue() {
    this.snapshot = { ...this.snapshot, showVenue: false };
    this.state(this.snapshot.status);
  }
  setTableFrame(key: string, frame: TableFrame) {
    const nextKey = `${key}/${frame.baselineM}/${frame.tableHeightM}/${tableDepth(frame)}`;
    if (this.frameKey === nextKey) return;
    const hadFrame = !!this.frameKey;
    this.frameKey = nextKey;
    this.frameConfig = { ...frame };
    if (hadFrame && this.active && this.snapshot.calibration !== "none")
      this.invalidateAlignment(
        "部屋か机の基準が変わりました。位置を合わせ直してください。",
      );
  }
  get worldVisible() {
    return this.snapshot.calibration !== "lost";
  }
  toggleCalibrationMarkers() {
    this.snapshot = {
      ...this.snapshot,
      showCalibration: !this.snapshot.showCalibration,
    };
    this.state(this.snapshot.status);
  }
  beginAlignment() {
    if (!this.canShowAR || this.snapshot.status !== "presenting") return;
    this.pause();
    this.captureA = null;
    this.captureHand = -1;
    this.placement = null;
    this.snapshot = {
      ...this.snapshot,
      displayMode: "ar",
      showCalibration: false,
      calibration: "a",
      alignmentCheck: null,
      calibrationMessage:
        "手元の光る玉を机のAへ合わせ、トリガー。グリップで中止。",
    };
    if (this.floor) this.floor.visible = false;
    this.state(this.snapshot.status);
  }
  /** Start from the operator's current physical pose, never the virtual origin. */
  bringTableHere() {
    if (
      !this.canShowAR ||
      !this.tracked ||
      this.snapshot.status !== "presenting"
    )
      return;
    this.pause();
    this.captureA = null;
    this.captureHand = -1;
    this.placement = null;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.rawOrientation);
    this.placement = tableInFront(
      this.rawHead,
      Math.atan2(-f.x, -f.z),
      this.frameConfig,
    );
    this.applyPlacement();
    this.panelPlaced = false;
  }
  adjustTable(x = 0, y = 0, z = 0, yaw = 0) {
    if (
      !this.placement ||
      !this.tracked ||
      !["placing", "placed"].includes(this.snapshot.calibration)
    )
      return;
    this.placement = moveTable(this.placement, this.frameConfig, x, y, z, yaw);
    this.applyPlacement();
  }
  private applyPlacement() {
    if (!this.placement) return;
    const a = placementAlignment(this.placement, this.frameConfig);
    this.alignment = a;
    this.rig.position.set(a.offset.x, a.offset.y, a.offset.z);
    this.rig.rotation.set(0, a.yaw, 0);
    this.rig.updateMatrixWorld(true);
    if (this.floor) this.floor.visible = false;
    this.snapshot = {
      ...this.snapshot,
      displayMode: "ar",
      showCalibration: true,
      calibration: "placing",
      alignmentCheck: null,
      calibrationMessage:
        "仮置きです。A・Bを手前、C・Dを奥にして机へ重ねてください。",
    };
    this.state(this.snapshot.status);
  }
  confirmTablePlacement() {
    if (
      !this.placement ||
      this.snapshot.calibration !== "placing" ||
      !this.tracked
    )
      return;
    this.snapshot = {
      ...this.snapshot,
      calibration: "placed",
      calibrationMessage: "机を手動で配置しました（目視確認・誤差は未測定）。",
    };
    this.state(this.snapshot.status);
  }
  confirmAlignment() {
    if (
      this.snapshot.calibration !== "checking" ||
      !this.snapshot.alignmentCheck?.acceptable
    )
      return;
    this.snapshot = {
      ...this.snapshot,
      calibration: "aligned",
      calibrationMessage: `位置合わせ確認済み / Cのずれ ${(this.snapshot.alignmentCheck.distanceM * 100).toFixed(1)} cm（この端末）`,
    };
    this.state(this.snapshot.status);
  }
  clearAlignment() {
    this.pause();
    this.alignment = null;
    this.placement = null;
    this.captureA = null;
    this.rig.quaternion.identity();
    const p = this.savedListener;
    if (p) this.rig.position.set(p.x, p.y - 1.7, p.z);
    this.panelPlaced = false;
    this.snapshot = {
      ...this.snapshot,
      calibration: "none",
      alignmentCheck: null,
      calibrationMessage:
        "机の配置を解除しました。目の前に呼んで、配置し直せます。",
      showCalibration: false,
    };
    this.state(this.snapshot.status);
  }
  private invalidateAlignment(message: string) {
    this.captureA = null;
    this.placement = null;
    this.alignment = null;
    this.pause();
    this.panelPlaced = false;
    if (this.panel) this.panel.visible = true;
    this.surface?.recall();
    this.snapshot = {
      ...this.snapshot,
      calibration: "lost",
      alignmentCheck: null,
      calibrationMessage: message,
    };
    this.state(this.snapshot.status);
  }
  private capturePoint(index: number) {
    const grip = this.grips[index];
    if (!grip?.visible) return;
    const point = this.tipOffset
      .clone()
      .applyQuaternion(grip.quaternion)
      .add(grip.position);
    if (this.snapshot.calibration === "c" && this.alignment) {
      if (index !== this.captureHand) return;
      const check = checkAlignment(point, this.alignment, this.frameConfig);
      this.snapshot = {
        ...this.snapshot,
        alignmentCheck: check,
        calibration: "checking",
        calibrationMessage: check.acceptable
          ? `Cのずれ ${(check.distanceM * 100).toFixed(1)} cm。目印の重なりを見て「重なりを確認」。`
          : `Cのずれ ${(check.distanceM * 100).toFixed(1)} cm。5 cmを超えました。A/B/Cの印を確認してやり直してください。`,
      };
      this.panelPlaced = false;
      this.state(this.snapshot.status);
      return;
    }
    if (this.snapshot.calibration === "a") {
      this.captureA = { x: point.x, y: point.y, z: point.z };
      this.captureHand = index;
      this.snapshot = {
        ...this.snapshot,
        calibration: "b",
        calibrationMessage:
          "同じ手の光る玉をBへ合わせ、トリガー。グリップで中止。",
      };
    } else if (this.captureA) {
      if (index !== this.captureHand) return;
      try {
        const a = solveAlignment(this.captureA, point, this.frameConfig);
        this.alignment = a;
        this.rig.position.set(a.offset.x, a.offset.y, a.offset.z);
        this.rig.rotation.set(0, a.yaw, 0);
        this.rig.updateMatrixWorld(true);
        this.panelPlaced = false;
        this.snapshot = {
          ...this.snapshot,
          calibration: "c",
          showCalibration: true,
          calibrationMessage:
            "同じ手の光る玉をCへ合わせ、トリガー。CはAから奥へ、設定した奥行きの距離。",
        };
      } catch (error) {
        this.snapshot = {
          ...this.snapshot,
          calibration: "a",
          calibrationMessage:
            error instanceof Error
              ? error.message
              : "位置合わせをやり直してください。",
        };
      }
      this.captureA = null;
    }
    this.state(this.snapshot.status);
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
      this.handInput?.reset();
      this.surface?.setTouchCursors([]);
      this.pause();
      this.lastFrameAt = 0;
    }
  };
  private referenceReset = () => {
    if (
      this.alignment ||
      this.snapshot.calibration === "a" ||
      this.snapshot.calibration === "b" ||
      this.snapshot.calibration === "c"
    ) {
      this.invalidateAlignment(
        "追跡の原点が変わりました。机の位置を合わせ直してください。",
      );
      return;
    }
    this.pause();
    this.panelPlaced = false;
  };
  private finish = () => {
    this.panelGrab.end();
    this.radarGrab.end();
    this.creationModel?.end();
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
    this.handInput?.dispose();
    this.radar?.hand.dispose();
    this.radar?.handles.traverse(part => {
      if (part instanceof THREE.Mesh) { part.geometry.dispose(); (part.material as THREE.Material).dispose(); }
    });
    this.radar?.mesh.removeFromParent();
    this.radar?.mesh.geometry.dispose();
    this.radar?.mesh.material.dispose();
    this.radar?.texture.dispose();
    this.radar = null;
    this.handInput = null;
    this.surface?.setTouchCursors([]);
    this.surface?.setHands(false);
    if (this.camera?.parent === this.rig) {
      this.rig.remove(this.camera);
      this.cameraParent?.add(this.camera);
    }
    this.rig.removeFromParent();
    this.sharedSurface = null;
    this.placement = null;
    this.session = null;
    this.sessionMode = null;
    this.floor = null;
    this.snapshot = {
      ...this.snapshot,
      displayMode: "vr",
      inputMode: "controllers",
      calibration: "none",
      alignmentCheck: null,
      calibrationMessage: "再入場したら、机の位置を合わせてください。",
    };
    this.alignment = null;
    this.placement = null;
    this.captureA = null;
    this.tracked = false;
    this.panel = null;
    this.marker = null;
    this.canvas = null;
    this.ctx = null;
    this.controls = [];
    this.grips = [];
    this.tips = [];
    if (this.snapshot.status !== "unsupported") this.state("ready");
  };

  private createControls() {
    if (this.radarSource) {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 512;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 1.2),
        new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
      );
      mesh.scale.setScalar(0.32);
      mesh.visible = true;
      this.radarPlaced = false;
      const handles = createPanelHandles();
      mesh.add(handles);
      this.rig.add(mesh);
      this.radar = {
        mesh,
        handles,
        texture,
        ctx: canvas.getContext("2d")!,
        surface: new FlightRadarSurface(
          () => this.radarSource!(),
          () => {
            mesh.visible = false;
            this.radarGrab.end();
            this.radar?.hand.reset();
            this.surface?.recall();
          },
        ),
        hand: new SpatialHandInput(this.rig, undefined, false),
      };
    }
    this.sharedSurface = this.sharedPanel
      ? new SharedControlSurface(
          () => this.sharedPanel,
          () => {
            this.panelPlaced = false;
          },
          (kind) =>
            this.audio.feedback(
              kind,
              this.panel?.getWorldPosition(new THREE.Vector3()),
            ),
        )
      : null;
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.2),
      new THREE.MeshBasicMaterial({
        map: texture,
        toneMapped: false,
        transparent: !!this.surface,
        depthWrite: !this.surface,
      }),
    );
    this.panel = panel;
    const handles = createPanelHandles();
    this.panelHandles = handles;
    panel.add(handles);
    this.surfaceAt = 0;
    this.rig.add(panel);
    if (this.surface)
      this.handInput = new SpatialHandInput(this.rig, {
        palmNear: (point) => this.radarHandleNear(point) || this.panelHandleNear(point),
        near: (point) =>
          this.radarHandleNear(point) || this.panelHandleNear(point) || !!this.creationModel?.near(point),
        begin: (anchor, point) =>
          this.radarHandleNear(point)
            ? this.radarGrab.begin(this.radar!.mesh, anchor)
            : this.panelHandleNear(point)
            ? this.panelGrab.begin(panel, anchor)
            : !!this.creationModel?.beginNear(anchor, point),
        end: (anchor) => {
          this.panelGrab.end(anchor);
          this.radarGrab.end(anchor);
          this.creationModel?.end(anchor);
        },
      });
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
      const grip = this.renderer!.xr.getControllerGrip(i);
      this.rig.add(grip);
      this.grips.push(grip);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 12, 8),
        new THREE.MeshBasicMaterial({ color: "#fff29b", depthTest: false }),
      );
      tip.position.copy(this.tipOffset);
      tip.renderOrder = 10;
      grip.add(tip);
      this.tips.push(tip);
      owned.push(tip);
      const ray = new THREE.Mesh(
        new THREE.CylinderGeometry(0.003, 0.003, 3, 6),
        new THREE.MeshBasicMaterial({ color: "#d9ffd3" }),
      );
      ray.rotation.x = Math.PI / 2;
      ray.name = "pointer-ray";
      ray.position.z = -1.5;
      controller.add(ray);
      owned.push(ray);
      let source: XRInputSource | null = null;
      const connected = (event: { data: XRInputSource }) => {
        source = event.data;
        controller.userData.avSource = source;
      };
      const disconnected = () => {
        this.panelGrab.end(controller);
        this.panelGrab.end(grip);
        this.radarGrab.end(controller);
        this.radarGrab.end(grip);
        this.creationModel?.end(controller);
        source = null;
        delete controller.userData.avSource;
      };
      const select = () => {
        if (
          source?.hand &&
          this.handInput &&
          (!this.handInput.allowPinch(source) ||
            (this.radar?.mesh.visible && !this.radar.hand.allowPinch(source)))
        )
          return;
        this.select(controller);
      };
      const recall = () => {
        // Hand sources may emit squeeze while changing gesture; this is not a recall command.
        if (source?.hand) return;
        grip.updateWorldMatrix(true, false);
        if (this.radarHandleNear(grip.getWorldPosition(new THREE.Vector3()))) {
          this.radarGrab.begin(this.radar!.mesh, grip);
          return;
        }
        if (
          this.panel &&
          this.panelHandleNear(grip.getWorldPosition(new THREE.Vector3()))
        ) {
          this.panelGrab.begin(this.panel, grip);
          return;
        }
        controller.updateWorldMatrix(true, false);
        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction
          .set(0, 0, -1)
          .transformDirection(controller.matrixWorld);
        if (this.radar?.mesh.visible && this.raycaster.intersectObject(this.radar.handles, true).length) {
          this.radarGrab.begin(this.radar.mesh, controller);
          return;
        }
        if (
          this.panel?.visible &&
          this.panelHandles?.visible &&
          this.raycaster.intersectObject(this.panelHandles, true).length
        ) {
          this.panelGrab.begin(this.panel, controller);
          return;
        }
        if (
          this.snapshot.calibration === "a" ||
          this.snapshot.calibration === "b" ||
          this.snapshot.calibration === "c"
        )
          this.invalidateAlignment(
            "位置合わせを中止しました。開始からやり直せます。",
          );
        this.panelPlaced = false;
        if (this.panel) this.panel.visible = true;
        this.surface?.recall();
      };
      const release = () => {
        this.creationModel?.end(controller);
        this.panelGrab.end(controller);
        this.radarGrab.end(controller);
      };
      const releaseGrip = () => {
        this.radarGrab.end(grip);
        this.radarGrab.end(controller);
        this.panelGrab.end(grip);
        this.panelGrab.end(controller);
      };
      controller.addEventListener("squeezeend", releaseGrip);
      controller.addEventListener("selectend", release);
      controller.addEventListener("selectstart", select);
      controller.addEventListener("connected", connected);
      controller.addEventListener("disconnected", disconnected);
      controller.addEventListener("squeezestart", recall);
      this.cleanups.push(() => {
        release();
        releaseGrip();
        controller.removeEventListener("squeezeend", releaseGrip);
        controller.removeEventListener("selectend", release);
        controller.removeEventListener("selectstart", select);
        controller.removeEventListener("connected", connected);
        controller.removeEventListener("disconnected", disconnected);
        controller.removeEventListener("squeezestart", recall);
        controller.removeFromParent();
        delete controller.userData.avSource;
        grip.removeFromParent();
      });
    }
    this.cleanups.push(() => {
      handles.traverse((part) => {
        if (part instanceof THREE.Mesh) {
          part.geometry.dispose();
          (part.material as THREE.Material).dispose();
        }
      });
      handles.removeFromParent();
      this.panelHandles = null;
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
    if (
      this.snapshot.calibration === "a" ||
      this.snapshot.calibration === "b" ||
      this.snapshot.calibration === "c"
    ) {
      this.capturePoint(this.controls.indexOf(controller));
      return;
    }
    controller.updateWorldMatrix(true, false);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction
      .set(0, 0, -1)
      .transformDirection(controller.matrixWorld);
    if (this.radar?.mesh.visible) {
      const handle = this.raycaster.intersectObject(this.radar.handles, true)[0];
      if (handle && handle.distance < 2) {
        this.radarGrab.begin(this.radar.mesh, controller);
        return;
      }
      const hit = this.raycaster.intersectObject(this.radar.mesh)[0];
      let main = this.panel?.visible
        ? this.raycaster.intersectObject(this.panel)[0]
        : undefined;
      if (
        main?.uv &&
        this.sharedSurface &&
        !this.sharedSurface.expanded &&
        (1 - main.uv.y) * 512 < 426
      )
        main = undefined;
      if (hit?.uv && (!main || hit.distance < main.distance)) {
        this.radar.surface.select(hit.uv.x * 1024, (1 - hit.uv.y) * 512);
        return;
      }
    }
    if (this.panel?.visible) {
      this.panel.updateWorldMatrix(true, false);
      if (
        this.panelHandles?.visible &&
        this.raycaster.intersectObject(this.panelHandles, true).length
      ) {
        // Deliberate ray pinch on the visible handle also works when it is just beyond reach.
        if (
          !(controller.userData.avSource as XRInputSource | undefined)?.hand ||
          this.raycaster.intersectObject(this.panelHandles, true)[0].distance <
            2
        )
          this.panelGrab.begin(this.panel, controller);
        return;
      }
      const hit = this.raycaster.intersectObject(this.panel)[0];
      if (hit?.uv) {
        const x = hit.uv.x * 1024,
          y = (1 - hit.uv.y) * 512;
        if (this.surface) {
          if (this.surface.select(x, y)) return;
        } else if (this.sharedPanel) {
          const shared = this.sharedPanel.buttons.find(
            (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h,
          );
          if (shared && shared.enabled !== false) shared.press();
          this.panelAt = 0;
          return;
        }
        if (!this.surface) {
          const button = (this.audioPage ? AUDIO_BUTTONS : BUTTONS).find(
            (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h,
          );
          if (button) this.act(button.action);
          return;
        }
      }
    }
    if (this.creationModel?.begin(controller, this.raycaster.ray)) return;
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
      this.panelGrab.end();
      this.radarGrab.end();
      this.creationModel?.end();
      this.handInput?.reset();
      this.surface?.setTouchCursors([]);
      if (this.alignment || this.captureA || this.snapshot.calibration === "a")
        this.invalidateAlignment(
          "追跡を見失いました。机の位置を合わせ直してください。",
        );
      this.pause();
      this.lastFrameAt = 0;
      return true;
    }
    const { position, orientation } = pose.transform;
    this.rawHead.copy(position);
    this.rig.updateMatrixWorld(true);
    this.position
      .set(position.x, position.y, position.z)
      .applyMatrix4(this.rig.matrixWorld);
    this.rawOrientation.set(
      orientation.x,
      orientation.y,
      orientation.z,
      orientation.w,
    );
    this.orientation.copy(this.rig.quaternion).multiply(this.rawOrientation);
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
    const hands =
      !!this.surface && [...this.session.inputSources].some((s) => !!s.hand);
    if ((this.snapshot.inputMode === "hands") !== hands) {
      this.snapshot = {
        ...this.snapshot,
        inputMode: hands ? "hands" : "controllers",
      };
      this.surface?.setHands(hands);
      if (hands && ["a", "b", "c"].includes(this.snapshot.calibration))
        this.invalidateAlignment(
          "測定を中止しました。コントローラーでやり直すか、机の枠を手動で配置してください。",
        );
      this.state(this.snapshot.status);
    }
    const editing = !!this.creationModel && !!this.sharedSurface;
    // Device discovery, editing and flight transitions never move an already placed board.
    if (!this.panelPlaced && this.panel) {
      this.panelGrab.end();
      const localForward = this.scratch
        .set(0, 0, -1)
        .applyQuaternion(this.rawOrientation);
      const yaw = Math.atan2(-localForward.x, -localForward.z);
      this.panel.rotation.set(0, yaw, 0);
      // Reachable with bare hands even if controllers were discovered first.
      this.panel.scale.setScalar(editing ? 0.23 : 0.3);
      const distance = editing ? 0.72 : 0.64;
      const side = editing ? 0.24 : 0;
      this.panel.position.set(
        -Math.sin(yaw) * distance + Math.cos(yaw) * side + position.x,
        Math.max(0.35, position.y - 0.16),
        -Math.cos(yaw) * distance - Math.sin(yaw) * side + position.z,
      );
      this.panel.rotation.y = yaw - Math.atan2(side, distance);
      this.panelPlaced = true;
      // Independent of the panel: the aircraft stays centred and within arm's reach.
      this.creationAnchor
        .set(
          -Math.sin(yaw) * 0.62 + position.x,
          Math.max(0.4, position.y + 0.12),
          -Math.cos(yaw) * 0.62 + position.z,
        )
        .applyMatrix4(this.rig.matrixWorld);
      this.creationAnchorVersion++;
    }
    if (this.handInput && reference && this.panel && this.surface)
      this.handInput.update(
        frame,
        reference,
        [...this.session.inputSources],
        this.panel,
        this.surface,
      );
    if (this.panelHandles) {
      this.panelHandles.visible = !!this.sharedSurface?.expanded;
      highlightPanelHandles(
        this.panelHandles,
        this.panelGrab.active ||
          !!this.handInput?.diagnostics.some(
            (h) =>
              h.grip &&
              this.panelHandleNear(new THREE.Vector3().fromArray(h.grip)),
          ),
      );
    }
    if (this.radar?.mesh.visible) {
      if (!this.radarPlaced) {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.rawOrientation);
        const yaw = Math.atan2(-forward.x, -forward.z);
        this.radar.mesh.position.set(
          position.x - Math.sin(yaw) * 0.64 + Math.cos(yaw) * 0.78,
          Math.max(0.45, position.y + 0.02),
          position.z - Math.cos(yaw) * 0.64 - Math.sin(yaw) * 0.78,
        );
        this.radar.mesh.rotation.set(0, yaw - Math.atan2(0.78, 0.64), 0);
        this.radarPlaced = true;
      }
      highlightPanelHandles(this.radar.handles, this.radarGrab.active || !!this.handInput?.diagnostics.some(h => h.grip && this.radarHandleNear(new THREE.Vector3().fromArray(h.grip))));
      if (reference)
        this.radar.hand.update(
          frame,
          reference,
          [...this.session.inputSources],
          this.radar.mesh,
          this.radar.surface,
        );
      if (this.radar.surface.draw(this.radar.ctx, 1 / 60))
        this.radar.texture.needsUpdate = true;
    }
    if (!this.sharedSurface?.expanded) this.panelGrab.end();
    this.panelGrab.update();
    this.radarGrab.update();
    for (const controller of this.controls) {
      const ray = controller.getObjectByName("pointer-ray");
      if (ray)
        ray.visible = !this.handInput?.isNear(controller.userData.avSource);
    }
    return true;
  }
  get canAdvance() {
    return !this.active || (this.tracked && this.worldVisible);
  }
  draw(selected: FlightId | null, soundOn: boolean) {
    this.selected = selected;
    this.soundOn = soundOn;
    for (const tip of this.tips)
      tip.visible =
        this.snapshot.calibration === "a" ||
        this.snapshot.calibration === "b" ||
        this.snapshot.calibration === "c" ||
        this.snapshot.calibration === "checking";
    if (!this.session || !this.panel || !this.ctx || !this.marker) return;
    const info = selected ? aircraftInfo(this.experience, selected) : null;
    this.marker.visible =
      this.worldVisible &&
      !!info?.visible &&
      this.snapshot.displayMode !== "ar";
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
    if (this.surface) {
      const now = performance.now();
      const dt = this.surfaceAt ? (now - this.surfaceAt) / 1000 : 0;
      this.surfaceAt = now;
      if (this.surface.draw(this.ctx, dt))
        this.panel.material.map!.needsUpdate = true;
      return;
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
      if (panel.lines) {
        ctx.font = "25px sans-serif";
        panel.lines
          .slice(0, 4)
          .forEach((line, i) => ctx.fillText(line, 30, 185 + i * 40, 964));
      }
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
      panelVisible: this.panelVisible,
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
      yaw: this.rig.rotation.y,
      alignment: this.alignment,
      placement: this.placement,
      rawHead: this.rawHead.toArray(),
      table: this.frameConfig,
      captureA: this.captureA,
      gripPoints: this.grips.map((g) =>
        this.tipOffset
          .clone()
          .applyQuaternion(g.quaternion)
          .add(g.position)
          .toArray(),
      ),
      sampleFrames: sorted.length,
      frameMsP50: sorted[Math.floor(sorted.length * 0.5)] ?? null,
      frameMsP95: sorted[Math.floor(sorted.length * 0.95)] ?? null,
      panel: panel
        ? {
            matrix: panel.matrixWorld.toArray(),
            width: 2.4,
            height: 1.2,
            visible: panel.visible,
          }
        : null,
      selected: this.selected,
      selectionMarkerVisible: this.marker?.visible ?? false,
      soundOn: this.soundOn,
      audioPage: this.audioPage,
      creationModel: this.creationModel?.inspect() ?? null,
      sharedPage: this.sharedPanel?.title ?? null,
      radar: this.radar
        ? {
            visible: this.radar.mesh.visible,
            matrix: this.radar.mesh.matrixWorld.toArray(),
            width: 2.4,
            height: 1.2,
            ...this.radar.surface.diagnostics,
            held: this.radarGrab.active,
            handles: PANEL_HANDLES.map(x => this.radar!.mesh.localToWorld(new THREE.Vector3(x, 0.05, 0.01)).toArray()),
          }
        : null,
      controls: this.surface?.diagnostics ?? null,
      hands: this.handInput?.diagnostics ?? [],
      panelHeld: this.panelGrab.active,
      panelHandles:
        panel && this.panelHandles?.visible
          ? PANEL_HANDLES.map((x) =>
              panel.localToWorld(new THREE.Vector3(x, 0.05, 0.01)).toArray(),
            )
          : [],
    };
  }
}
