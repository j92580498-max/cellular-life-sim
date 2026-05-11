# cellular-life-sim

Cellular automaton life simulation with **neuroevolution**. Each organism carries a tiny neural network in its genome; the weights mutate at reproduction and natural selection makes successive generations smarter.

Live demo: https://cellular-automata-app-frm16jho.devinapps.com (may sleep — re-deploy locally for a permanent copy).

## Run locally

No build step, no dependencies. Just serve the directory:

```sh
python3 -m http.server 8765
# open http://localhost:8765
```

Or open `index.html` directly via `file://` in a browser that allows ES modules from local files.

## What's inside

- **World** — toroidal 2D grid, divided into sectors. Per-tile maps: `light` (gradient top→bottom), `charge` (sinusoidal band), `organic` (dead-cell residue, decays each tick).
- **Genome** — 9 numeric genes (cell type, reproduce threshold, metabolism, aggression, toxic resistance, mutation rate, direction preference, color allele) + a `Float32Array` of neural-network weights ("brain").
- **Brain** — `12 → 6 (tanh) → 6` micro-network. ~102 parameters per cell, stored as `Float32Array`. Inputs include energy, age, light, charge, organic, toxicity, kin/alien neighbour ratios, weakest alien's energy, toxic resistance, cell type, bias. Outputs: 4 directional logits (softmax for reproduction direction), reproduce-now sigmoid, attack sigmoid.
- **Mutation** — at birth, weights get Gaussian noise (σ=0.25, clamped to [−3, 3]); rarely one weight is fully re-initialised. Traditional genes mutate the same way.
- **Cell** — id, position, genome, energy, age, **generation** (depth of lineage = `parent.generation + 1`), children counter.
- **Simulation** — per-tick: metabolism cost → toxin damage → brain forward pass → feeding (by cell type) → ageing → reproduction (brain & gene-driven direction selection).
- **Renderer** — draws into a world-sized `ImageData` and scales it via one `drawImage` with nearest-neighbour. 5000+ cells at 60 FPS.
- **Input** — Pointer Events: mouse and touch, pinch-zoom around the touch point, mobile-friendly.

## Controls

- Tap a cell → its genome appears bottom-left (including generation, children count, brain norm).
- ⏸ / ⏭ / ⟲ — pause, step, reset.
- Speed slider — simulation ticks per frame (1–50).
- View modes — cells / organic heatmap / light / toxin / energy.
- ☰ menu — world size, starting population, mutation strength, organic decay rate, toxicity threshold, sector overlay, grid overlay.

## HUD metrics

- **Поколение** — max lineage depth across living cells (real generation counter, not age).
- **Жизнь ср.** — exponential moving average of age-at-death. Rises as selection finds better brains.
- **Клеток** — current population.
- **Population bars** (top-right) — live counts of each of the 4 cell types.

## File layout

```
js/
  main.js        — entry point, requestAnimationFrame loop
  constants.js   — params, cell types, neighbour offsets
  brain.js       — neural network (forward, randomBrain, copyBrain, mutateBrain, softmaxDir, sigmoid)
  genome.js      — gene schema, randomGenome, copyGenome, mutate, genomeColor
  cell.js        — Cell class
  world.js       — World class (grid, light/charge/organic maps, sector boundaries, env tick)
  sim.js         — Simulation class (per-tick logic, _thinkCell, _feedXxx, _tryReproduce)
  renderer.js    — Canvas renderer with 5 view modes
  input.js       — Pointer Events controller (pan, pinch-zoom, tap)
  ui.js          — DOM bindings, HUD updates, cell-info panel
css/style.css    — dark-themed mobile-friendly UI
index.html       — single-page shell
```

## Notes on the AI

This is **neuroevolution** — there's no gradient descent. Better behaviour emerges purely through selection of mutated weight vectors. Expect interesting behaviour to develop after a few hundred generations: less suicidal predation, smarter direction choice toward light/organic depending on cell type, more disciplined reproduction thresholds.

The brain output for direction is blended 70% brain + 30% genetic direction preference, so both learned and instinctive behaviour coexist. Predators only attack when both the brain output and the inherited aggression gene agree.

## License

MIT — see [LICENSE](./LICENSE).
