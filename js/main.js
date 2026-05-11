// Точка входа: создаёт симуляцию, рендерер, контроллер ввода, UI и
// запускает главный цикл (requestAnimationFrame).

import { DEFAULT_PARAMS } from './constants.js';
import { Simulation } from './sim.js';
import { Renderer } from './renderer.js';
import { InputController } from './input.js';
import { UI } from './ui.js';
import { StatsChart } from './chart.js';

const canvas = document.getElementById('world');
const chartCanvas = document.getElementById('stats-chart');

let params = { ...DEFAULT_PARAMS };
let sim = new Simulation(params);
let renderer = new Renderer(canvas, sim);
let selectedCell = null;
const statsChart = new StatsChart(chartCanvas);

const ui = new UI({
  sim,
  renderer,
  statsChart,
  getSim: () => sim,
  onReset: () => reset(),
});

function reset() {
  const pending = ui.consumePendingParams();
  if (pending) params = { ...params, ...pending };
  sim = new Simulation(params);
  renderer.setSim(sim);
  renderer.fitWorld();
  ui.setSim(sim);
  selectedCell = null;
  ui.showCellInfo(null);
  statsChart.reset();
}

new InputController(canvas, renderer, (wx, wy) => {
  if (wx < 0 || wy < 0 || wx >= sim.world.w || wy >= sim.world.h) {
    selectedCell = null;
    ui.showCellInfo(null);
    return;
  }
  const c = sim.cellAt(wx, wy);
  selectedCell = c;
  ui.showCellInfo(c);
});

// Главный цикл с фиксированным шагом симуляции и отдельной отрисовкой.
let lastTime = performance.now();
let fpsAccum = 0;
let fpsFrames = 0;
let lastStatsAt = 0;

function frame(now) {
  const dt = now - lastTime;
  lastTime = now;

  // Сколько шагов симуляции — управляется ползунком скорости.
  if (!ui.paused) {
    for (let i = 0; i < ui.speed; i++) sim.step();
    // Если выбранная клетка умерла — очищаем плашку.
    if (selectedCell && !selectedCell.alive) {
      selectedCell = null;
      ui.showCellInfo(null);
    } else if (selectedCell) {
      ui.showCellInfo(selectedCell);
    }
  }

  renderer.render();

  // FPS.
  fpsAccum += dt;
  fpsFrames++;
  if (now - lastStatsAt > 250) {
    const fps = fpsFrames * 1000 / fpsAccum;
    const stats = {
      generation: sim.maxGeneration,
      avgLifespan: sim.avgLifespan,
      tick: sim.tick,
      population: sim.cells.size,
      populationStats: sim.populationStats,
      lightMul: sim.lightMul,
      storm: sim.storm,
      fps,
    };
    ui.updateStats(stats);
    if (!ui.paused) statsChart.push(stats);
    statsChart.draw();
    fpsAccum = 0;
    fpsFrames = 0;
    lastStatsAt = now;
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
