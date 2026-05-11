// Simulation — главный класс, отвечающий за логику клеток и эволюции.
// Содержит World и Map<id, Cell>. Все решения клеток принимаются здесь.

import { CELL_TYPES, NEIGHBORS_4, NEIGHBORS_8, DEFAULT_PARAMS } from './constants.js';
import { World } from './world.js';
import { Cell, resetCellIds } from './cell.js';
import { randomGenome, mutate } from './genome.js';
import {
  BRAIN_IN, BRAIN_HID, BRAIN_OUT,
  OUT_DIR_UP, OUT_DIR_RIGHT, OUT_DIR_DOWN, OUT_DIR_LEFT,
  OUT_REPRODUCE, OUT_ATTACK,
  forward, softmaxDir, sigmoid,
} from './brain.js';

export class Simulation {
  constructor(params = { ...DEFAULT_PARAMS }) {
    this.params = params;
    this.world = new World(params.worldSize, params);
    this.cells = new Map();      // id -> Cell
    this.tick = 0;
    // Реальная глубина поколений — максимум по живым клеткам.
    this.maxGeneration = 0;
    // Скользящее среднее возраста умерших — простой прокси для «выживаемости/умности».
    this.avgLifespan = 0;
    this.populationStats = [0, 0, 0, 0];
    this.deathsThisTick = 0;
    this.birthsThisTick = 0;
    // Климат: динамические модификаторы окружения. Обновляются в _climateTick().
    this.climateTick = 0;
    this.lightMul = 1;     // множитель света (день/ночь, 0..1)
    this.metabMul = 1;     // множитель базового метаболизма
    this.storm = null;     // {sx, sy, ticksLeft, totalDuration, intensity}
    this.dayPhase = 0;     // 0..1 — доля в текущих сутках
    // Workspace-буферы для прямого прохода мозга — переиспользуются между клетками,
    // чтобы не аллоцировать памяти каждый тик.
    this._inputBuf  = new Float32Array(BRAIN_IN);
    this._hiddenBuf = new Float32Array(BRAIN_HID);
    this._outputBuf = new Float32Array(BRAIN_OUT);
    this._seedPopulation(params.startPopulation);
  }

  // ------------------------------------------------------------------
  // Старт
  _seedPopulation(n) {
    resetCellIds();
    const { worldSize, initialEnergy } = this.params;
    let placed = 0;
    let attempts = 0;
    while (placed < n && attempts < n * 20) {
      attempts++;
      const x = Math.floor(Math.random() * worldSize);
      const y = Math.floor(Math.random() * worldSize);
      const i = this.world.idx(x, y);
      if (this.world.cellGrid[i] !== 0) continue;
      const g = randomGenome();
      const c = new Cell(x, y, g, initialEnergy);
      this.cells.set(c.id, c);
      this.world.cellGrid[i] = c.id;
      placed++;
    }
  }

  // ------------------------------------------------------------------
  // Один тик симуляции.
  step() {
    this.tick++;
    this.deathsThisTick = 0;
    this.birthsThisTick = 0;

    // Итерируем по копии id-шников, потому что во время цикла появляются и
    // удаляются клетки. Сначала собираем актуальный список, потом обрабатываем.
    const ids = Array.from(this.cells.keys());

    // Шафлим, чтобы поведение было справедливым (никто не получает приоритет
    // по порядку создания).
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }

    for (const id of ids) {
      const c = this.cells.get(id);
      if (!c || !c.alive) continue;
      this._cellTick(c);
    }

    // Снимаем мертвых: добавляем органику, освобождаем клетку.
    for (const id of ids) {
      const c = this.cells.get(id);
      if (c && !c.alive) {
        // Скользящее среднее времени жизни — для метрики «умности».
        // EMA с долгим окном: новое значение получает малый вес.
        this.avgLifespan = this.avgLifespan * 0.995 + c.age * 0.005;
        this._buryCell(c);
      }
    }

    // Климат и окружение.
    this._climateTick();
    this.world.envTick();

    // Подсчёт статистики.
    this._countPopulation();
  }

  // ------------------------------------------------------------------
  // Климат — динамические условия. Суровость влияет на:
  //  — контраст дня/ночи (ночь становится темнее, день короче)
  //  — постоянную прибавку к базовому метаболизму
  //  — вероятность и интенсивность штормов (выброс органики в случайный сектор)
  _climateTick() {
    const P = this.params;
    const sev = Math.max(0, Math.min(1, P.climateSeverity ?? 0));
    const cycleLen = Math.max(60, P.dayCycleLen ?? 600);
    this.climateTick++;

    // День/ночь. Синус сдвинут так, чтобы симуляция стартовала утром (level=0.5→растёт).
    const phase = (this.climateTick % cycleLen) / cycleLen;
    this.dayPhase = phase;
    const sun = 0.5 + 0.5 * Math.sin((phase - 0.25) * 2 * Math.PI);   // 0..1
    // Суровость обостряет ночь. min в мягком мире — 0.35, в жёстком — 0.05.
    const minLight = 0.35 - sev * 0.30;
    this.lightMul = minLight + (1 - minLight) * Math.pow(sun, 1 + sev * 1.5);
    this.metabMul = 1 + sev * 0.6;

    // Шторма.
    if (this.storm) {
      this._applyStorm(this.storm);
      this.storm.ticksLeft--;
      if (this.storm.ticksLeft <= 0) this.storm = null;
    } else if (sev > 0 && Math.random() < sev * 0.0025) {
      const N = this.world.sectorsPerSide;
      const dur = 60 + Math.floor(sev * 240);
      this.storm = {
        sx: Math.floor(Math.random() * N),
        sy: Math.floor(Math.random() * N),
        ticksLeft: dur,
        totalDuration: dur,
        intensity: 0.4 + sev * 0.6,
      };
    }
  }

  // В активном секторе ливень: органика летит вниз, ядовитость возрастает.
  _applyStorm(s) {
    const W = this.world;
    const S = W.sectorSize;
    const x0 = s.sx * S, y0 = s.sy * S;
    const x1 = Math.min(W.w, x0 + S);
    const y1 = Math.min(W.h, y0 + S);
    const add = s.intensity * 0.45;
    for (let y = y0; y < y1; y++) {
      const row = y * W.w;
      for (let x = x0; x < x1; x++) {
        W.organic[row + x] += add;
      }
    }
  }

  _countPopulation() {
    const p = [0, 0, 0, 0];
    let maxGen = 0;
    for (const c of this.cells.values()) {
      p[c.type]++;
      if (c.generation > maxGen) maxGen = c.generation;
    }
    this.populationStats = p;
    this.maxGeneration = maxGen;
  }

  // ------------------------------------------------------------------
  // Логика одной клетки за тик.
  _cellTick(cell) {
    const W = this.world;
    const P = this.params;
    const idx = W.idx(cell.x, cell.y);

    // 1. Метаболизм — обязательная трата энергии (суровый климат увеличивает расход).
    cell.energy -= P.baseMetabolism * cell.genome.metabolism * this.metabMul;

    // 2. Токсичность — урон от избытка органики.
    const tox = W.toxicityAt(idx);
    if (tox > 0) {
      cell.energy -= tox * P.toxicDamage * (1 - cell.genome.toxicResistance);
    }

    if (cell.energy <= 0) {
      cell.alive = false;
      this.deathsThisTick++;
      return;
    }

    // 3. Прямой проход «мозга» — это и есть ИИ клетки. Решения, которые он
    // принимает (направление, размножаться-сейчас, атаковать), фильтруются
    // отбором: удачные веса → больше потомков → распространение по популяции.
    const out = this._thinkCell(cell, idx, tox);

    // 4. Питание зависит от типа клетки.
    switch (cell.type) {
      case CELL_TYPES.LEAF:     this._feedLeaf(cell, idx);            break;
      case CELL_TYPES.ROOT:     this._feedRoot(cell, idx);            break;
      case CELL_TYPES.ANTENNA:  this._feedAntenna(cell, idx);         break;
      case CELL_TYPES.PREDATOR: this._feedPredator(cell, idx, out);   break;
    }

    // Энергия ограничена сверху.
    if (cell.energy > P.maxEnergy) cell.energy = P.maxEnergy;

    // 5. Старение.
    cell.age++;
    if (cell.age >= cell.genome.maxAge) {
      cell.alive = false;
      this.deathsThisTick++;
      return;
    }

    // 6. Размножение — нужен и порог энергии, и желание мозга.
    const reproProb = sigmoid(out[OUT_REPRODUCE]);
    const threshold = Math.max(P.reproduceMin, cell.genome.reproduceThreshold);
    if (cell.energy >= threshold && Math.random() < reproProb) {
      this._tryReproduce(cell, out);
    }
  }

  // ------------------------------------------------------------------
  // Сбор входов мозга и прямой проход. Возвращает буфер выходов
  // (тот же `this._outputBuf` — переиспользуется, поэтому копировать нельзя).
  _thinkCell(cell, idx, tox) {
    const W = this.world;
    const P = this.params;
    const inp = this._inputBuf;

    // Считаем долю «своих» и «чужих» среди 8 соседей.
    let kin = 0, alien = 0, alienWeakest = 1;
    for (let n = 0; n < NEIGHBORS_8.length; n++) {
      const [dx, dy] = NEIGHBORS_8[n];
      const ni = W.idx(cell.x + dx, cell.y + dy);
      const oid = W.cellGrid[ni];
      if (oid === 0 || oid === cell.id) continue;
      const other = this.cells.get(oid);
      if (!other || !other.alive) continue;
      if (this._isKin(cell, other)) kin++;
      else {
        alien++;
        const e = other.energy / P.maxEnergy;
        if (e < alienWeakest) alienWeakest = e;
      }
    }
    if (alien === 0) alienWeakest = 0; // нет чужих → не релевантно

    inp[0]  = cell.energy / P.maxEnergy;
    inp[1]  = Math.min(1, cell.age / cell.genome.maxAge);
    inp[2]  = W.light[idx] * this.lightMul;
    inp[3]  = W.charge[idx];
    inp[4]  = Math.min(1, W.organic[idx] / P.toxicThreshold);
    inp[5]  = tox;                                // 0..1
    inp[6]  = kin / 8;
    inp[7]  = alien / 8;
    inp[8]  = alienWeakest;                       // 0..1
    inp[9]  = cell.genome.toxicResistance;
    inp[10] = cell.type / 3;                      // нормализованный тип
    inp[11] = 1.0;                                // bias

    forward(cell.genome.brain, inp, this._hiddenBuf, this._outputBuf);
    return this._outputBuf;
  }

  // ------------------------------------------------------------------
  // Питание разных типов.

  _feedLeaf(cell, idx) {
    // Лист зависит от света. Ночью (lightMul→0) фотосинтез практически останавливается.
    cell.energy += this.world.light[idx] * this.params.leafGain * this.lightMul;
  }

  _feedRoot(cell, idx) {
    const intake = Math.min(this.world.organic[idx], this.params.rootIntake);
    this.world.organic[idx] -= intake;
    cell.energy += intake * this.params.rootGain;
  }

  _feedAntenna(cell, idx) {
    cell.energy += this.world.charge[idx] * this.params.antennaGain;
  }

  _feedPredator(cell, idx, brainOut) {
    // Перебираем соседей и атакуем самую слабую жертву.
    const W = this.world;
    let target = null;
    let weakest = Infinity;
    for (const [dx, dy] of NEIGHBORS_8) {
      const ni = W.idx(cell.x + dx, cell.y + dy);
      const oid = W.cellGrid[ni];
      if (oid === 0 || oid === cell.id) continue;
      const other = this.cells.get(oid);
      if (!other || !other.alive) continue;
      // Не нападаем на свой "клан" — клетки с очень похожим геномом.
      if (this._isKin(cell, other)) continue;
      if (other.energy < weakest) {
        weakest = other.energy;
        target = other;
      }
    }

    // Желание атаковать — комбинация выхода мозга и врождённой агрессивности.
    // Так селекция может «отключить» атаку у клеток, которые мутировали в хищника,
    // но окружены союзниками.
    const attackProb = sigmoid(brainOut[OUT_ATTACK]) * (0.4 + 0.6 * cell.genome.aggression);

    if (target && Math.random() < attackProb) {
      const bite = Math.min(15, target.energy);
      target.energy -= bite;
      cell.energy += bite * this.params.predationGain - this.params.predationCost;
      if (target.energy <= 0) {
        target.alive = false;
        this.deathsThisTick++;
      }
    } else {
      // Иначе тратит на «холостой» поиск.
      cell.energy -= this.params.predationCost * 0.4;
    }
  }

  _isKin(a, b) {
    // Простая мера сходства: совпадение типа + близкий colorHue.
    if (a.type !== b.type) return false;
    return Math.abs(a.genome.colorHue - b.genome.colorHue) < 0.05;
  }

  // ------------------------------------------------------------------
  // Размножение: ищем свободного соседа. Направление выбирается комбинацией
  // распределения от мозга (softmax по 4 направлениям) и генетического
  // dirPreference. Это даёт «инстинкт» (гены) + «обучаемое поведение» (мозг).

  _tryReproduce(parent, brainOut) {
    // Применяем softmax к направлениям внутри буфера мозга.
    softmaxDir(brainOut);
    const g = parent.genome.dirPreference;
    // Смешиваем 70% мозг + 30% врождённый ген, потом считаем порядок по убыванию.
    const w0 = brainOut[OUT_DIR_UP]    * 0.7 + g[0] * 0.3 + Math.random() * 0.05;
    const w1 = brainOut[OUT_DIR_RIGHT] * 0.7 + g[1] * 0.3 + Math.random() * 0.05;
    const w2 = brainOut[OUT_DIR_DOWN]  * 0.7 + g[2] * 0.3 + Math.random() * 0.05;
    const w3 = brainOut[OUT_DIR_LEFT]  * 0.7 + g[3] * 0.3 + Math.random() * 0.05;
    const order = this._sampleDirOrder([w0, w1, w2, w3]);
    const W = this.world;
    for (const dirIdx of order) {
      const [dx, dy] = NEIGHBORS_4[dirIdx];
      const nx = ((parent.x + dx) % W.w + W.w) % W.w;
      const ny = ((parent.y + dy) % W.h + W.h) % W.h;
      const ni = W.idx(nx, ny);
      if (W.cellGrid[ni] !== 0) continue;

      // Свободная клетка — рожаем.
      const strength = this.params.mutationStrength;
      const childGenome = mutate(parent.genome, strength);
      const share = childGenome.childEnergyShare;
      const childEnergy = parent.energy * share;
      parent.energy *= 1 - share;

      const child = new Cell(nx, ny, childGenome, childEnergy, parent.generation + 1);
      this.cells.set(child.id, child);
      this.world.cellGrid[ni] = child.id;
      parent.children++;
      this.birthsThisTick++;
      return;
    }
  }

  // Возвращает массив индексов [0..3] в порядке убывания веса.
  _sampleDirOrder(dirs) {
    const order = [0, 1, 2, 3].map(i => ({ i, w: dirs[i] }));
    order.sort((a, b) => b.w - a.w);
    return order.map(o => o.i);
  }

  // ------------------------------------------------------------------
  // Удалить умершую клетку, оставив органику.

  _buryCell(cell) {
    const i = this.world.idx(cell.x, cell.y);
    if (this.world.cellGrid[i] === cell.id) {
      this.world.cellGrid[i] = 0;
    }
    this.world.organic[i] += this.params.deathOrganic;
    this.cells.delete(cell.id);
  }

  // ------------------------------------------------------------------
  // Информация о клетке по экранным координатам мира (для UI).
  cellAt(x, y) {
    const W = this.world;
    if (x < 0 || y < 0 || x >= W.w || y >= W.h) return null;
    const id = W.cellGrid[y * W.w + x];
    if (id === 0) return null;
    return this.cells.get(id) || null;
  }
}
