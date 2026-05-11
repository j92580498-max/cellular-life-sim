// Cell — отдельный организм. Не "Agent": в этой симуляции каждая клетка
// самостоятельна, она же одновременно является агентом, принимающим решения.
// Если позже захочется ввести многоклеточные организмы, эта структура легко
// расширяется полем `organismId`, объединяющим несколько Cell в Agent/Organism.

import { CELL_TYPES, CELL_TYPE_COLORS } from './constants.js';
import { genomeColor } from './genome.js';

let nextId = 1;
export function resetCellIds() { nextId = 1; }

export class Cell {
  constructor(x, y, genome, energy, generation = 0) {
    this.id = nextId++;
    this.x = x;
    this.y = y;
    this.genome = genome;
    this.energy = energy;
    this.age = 0;
    this.alive = true;
    // Глубина рода: parent.generation + 1. У стартовых клеток = 0.
    this.generation = generation;
    // Сколько детей произвела клетка — мера «успеха».
    this.children = 0;
    // Динамический цвет, кэшируем чтобы не пересчитывать на каждый кадр.
    const base = CELL_TYPE_COLORS[genome.cellType] ?? CELL_TYPE_COLORS[0];
    this._color = genomeColor(genome, base);
    // «Клан» = id поселения: соседи с одинаковым кланом образуют одно поселение.
    // Тип клетки + квантованный colorHue (8 бинов) даёт до 32 различимых кланов.
    const CLAN_BINS = 8;
    this.clan = genome.cellType * CLAN_BINS + Math.min(CLAN_BINS - 1, Math.floor(genome.colorHue * CLAN_BINS));
  }

  get type() { return this.genome.cellType; }
  get color() { return this._color; }

  // Принять урон. Возвращает true, если клетка умерла.
  damage(amount) {
    this.energy -= amount;
    if (this.energy <= 0) {
      this.alive = false;
      return true;
    }
    return false;
  }
}
