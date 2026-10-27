// Génère la grille d'une partie dans un thread séparé, permanent, qui traite les demandes une à une.
import { Worker } from 'node:worker_threads';
import { loadBank } from './bank.js';

const TIMEOUT_MS = 15000;

let worker = null;
let nextId = 1;
const pending = new Map(); // id -> { resolve, reject, timer }

function failAll(err) {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(err);
  }
  pending.clear();
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url));
  worker.unref(); // n'empêche pas le process de s'arrêter
  worker.on('message', ({ id, grid, error }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    if (error) p.reject(new Error(error));
    else p.resolve(grid);
  });
  worker.on('error', (err) => { worker = null; failAll(err); });
  worker.on('exit', () => { worker = null; failAll(new Error('Thread de génération arrêté')); });
  return worker;
}

export async function generateGameGrid(weights, { attempts = 30, bank } = {}) {
  bank ??= await loadBank();
  const w = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    // Bloqué au-delà du délai : on tue le thread, il sera recréé à la prochaine demande.
    const timer = setTimeout(() => w.terminate(), TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, bank, weights, attempts });
  });
}

export function stopGridWorker() {
  return worker?.terminate();
}
