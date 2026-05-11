// UI binding — связывает DOM-элементы с симуляцией и рендерером.

import { VIEW_MODES, CELL_TYPE_NAMES, CELL_TYPE_KEYS, DEFAULT_PARAMS } from './constants.js';

export class UI {
  constructor({ sim, renderer, statsChart, onReset, getSim }) {
    this.sim = sim;
    this.renderer = renderer;
    this.statsChart = statsChart;
    this.onReset = onReset;
    this.getSim = getSim;  // ленивый геттер, потому что sim пересоздаётся при сбросе.
    this.paused = false;
    this.speed = 3;
    this.hintShown = false;

    this._bindControls();
    this._bindMenu();
    this._bindChart();
    this._showHintBriefly();
  }

  setSim(sim) { this.sim = sim; }

  _bindControls() {
    const $ = sel => document.querySelector(sel);

    this.btnPlay = $('#btn-play');
    this.btnStep = $('#btn-step');
    this.btnReset = $('#btn-reset');
    this.btnMenu = $('#btn-menu');
    this.speedRange = $('#speed');
    this.speedVal = $('#speed-val');
    this.menu = $('#menu');
    this.cellInfo = $('#cell-info');

    this.btnPlay.addEventListener('click', () => this.togglePause());
    this.btnStep.addEventListener('click', () => {
      if (!this.paused) this.togglePause();
      this.getSim().step();
    });
    this.btnReset.addEventListener('click', () => this.onReset());
    this.btnMenu.addEventListener('click', () => this.toggleMenu(true));
    this.speedRange.addEventListener('input', e => {
      this.speed = parseInt(e.target.value, 10);
      this.speedVal.textContent = `${this.speed}×`;
    });

    // Режимы отображения.
    document.querySelectorAll('#view-modes .mode').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#view-modes .mode').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderer.setMode(btn.dataset.mode);
      });
    });
  }

  _bindMenu() {
    const $ = sel => document.querySelector(sel);
    $('#btn-close-menu').addEventListener('click', () => this.toggleMenu(false));
    this.menu.addEventListener('click', e => {
      if (e.target === this.menu) this.toggleMenu(false);
    });

    // Размер мира.
    document.querySelectorAll('.seg[data-key="worldSize"] button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.seg[data-key="worldSize"] button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._pendingParams = this._pendingParams || {};
        this._pendingParams.worldSize = parseInt(btn.dataset.v, 10);
      });
    });

    const bindRange = (id, valId, key, transform = v => v, fmt = v => v) => {
      const input = $(id);
      const valEl = $(valId);
      input.addEventListener('input', () => {
        const v = transform(parseInt(input.value, 10));
        valEl.textContent = fmt(parseInt(input.value, 10));
        this._pendingParams = this._pendingParams || {};
        this._pendingParams[key] = v;
      });
    };

    bindRange('#set-start-pop', '#set-start-pop-val', 'startPopulation', v => v, v => `${v}`);
    bindRange('#set-mutation', '#set-mutation-val', 'mutationStrength', v => v / 100, v => `${v}%`);
    bindRange('#set-decay', '#set-decay-val', 'organicDecay', v => v / 1000, v => `${(v / 10).toFixed(1)}%`);
    bindRange('#set-toxic', '#set-toxic-val', 'toxicThreshold', v => v, v => `${v}`);

    $('#set-show-sectors').addEventListener('change', e => {
      this.renderer.showSectors = e.target.checked;
    });
    $('#set-show-grid').addEventListener('change', e => {
      this.renderer.showGrid = e.target.checked;
    });
  }

  _bindChart() {
    this.chartPanel = document.getElementById('chart-panel');
    this.btnChart = document.getElementById('btn-chart');
    const btnClose = document.getElementById('btn-chart-close');
    // Состояние сохраняем в localStorage, чтобы между сессиями помнилось.
    let hidden = false;
    try { hidden = localStorage.getItem('chart-hidden') === '1'; } catch (e) {}
    this.chartPanel.classList.toggle('hidden', hidden);
    this.btnChart.classList.toggle('primary', !hidden);

    const set = (state) => {
      this.chartPanel.classList.toggle('hidden', !state);
      this.btnChart.classList.toggle('primary', state);
      try { localStorage.setItem('chart-hidden', state ? '0' : '1'); } catch (e) {}
    };
    this.btnChart.addEventListener('click', () => {
      set(this.chartPanel.classList.contains('hidden'));
    });
    btnClose.addEventListener('click', () => set(false));
  }

  togglePause(forceState) {
    this.paused = forceState === undefined ? !this.paused : forceState;
    this.btnPlay.textContent = this.paused ? '▶' : '⏸';
    this.btnPlay.classList.toggle('primary', !this.paused);
  }

  toggleMenu(state) {
    this.menu.classList.toggle('hidden', !state);
  }

  // Возвращает любые отложенные изменения параметров (применяются при сбросе).
  consumePendingParams() {
    const p = this._pendingParams || null;
    this._pendingParams = null;
    return p;
  }

  // Показывает информацию о клетке внизу слева.
  showCellInfo(cell) {
    if (!cell) {
      this.cellInfo.classList.add('hidden');
      return;
    }
    const g = cell.genome;
    const name = CELL_TYPE_NAMES[cell.type];
    const key = CELL_TYPE_KEYS[cell.type];
    const dirs = ['↑', '→', '↓', '←'];
    const dirText = Array.from(g.dirPreference)
      .map((p, i) => `${dirs[i]}${(p * 100).toFixed(0)}`)
      .join(' ');

    // Грубая оценка «развитости мозга»: норма весов выше нуля = сеть отошла
    // от случайной инициализации. Растёт с поколениями только если отбор работает.
    let brainNorm = 0;
    if (g.brain) {
      for (let i = 0; i < g.brain.length; i++) brainNorm += g.brain[i] * g.brain[i];
      brainNorm = Math.sqrt(brainNorm / g.brain.length);
    }

    this.cellInfo.innerHTML = `
      <div class="ci-title" style="color: rgb(${(cell.color[0]*255)|0}, ${(cell.color[1]*255)|0}, ${(cell.color[2]*255)|0})">${name}</div>
      <div class="ci-row"><span>Поколение</span><span>${cell.generation}</span></div>
      <div class="ci-row"><span>Детей</span><span>${cell.children}</span></div>
      <div class="ci-row"><span>Энергия</span><span>${cell.energy.toFixed(1)}</span></div>
      <div class="ci-row"><span>Возраст / макс</span><span>${cell.age} / ${g.maxAge}</span></div>
      <div class="ci-row"><span>Метаболизм</span><span>${g.metabolism.toFixed(2)}</span></div>
      <div class="ci-row"><span>Агрессия</span><span>${g.aggression.toFixed(2)}</span></div>
      <div class="ci-row"><span>Толер. яда</span><span>${g.toxicResistance.toFixed(2)}</span></div>
      <div class="ci-row"><span>Мутагенность</span><span>${(g.mutationRate*100).toFixed(1)}%</span></div>
      <div class="ci-row"><span>Порог размнож.</span><span>${g.reproduceThreshold.toFixed(1)}</span></div>
      <div class="ci-row"><span>Направления</span><span>${dirText}</span></div>
      <div class="ci-row" title="‖веса мозга‖₂: чем больше, тем сильнее сеть отошла от случайной"><span>‖мозг‖</span><span>${brainNorm.toFixed(2)}</span></div>
    `;
    this.cellInfo.classList.remove('hidden');
  }

  // Обновляет HUD каждые несколько кадров.
  updateStats(stats) {
    document.getElementById('stat-gen').textContent = stats.generation;
    document.getElementById('stat-tick').textContent = stats.tick;
    document.getElementById('stat-pop').textContent = stats.population;
    document.getElementById('stat-fps').textContent = stats.fps.toFixed(0);
    const lifeEl = document.getElementById('stat-life');
    if (lifeEl) lifeEl.textContent = stats.avgLifespan.toFixed(0);
    const p = stats.populationStats;
    document.getElementById('pop-leaf').textContent = p[0];
    document.getElementById('pop-root').textContent = p[1];
    document.getElementById('pop-antenna').textContent = p[2];
    document.getElementById('pop-predator').textContent = p[3];
  }

  _showHintBriefly() {
    const hint = document.getElementById('hint');
    hint.classList.remove('hidden');
    setTimeout(() => hint.classList.add('hidden'), 4500);
  }
}
