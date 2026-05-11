// StatsChart — небольшой график статистики во времени.
// Хранит ring-буфер сэмплов и рисует все линии на одном canvas с
// нормировкой каждой серии к её собственному максимуму на окне.

const SERIES = [
  { key: 'pop',      color: '#eceff4' },  // всего клеток
  { key: 'life',     color: '#5dade2' },  // среднее время жизни (EMA)
  { key: 'gen',      color: '#bb86fc' },  // макс. поколение
  { key: 'leaf',     color: '#6abe6f' },
  { key: 'root',     color: '#b58060' },
  { key: 'antenna',  color: '#d8c264' },
  { key: 'predator', color: '#d96868' },
];

export class StatsChart {
  constructor(canvasEl, opts = {}) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.maxSamples = opts.maxSamples ?? 240;  // ~60 сек при шаге 250 мс
    this.samples = [];
    this._w = 0;
    this._h = 0;
    this._resize();
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(canvasEl);
    } else {
      window.addEventListener('resize', () => this._resize());
    }
  }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(r.width * dpr));
    const h = Math.max(1, Math.floor(r.height * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = r.width;
    this._h = r.height;
  }

  push(stats) {
    const p = stats.populationStats || [0, 0, 0, 0];
    this.samples.push({
      pop:      stats.population,
      life:     stats.avgLifespan,
      gen:      stats.generation,
      leaf:     p[0],
      root:     p[1],
      antenna:  p[2],
      predator: p[3],
    });
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  reset() {
    this.samples = [];
  }

  draw() {
    const ctx = this.ctx;
    const w = this._w;
    const h = this._h;
    ctx.clearRect(0, 0, w, h);

    // фоновая сетка
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const y = Math.round((h / 4) * i) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    const N = this.samples.length;
    if (N < 2) return;

    // максимум по каждой серии в текущем окне (нормировка)
    const maxs = {};
    for (const s of SERIES) maxs[s.key] = 1;
    for (let i = 0; i < N; i++) {
      const sa = this.samples[i];
      for (const s of SERIES) {
        const v = sa[s.key];
        if (v > maxs[s.key]) maxs[s.key] = v;
      }
    }

    const dx = w / (this.maxSamples - 1);
    const xOff = (this.maxSamples - N) * dx;
    const innerH = h - 4;

    for (const s of SERIES) {
      const mx = maxs[s.key];
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = xOff + i * dx;
        const v = this.samples[i][s.key] / mx;
        const y = h - 2 - v * innerH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}
