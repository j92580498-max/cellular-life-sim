// Renderer — отвечает за отрисовку мира на canvas.
// Поддерживает разные режимы: клетки, тепловые карты (органика, свет, токсичность,
// энергия), а также пан/зум через viewport.

import { VIEW_MODES, CELL_TYPE_COLORS } from './constants.js';

export class Renderer {
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.sim = sim;
    this.mode = VIEW_MODES.CELLS;
    this.showSectors = false;
    this.showGrid = false;
    // «Кубики» и «поселения» — стилизация в режиме клеток. Внутренние грани
    // между клетками одного клана и контурные линии границ кланов соответственно.
    this.showCubeEdges = true;
    this.showSettlements = true;
    this.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

    // Камера: смещение в координатах мира + масштаб (пиксель = scale).
    this.viewX = 0;
    this.viewY = 0;
    this.scale = 6;

    // Промежуточный bitmap размером в W*H — рисуем клетки/тепло пиксельно,
    // потом масштабируем на canvas. Это сильно быстрее, чем fillRect для каждой
    // клетки на 50000+ ячеек.
    this._buildBitmap();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  setSim(sim) {
    this.sim = sim;
    this._buildBitmap();
  }

  _buildBitmap() {
    const W = this.sim.world.w;
    const H = this.sim.world.h;
    this.bitmap = document.createElement('canvas');
    this.bitmap.width = W;
    this.bitmap.height = H;
    this.bitmapCtx = this.bitmap.getContext('2d', { alpha: false });
    this.imageData = this.bitmapCtx.createImageData(W, H);
  }

  _resize() {
    const c = this.canvas;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = Math.floor(w * this.dpr);
    c.height = Math.floor(h * this.dpr);

    // Авто-подгонка камеры: показать весь мир по умолчанию.
    this.fitWorld();
  }

  fitWorld() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const W = this.sim.world.w;
    const H = this.sim.world.h;
    const margin = 8 * this.dpr;
    this.scale = Math.min((w - margin * 2) / W, (h - margin * 2) / H);
    this.viewX = (w - this.scale * W) / 2;
    this.viewY = (h - this.scale * H) / 2;
  }

  setMode(mode) { this.mode = mode; }

  // Главный рендер-вызов. Каждый кадр.
  render() {
    const ctx = this.ctx;
    const c = this.canvas;
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, c.width, c.height);

    this._drawWorldToBitmap();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bitmap, this.viewX, this.viewY, this.bitmap.width * this.scale, this.bitmap.height * this.scale);

    // Кубики/поселения — только в режиме клеток, и только если масштаб даёт
    // достаточно пикселей на клетку, чтобы линии были различимы.
    if (this.mode === VIEW_MODES.CELLS && this.scale >= 2.5 &&
        (this.showSettlements || this.showCubeEdges)) {
      this._drawSettlementBorders();
    }
    if (this.showGrid && this.scale >= 4) this._drawGrid();
    if (this.showSectors) this._drawSectors();
    if (this.sim.storm) this._drawStorm(this.sim.storm);

    // Ночь — лёгкое потемнение поверх всего, чтобы пользователь видел смену суток.
    const lm = this.sim.lightMul ?? 1;
    if (lm < 0.95) {
      ctx.fillStyle = `rgba(8, 14, 40, ${Math.min(0.55, (1 - lm) * 0.6)})`;
      ctx.fillRect(0, 0, c.width, c.height);
    }
  }

  // Контуры поселений + сетка-«кубики». Для каждой клетки смотрим правого и
  // нижнего соседа: если они принадлежат другому клану (или соседа нет вовсе),
  // ребро между ними — граница поселения. Иначе — внутренняя грань (cube edge).
  // Всё рисуем двумя Path2D и за один stroke на каждую категорию, чтобы 5000+
  // клеток не съели FPS.
  _drawSettlementBorders() {
    const W = this.sim.world;
    const cells = this.sim.cells;
    const w = W.w, h = W.h;
    const scale = this.scale;
    const ox = this.viewX, oy = this.viewY;
    const grid = W.cellGrid;
    const wantCube = this.showCubeEdges;
    const wantSettle = this.showSettlements;

    const cube = wantCube ? new Path2D() : null;
    const border = wantSettle ? new Path2D() : null;

    for (let y = 0; y < h; y++) {
      const py = oy + y * scale;
      const pyEnd = py + scale;
      const rowBase = y * w;
      for (let x = 0; x < w; x++) {
        const i = rowBase + x;
        const id = grid[i];
        if (id === 0) continue;
        const cell = cells.get(id);
        if (!cell) continue;
        const myClan = cell.clan;
        const px = ox + x * scale;
        const pxEnd = px + scale;

        // Правое ребро.
        if (x + 1 < w) {
          const rId = grid[i + 1];
          if (rId === 0) {
            if (border) { border.moveTo(pxEnd, py); border.lineTo(pxEnd, pyEnd); }
          } else {
            const r = cells.get(rId);
            if (r) {
              if (r.clan !== myClan) {
                if (border) { border.moveTo(pxEnd, py); border.lineTo(pxEnd, pyEnd); }
              } else if (cube) {
                cube.moveTo(pxEnd, py); cube.lineTo(pxEnd, pyEnd);
              }
            }
          }
        }
        // Нижнее ребро.
        if (y + 1 < h) {
          const bId = grid[i + w];
          if (bId === 0) {
            if (border) { border.moveTo(px, pyEnd); border.lineTo(pxEnd, pyEnd); }
          } else {
            const b = cells.get(bId);
            if (b) {
              if (b.clan !== myClan) {
                if (border) { border.moveTo(px, pyEnd); border.lineTo(pxEnd, pyEnd); }
              } else if (cube) {
                cube.moveTo(px, pyEnd); cube.lineTo(pxEnd, pyEnd);
              }
            }
          }
        }
      }
    }

    const ctx = this.ctx;
    if (cube) {
      ctx.lineWidth = Math.max(1, scale * 0.08);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.stroke(cube);
    }
    if (border) {
      ctx.lineWidth = Math.max(1.4, scale * 0.18);
      ctx.strokeStyle = 'rgba(255, 240, 200, 0.85)';
      ctx.stroke(border);
    }
  }

  _drawStorm(s) {
    const ctx = this.ctx;
    const S = this.sim.world.sectorSize * this.scale;
    const x = this.viewX + s.sx * S;
    const y = this.viewY + s.sy * S;
    // Пульсация по оставшемуся времени.
    const t = s.ticksLeft / s.totalDuration;
    const pulse = 0.25 + 0.25 * Math.abs(Math.sin(performance.now() / 220));
    ctx.fillStyle = `rgba(220, 200, 80, ${pulse * t})`;
    ctx.fillRect(x, y, S, S);
    ctx.strokeStyle = `rgba(255, 230, 120, ${0.4 + 0.4 * t})`;
    ctx.lineWidth = 2 * this.dpr;
    ctx.strokeRect(x + 1, y + 1, S - 2, S - 2);
  }

  _drawWorldToBitmap() {
    const W = this.sim.world;
    const data = this.imageData.data;
    const len = W.area;

    switch (this.mode) {
      case VIEW_MODES.CELLS:    this._fillCellsMode(data, len); break;
      case VIEW_MODES.ORGANIC:  this._fillHeatmap(data, len, W.organic, [0.55, 0.25, 0.06]); break;
      case VIEW_MODES.LIGHT:    this._fillHeatmapFixed(data, len, W.light, [1.0, 0.95, 0.55]); break;
      case VIEW_MODES.TOXIN:    this._fillToxinMode(data, len); break;
      case VIEW_MODES.ENERGY:   this._fillEnergyMode(data, len); break;
    }
    this.bitmapCtx.putImageData(this.imageData, 0, 0);
  }

  _fillCellsMode(data, len) {
    const W = this.sim.world;
    const cells = this.sim.cells;
    const organic = W.organic;
    const params = this.sim.params;
    const toxicT = params.toxicThreshold;

    for (let i = 0; i < len; i++) {
      const di = i * 4;
      const id = W.cellGrid[i];
      if (id !== 0) {
        const cell = cells.get(id);
        if (cell) {
          const [r, g, b] = cell.color;
          // Яркость зависит от энергии (тусклые клетки = слабые).
          const eShade = 0.55 + 0.45 * Math.min(1, cell.energy / 80);
          data[di]     = (r * eShade * 255) | 0;
          data[di + 1] = (g * eShade * 255) | 0;
          data[di + 2] = (b * eShade * 255) | 0;
          data[di + 3] = 255;
          continue;
        }
      }
      // Пустая клетка: фоновый цвет с лёгким оттенком органики и токсичности.
      const o = organic[i];
      let bgR = 6, bgG = 10, bgB = 18;
      if (o > 1) {
        const intensity = Math.min(1, o / toxicT);
        // Коричневый оттенок органики.
        bgR += intensity * 38;
        bgG += intensity * 26;
        bgB += intensity * 12;
        if (o > toxicT) {
          const t = Math.min(1, (o - toxicT) / toxicT);
          // Зеленовато-ядовитый оттенок поверх.
          bgR += t * 30;
          bgG += t * 56;
          bgB -= t * 6;
        }
      }
      data[di]     = bgR | 0;
      data[di + 1] = bgG | 0;
      data[di + 2] = bgB | 0;
      data[di + 3] = 255;
    }
  }

  _fillHeatmap(data, len, arr, peakColor) {
    // Нормируем по максимуму карты, чтобы heatmap был контрастным.
    let max = 0;
    for (let i = 0; i < len; i++) if (arr[i] > max) max = arr[i];
    if (max < 1e-3) max = 1;
    const [pr, pg, pb] = peakColor;
    for (let i = 0; i < len; i++) {
      const di = i * 4;
      const t = Math.min(1, arr[i] / max);
      data[di]     = (10 + pr * 245 * t) | 0;
      data[di + 1] = (14 + pg * 245 * t) | 0;
      data[di + 2] = (20 + pb * 245 * t) | 0;
      data[di + 3] = 255;
    }
  }

  _fillHeatmapFixed(data, len, arr, peakColor) {
    // Карта в [0..1], нормировать не нужно.
    const [pr, pg, pb] = peakColor;
    for (let i = 0; i < len; i++) {
      const di = i * 4;
      const t = Math.min(1, arr[i]);
      data[di]     = (10 + pr * 245 * t) | 0;
      data[di + 1] = (14 + pg * 245 * t) | 0;
      data[di + 2] = (20 + pb * 245 * t) | 0;
      data[di + 3] = 255;
    }
  }

  _fillToxinMode(data, len) {
    const W = this.sim.world;
    const params = this.sim.params;
    const T = params.toxicThreshold;
    for (let i = 0; i < len; i++) {
      const di = i * 4;
      const o = W.organic[i];
      if (o <= T) {
        // Сублимально показываем органику тоже.
        const t = Math.min(1, o / T);
        data[di]     = (10 + 36 * t) | 0;
        data[di + 1] = (14 + 26 * t) | 0;
        data[di + 2] = (20 + 12 * t) | 0;
      } else {
        const t = Math.min(1, (o - T) / T);
        data[di]     = (40 + 80 * t) | 0;
        data[di + 1] = (60 + 180 * t) | 0;
        data[di + 2] = (40 + 30 * t) | 0;
      }
      data[di + 3] = 255;
    }
  }

  _fillEnergyMode(data, len) {
    const W = this.sim.world;
    const cells = this.sim.cells;
    const maxE = this.sim.params.maxEnergy;
    for (let i = 0; i < len; i++) {
      const di = i * 4;
      const id = W.cellGrid[i];
      if (id !== 0) {
        const c = cells.get(id);
        if (c) {
          const t = Math.min(1, c.energy / maxE);
          // Градиент: тёмно-синий -> голубой -> белый
          data[di]     = (20 + t * 235) | 0;
          data[di + 1] = (40 + t * 215) | 0;
          data[di + 2] = (90 + t * 165) | 0;
          data[di + 3] = 255;
          continue;
        }
      }
      data[di]     = 8;
      data[di + 1] = 11;
      data[di + 2] = 16;
      data[di + 3] = 255;
    }
  }

  _drawGrid() {
    const ctx = this.ctx;
    const W = this.sim.world.w;
    const H = this.sim.world.h;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x++) {
      const px = this.viewX + x * this.scale;
      ctx.moveTo(px, this.viewY);
      ctx.lineTo(px, this.viewY + H * this.scale);
    }
    for (let y = 0; y <= H; y++) {
      const py = this.viewY + y * this.scale;
      ctx.moveTo(this.viewX, py);
      ctx.lineTo(this.viewX + W * this.scale, py);
    }
    ctx.stroke();
  }

  _drawSectors() {
    const ctx = this.ctx;
    const N = this.sim.world.sectorsPerSide;
    const S = this.sim.world.sectorSize * this.scale;
    ctx.strokeStyle = 'rgba(106,190,111,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const p = this.viewX + i * S;
      const py = this.viewY + i * S;
      ctx.moveTo(p, this.viewY);
      ctx.lineTo(p, this.viewY + this.sim.world.h * this.scale);
      ctx.moveTo(this.viewX, py);
      ctx.lineTo(this.viewX + this.sim.world.w * this.scale, py);
    }
    ctx.stroke();
  }

  // Преобразование экранных координат в координаты мира.
  screenToWorld(sx, sy) {
    const x = Math.floor((sx * this.dpr - this.viewX) / this.scale);
    const y = Math.floor((sy * this.dpr - this.viewY) / this.scale);
    return { x, y };
  }
}
