// InputController — обрабатывает мышь + тач: пан, pinch-zoom, тап.
// Работает с Renderer, обновляя его viewX/viewY/scale.

export class InputController {
  constructor(canvas, renderer, onTap) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.onTap = onTap;     // (worldX, worldY) => void
    this.pointers = new Map();
    this._pinchStart = null;
    this._panStart = null;
    this._tapStart = null;

    canvas.addEventListener('pointerdown', e => this._onDown(e), { passive: false });
    canvas.addEventListener('pointermove', e => this._onMove(e), { passive: false });
    canvas.addEventListener('pointerup', e => this._onUp(e), { passive: false });
    canvas.addEventListener('pointercancel', e => this._onUp(e), { passive: false });
    canvas.addEventListener('pointerleave', e => this._onUp(e), { passive: false });
    canvas.addEventListener('wheel', e => this._onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  _onDown(e) {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 1) {
      this._panStart = {
        x: e.clientX, y: e.clientY,
        viewX: this.renderer.viewX, viewY: this.renderer.viewY,
      };
      this._tapStart = { x: e.clientX, y: e.clientY, t: performance.now() };
    } else if (this.pointers.size === 2) {
      const pts = Array.from(this.pointers.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      this._pinchStart = {
        dist, cx, cy,
        scale: this.renderer.scale,
        viewX: this.renderer.viewX,
        viewY: this.renderer.viewY,
      };
      this._panStart = null;
      this._tapStart = null;
    }
    e.preventDefault();
  }

  _onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2 && this._pinchStart) {
      const pts = Array.from(this.pointers.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const ratio = dist / this._pinchStart.dist;
      const newScale = clamp(this._pinchStart.scale * ratio, 1, 60);
      const dpr = this.renderer.dpr;
      // Зум вокруг точки cx/cy.
      const wx = (cx * dpr - this._pinchStart.viewX) / this._pinchStart.scale;
      const wy = (cy * dpr - this._pinchStart.viewY) / this._pinchStart.scale;
      this.renderer.scale = newScale;
      this.renderer.viewX = cx * dpr - wx * newScale;
      this.renderer.viewY = cy * dpr - wy * newScale;
    } else if (this.pointers.size === 1 && this._panStart) {
      const dx = (e.clientX - this._panStart.x) * this.renderer.dpr;
      const dy = (e.clientY - this._panStart.y) * this.renderer.dpr;
      this.renderer.viewX = this._panStart.viewX + dx;
      this.renderer.viewY = this._panStart.viewY + dy;
    }
    e.preventDefault();
  }

  _onUp(e) {
    if (!this.pointers.has(e.pointerId)) return;

    // Тап-детект: короткое касание без сильного смещения.
    if (this._tapStart && this.pointers.size === 1) {
      const dt = performance.now() - this._tapStart.t;
      const dx = e.clientX - this._tapStart.x;
      const dy = e.clientY - this._tapStart.y;
      const dist = Math.hypot(dx, dy);
      if (dt < 250 && dist < 10) {
        const { x, y } = this.renderer.screenToWorld(e.clientX, e.clientY);
        if (this.onTap) this.onTap(x, y);
      }
    }

    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this._pinchStart = null;
    if (this.pointers.size === 0) {
      this._panStart = null;
      this._tapStart = null;
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.111;
    const newScale = clamp(this.renderer.scale * factor, 1, 60);
    const dpr = this.renderer.dpr;
    const wx = (e.clientX * dpr - this.renderer.viewX) / this.renderer.scale;
    const wy = (e.clientY * dpr - this.renderer.viewY) / this.renderer.scale;
    this.renderer.scale = newScale;
    this.renderer.viewX = e.clientX * dpr - wx * newScale;
    this.renderer.viewY = e.clientY * dpr - wy * newScale;
  }
}

function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }
