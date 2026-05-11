// Brain — крошечная двухслойная нейросеть, встроенная в геном.
// Каждый организм имеет свой "мозг", веса которого мутируют при размножении.
// Это даёт нейроэволюцию: естественный отбор фильтрует более удачные веса,
// и через сотни поколений поведение становится осмысленным.

// Архитектура:
//   inputs (12) → hidden (6, tanh) → outputs (6)
// Веса хранятся в Float32Array для скорости.

export const BRAIN_IN  = 12;
export const BRAIN_HID = 6;
export const BRAIN_OUT = 6;

// Размеры весовых матриц.
const W1_SIZE = BRAIN_IN * BRAIN_HID;
const B1_SIZE = BRAIN_HID;
const W2_SIZE = BRAIN_HID * BRAIN_OUT;
const B2_SIZE = BRAIN_OUT;
export const BRAIN_PARAMS = W1_SIZE + B1_SIZE + W2_SIZE + B2_SIZE;

// Семантика выходов мозга (для удобства чтения).
export const OUT_DIR_UP    = 0;
export const OUT_DIR_RIGHT = 1;
export const OUT_DIR_DOWN  = 2;
export const OUT_DIR_LEFT  = 3;
export const OUT_REPRODUCE = 4;
export const OUT_ATTACK    = 5;

// Создаёт случайный мозг — небольшая гауссова инициализация.
export function randomBrain(rng = Math.random) {
  const w = new Float32Array(BRAIN_PARAMS);
  for (let i = 0; i < w.length; i++) {
    // Box-Muller для приблизительно нормального шума.
    const u1 = Math.max(1e-9, rng());
    const u2 = rng();
    const n = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    w[i] = n * 0.5;
  }
  return w;
}

// Копия мозга.
export function copyBrain(w) {
  return new Float32Array(w);
}

// Мутация мозга: с вероятностью `rate` каждый вес немного сдвигается.
// Дополнительно с малой вероятностью один вес целиком переинициализируется.
export function mutateBrain(w, rate, rng = Math.random) {
  const out = new Float32Array(w);
  for (let i = 0; i < out.length; i++) {
    if (rng() < rate) {
      // Мягкий сдвиг — гауссовский шум.
      const u1 = Math.max(1e-9, rng());
      const u2 = rng();
      const n = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      out[i] += n * 0.25;
      // Ограничиваем веса — это стабилизирует обучение.
      if (out[i] > 3) out[i] = 3;
      else if (out[i] < -3) out[i] = -3;
    }
  }
  // Редко — крупная мутация (перерождение веса).
  if (rng() < rate * 0.05) {
    const idx = Math.floor(rng() * out.length);
    out[idx] = (rng() - 0.5) * 2;
  }
  return out;
}

// Прямой проход. inputs — Float32Array длиной BRAIN_IN, output — Float32Array длиной BRAIN_OUT.
// Чтобы не аллоцировать массивы каждый тик, передаём workspace буферы извне.
export function forward(weights, inputs, hidden, outputs) {
  // hidden = tanh(W1 · inputs + b1)
  let off = 0;
  for (let h = 0; h < BRAIN_HID; h++) {
    let s = weights[W1_SIZE + h]; // bias1
    const base = h * BRAIN_IN;
    for (let i = 0; i < BRAIN_IN; i++) {
      s += weights[base + i] * inputs[i];
    }
    // tanh
    hidden[h] = Math.tanh(s);
  }
  // outputs = W2 · hidden + b2  (логиты; активацию применяет вызывающая сторона)
  const w2Off = W1_SIZE + B1_SIZE;
  const b2Off = w2Off + W2_SIZE;
  for (let o = 0; o < BRAIN_OUT; o++) {
    let s = weights[b2Off + o];
    const base = w2Off + o * BRAIN_HID;
    for (let h = 0; h < BRAIN_HID; h++) {
      s += weights[base + h] * hidden[h];
    }
    outputs[o] = s;
  }
}

// Softmax для первых 4 выходов (направления).
// Записывает результат на месте; возвращает суммарную энтропию (для отладки).
export function softmaxDir(outputs) {
  let max = outputs[0];
  for (let i = 1; i < 4; i++) if (outputs[i] > max) max = outputs[i];
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    outputs[i] = Math.exp(outputs[i] - max);
    sum += outputs[i];
  }
  if (sum < 1e-9) sum = 1e-9;
  for (let i = 0; i < 4; i++) outputs[i] /= sum;
}

// Sigmoid для одного значения.
export function sigmoid(x) {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}
