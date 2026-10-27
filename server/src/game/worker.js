// Thread de génération, gardé vivant entre les parties : le calcul (≈ 1 s) ne bloque pas
// les salons en cours, et le code reste optimisé par le moteur d'une génération à l'autre.
import { parentPort } from 'node:worker_threads';
import { createGrid } from './generator.js';

parentPort.on('message', ({ id, bank, weights, attempts }) => {
  try {
    parentPort.postMessage({ id, grid: createGrid(bank, weights, attempts) });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
