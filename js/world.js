// World — двумерная сетка с замкнутыми (torical) границами.
// Хранит карты органики, света, заряда, токсичности и id клеток.
// Все карты — Float32Array / Int32Array для скорости.

import { DEFAULT_PARAMS } from './constants.js';

export class World {
  constructor(size, params = DEFAULT_PARAMS) {
    this.size = size;
    this.w = size;
    this.h = size;
    this.params = params;
    this.area = size * size;

    // id клетки в данной ячейке (0 = пусто). Используем Int32Array.
    this.cellGrid = new Int32Array(this.area);

    // Уровень органики (постепенно разлагается, увеличивается от смерти клеток).
    this.organic = new Float32Array(this.area);

    // Карта света — постоянная, считается один раз. Можно сделать динамической
    // (день/ночь), но это усложняет балансировку — оставляем градиент сверху.
    this.light = new Float32Array(this.area);

    // Карта заряда — атмосферный ресурс для антенн. Делаем "противоположную"
    // структуру: меньше у поверхности, больше внизу — но с шумом, чтобы возникали
    // ниши.
    this.charge = new Float32Array(this.area);

    // Сектора — для агрегированной статистики и (по желанию) локальных условий.
    this.sectorsPerSide = params.sectorsPerSide;
    this.sectorSize = Math.ceil(size / this.sectorsPerSide);

    this._buildLightAndCharge();
  }

  idx(x, y) {
    // Torus wrap.
    const w = this.w, h = this.h;
    if (x < 0) x = (x % w + w) % w; else if (x >= w) x = x % w;
    if (y < 0) y = (y % h + h) % h; else if (y >= h) y = y % h;
    return y * w + x;
  }

  // Сектор для (x, y).
  sectorOf(x, y) {
    const sx = Math.floor(x / this.sectorSize);
    const sy = Math.floor(y / this.sectorSize);
    return sy * this.sectorsPerSide + sx;
  }

  // Заполняет карты света и заряда. Свет сильнее наверху, заряд — в средней
  // полосе с шумом. Это создаёт пространственные ниши для разных типов клеток.
  _buildLightAndCharge() {
    const w = this.w, h = this.h;
    for (let y = 0; y < h; y++) {
      const lightY = 1 - y / (h - 1);                   // сверху = 1, внизу = 0
      const chargeY = 0.4 + 0.6 * Math.sin((y / h) * Math.PI); // максимум посередине
      for (let x = 0; x < w; x++) {
        // Небольшой синусный шум по x для разнообразия.
        const variation = 0.85 + 0.3 * Math.sin((x / w) * Math.PI * 2 + y * 0.1);
        const i = y * w + x;
        this.light[i]  = Math.max(0, Math.min(1, lightY * variation));
        this.charge[i] = Math.max(0, Math.min(1, chargeY * (1.05 - variation * 0.5)));
      }
    }
  }

  // Тик окружения — разложение органики, без учёта клеток.
  envTick() {
    const decay = 1 - this.params.organicDecay;
    const organic = this.organic;
    for (let i = 0; i < organic.length; i++) {
      organic[i] *= decay;
      if (organic[i] < 0.01) organic[i] = 0;
    }
  }

  toxicityAt(i) {
    const o = this.organic[i];
    const t = this.params.toxicThreshold;
    if (o <= t) return 0;
    return Math.min(1, (o - t) / t);
  }

  // Возвращает максимальное значение в карте — пригодится для нормализации
  // тепловых карт.
  maxOf(arr) {
    let m = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
    return m;
  }
}
