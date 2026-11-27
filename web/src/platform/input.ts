// Keyboard, mouse and touch input -> movement bits + third-person camera orbit.

export const BIT = { FWD: 1, BACK: 2, LEFT: 4, RIGHT: 8, RUN: 16 } as const;

export class Input {
  bits = 0;
  /** Camera azimuth around the player (radians). */
  yaw = 0;
  pitch = 0.3;
  dist = 6.5;
  enabled = true;
  onKey: ((code: string) => void) | null = null;

  private keys = new Set<string>();
  private drag: { id: number; x: number; y: number } | null = null;
  private stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.onKey?.(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener(
      'wheel',
      (e) => {
        this.dist = Math.min(18, Math.max(2.5, this.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
        e.preventDefault();
      },
      { passive: false },
    );
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private down(e: PointerEvent) {
    const touchLeft = e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.45;
    if (touchLeft && !this.stick) {
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    } else if (!this.drag) {
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  }

  private move(e: PointerEvent) {
    if (this.stick && e.pointerId === this.stick.id) {
      this.stick.x = e.clientX;
      this.stick.y = e.clientY;
    } else if (this.drag && e.pointerId === this.drag.id) {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.yaw -= dx * 0.006;
      this.pitch = Math.min(1.25, Math.max(0.05, this.pitch + dy * 0.004));
    }
  }

  private up(e: PointerEvent) {
    if (this.stick && e.pointerId === this.stick.id) this.stick = null;
    if (this.drag && e.pointerId === this.drag.id) this.drag = null;
  }

  update() {
    let b = 0;
    if (!this.enabled) {
      this.bits = 0;
      return;
    }
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) b |= BIT.FWD;
    if (k.has('KeyS') || k.has('ArrowDown')) b |= BIT.BACK;
    if (k.has('KeyA') || k.has('ArrowLeft')) b |= BIT.LEFT;
    if (k.has('KeyD') || k.has('ArrowRight')) b |= BIT.RIGHT;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) b |= BIT.RUN;
    if (this.stick) {
      const dx = this.stick.x - this.stick.ox;
      const dy = this.stick.y - this.stick.oy;
      const t = 18;
      if (dy < -t) b |= BIT.FWD;
      if (dy > t) b |= BIT.BACK;
      if (dx < -t) b |= BIT.LEFT;
      if (dx > t) b |= BIT.RIGHT;
      if (Math.hypot(dx, dy) > 80) b |= BIT.RUN;
    }
    this.bits = b;
  }

  /** Ground-plane forward vector of the camera (x, z). */
  forward(): [number, number] {
    return [-Math.sin(this.yaw), -Math.cos(this.yaw)];
  }
}
