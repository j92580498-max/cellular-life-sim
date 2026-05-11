// Геном клетки — набор числовых параметров, определяющих поведение.
// Это явный, читаемый "вектор генов": каждый ген клампится в свой диапазон.
// Плюс нейросеть-«мозг» с весами, которые также мутируют при размножении —
// именно она делает поколения "умнее" через нейроэволюцию.

import { CELL_TYPES } from './constants.js';
import { randomBrain, copyBrain, mutateBrain } from './brain.js';

// Описание генов: [min, max] и тип ('float' | 'int' | 'pref').
// 'pref' — это 4-мерный вектор предпочтений (по сторонам света / по типу пищи).
export const GENE_SCHEMA = {
  // Базовый тип клетки (фенотип). Меняется при мутации с малой вероятностью.
  cellType:           { type: 'int',  min: 0,    max: 3,    default: 0 },

  // Порог энергии, при котором клетка начинает размножаться.
  reproduceThreshold: { type: 'float', min: 30,  max: 180,  default: 90 },

  // Какая доля энергии передаётся ребёнку.
  childEnergyShare:   { type: 'float', min: 0.2, max: 0.7,  default: 0.45 },

  // Максимальный возраст (до того как клетка умрёт от старости).
  maxAge:             { type: 'int',  min: 30,  max: 600,  default: 200 },

  // Базовый метаболизм — сколько энергии теряет за тик.
  metabolism:         { type: 'float', min: 0.1, max: 1.5,  default: 0.5 },

  // Толерантность к токсинам (чем больше — тем меньше урона).
  toxicResistance:    { type: 'float', min: 0,   max: 1,    default: 0.3 },

  // Агрессивность — вероятность хищника атаковать.
  aggression:         { type: 'float', min: 0,   max: 1,    default: 0.5 },

  // Сила мутации потомка (мета-ген: эволюционирует тоже).
  mutationRate:       { type: 'float', min: 0.01,max: 0.6,  default: 0.15 },

  // Предпочтения по сторонам света при размножении [up, right, down, left].
  dirPreference:      { type: 'pref', size: 4 },

  // Аллель цвета — на сам цвет не влияет, но позволяет отслеживать клады.
  colorHue:           { type: 'float', min: 0,   max: 1,    default: 0.3 },
};

// Возвращает «случайный геном» — для стартовых клеток.
export function randomGenome(rng = Math.random) {
  const g = {};
  for (const [name, spec] of Object.entries(GENE_SCHEMA)) {
    if (spec.type === 'pref') {
      g[name] = new Float32Array(spec.size);
      for (let i = 0; i < spec.size; i++) g[name][i] = rng();
      normalizePref(g[name]);
    } else if (spec.type === 'int') {
      g[name] = Math.floor(rng() * (spec.max - spec.min + 1)) + spec.min;
    } else {
      g[name] = spec.min + rng() * (spec.max - spec.min);
    }
  }
  g.brain = randomBrain(rng);
  return g;
}

// Глубокая копия генома.
export function copyGenome(g) {
  const out = {};
  for (const [name, spec] of Object.entries(GENE_SCHEMA)) {
    if (spec.type === 'pref') {
      out[name] = new Float32Array(g[name]);
    } else {
      out[name] = g[name];
    }
  }
  out.brain = copyBrain(g.brain);
  return out;
}

// Мутация: создаёт копию генома и случайно изменяет один-два гена.
// strengthOverride позволяет внешним настройкам усиливать/ослаблять мутации.
export function mutate(parent, strengthOverride = null, rng = Math.random) {
  const child = copyGenome(parent);
  const strength = strengthOverride ?? child.mutationRate;

  // 0) Мозг мутирует «по-нейроэволюционному»: с малой вероятностью каждый вес сдвигается.
  // Это то, что делает поколения умнее — отбор сохраняет полезные перенастройки.
  child.brain = mutateBrain(child.brain, Math.min(0.25, strength * 0.6), rng);

  // 1) Выбираем случайный ген.
  const keys = Object.keys(GENE_SCHEMA);
  const key = keys[Math.floor(rng() * keys.length)];
  const spec = GENE_SCHEMA[key];

  if (spec.type === 'pref') {
    // Сдвигаем все компоненты, потом нормируем.
    for (let i = 0; i < spec.size; i++) {
      child[key][i] = Math.max(0, child[key][i] + (rng() - 0.5) * strength * 2);
    }
    normalizePref(child[key]);
  } else if (spec.type === 'int') {
    if (key === 'cellType') {
      // Тип клетки меняется реже (это сильное изменение фенотипа).
      if (rng() < strength * 0.5) {
        child.cellType = Math.floor(rng() * 4);
      }
    } else {
      const range = spec.max - spec.min;
      const delta = Math.round((rng() - 0.5) * strength * range * 2);
      child[key] = clampInt(child[key] + delta, spec.min, spec.max);
    }
  } else {
    const range = spec.max - spec.min;
    const delta = (rng() - 0.5) * strength * range;
    child[key] = clamp(child[key] + delta, spec.min, spec.max);
  }

  // 2) С небольшой вероятностью мутируем ещё один ген (двойная мутация).
  if (rng() < strength * 0.3) {
    return mutate(child, strength * 0.7, rng);
  }
  return child;
}

// Утилитарные функции.
function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }
function clampInt(v, mn, mx) { return Math.max(mn, Math.min(mx, v | 0)); }

function normalizePref(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  if (s <= 1e-6) {
    arr.fill(1 / arr.length);
    return;
  }
  for (let i = 0; i < arr.length; i++) arr[i] /= s;
}

// Цвет клетки на основе генома: смешиваем базовый цвет типа с оттенком из colorHue.
// Так можно визуально различать клады.
export function genomeColor(g, baseColor) {
  // Сдвиг на основе нескольких ключевых генов — создаёт "семейные" окраски.
  const h = g.colorHue;
  const tweak = (g.aggression - 0.5) * 0.3;
  return [
    clamp(baseColor[0] * (0.7 + h * 0.6) + tweak, 0, 1),
    clamp(baseColor[1] * (0.7 + (1 - h) * 0.6), 0, 1),
    clamp(baseColor[2] * (0.7 + ((h + 0.5) % 1) * 0.6), 0, 1),
  ];
}
