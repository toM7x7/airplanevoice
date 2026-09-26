interface Window {
  render_game_to_text: () => string;
  advanceTime: (ms: number) => Promise<void>;
  __soundTrailRender?: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
    appearance: "procedural-v2";
    soundTrace?: { mode: string; segments: number; lineSegments: number };
    environment: boolean;
  };
  __soundTrailTargets?: import("./Scene").AircraftTarget[];
}
