/** Metres from the front of a panel. Require a fresh approach after each press/lost pose. */
export class DirectTouchGate {
  private armed: string | null = null;
  private pressed = false;
  reset() {
    this.armed = null;
    this.pressed = false;
  }
  consume() {
    this.armed = null;
    this.pressed = true;
  }
  update(target: string | null, depth: number | null): string | null {
    if (depth === null || !Number.isFinite(depth)) {
      this.reset();
      return null;
    }
    if (depth > 0.035) {
      this.pressed = false;
      this.armed = depth <= 0.12 ? target : null;
      return null;
    }
    if (depth < -0.025 || !target) {
      this.armed = null;
      return null;
    }
    if (target !== this.armed) this.armed = null;
    if (!this.pressed && target === this.armed && depth <= 0.009) {
      this.consume();
      return target;
    }
    return null;
  }
}
