interface Window {
  render_game_to_text: () => string;
  advanceTime: (ms: number) => Promise<void>;
  __soundTrailRender?: { calls: number; triangles: number; geometries: number };
}
