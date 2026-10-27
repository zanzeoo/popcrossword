// Génère des grilles avec la banque en base, vérifie leur cohérence et affiche la dernière.
// Usage : npm run grid-preview [-- nombre]
import { pool } from '../src/db.js';
import { loadBank } from '../src/game/bank.js';
import { generateGameGrid, stopGridWorker } from '../src/game/grid.js';
import { publicGrid, clueSlots } from '../src/game/generator.js';

const n = Number(process.argv[2] ?? 5);
const weights = { films: 1, anim: 1, jv: 1, musique: 1, persos: 1, sagas: 1 };
const bank = await loadBank();
const known = new Set(bank.map((w) => w.ans));
await pool.end();

function check(g) {
  const errs = [];
  const { rows: R, cols: C, cells } = g;
  g.words.forEach((w, i) => {
    w.cells.forEach((k, j) => { if (cells[k].ch !== w.ans[j]) errs.push(`mot ${w.ans} : lettre ${j} incohérente`); });
    const d = cells[w.def];
    if (d.t !== 'D' || d[w.slot] !== i) errs.push(`mot ${w.ans} : case de définition incohérente`);
  });
  cells.forEach((x, k) => { if (x.t === 'D' && clueSlots(x).length > 2) errs.push(`case ${k} : plus de 2 définitions`); });
  // Toute suite d'au moins 2 lettres doit être un mot placé de la banque.
  const placed = new Set(g.words.map((w) => `${w.dir}${w.cells[0]}`));
  for (const dir of ['h', 'v']) {
    const [dr, dc] = dir === 'h' ? [0, 1] : [1, 0];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const k = r * C + c, prev = cells[(r - dr) * C + (c - dc)];
      if (cells[k].t !== 'L' || (r - dr >= 0 && c - dc >= 0 && prev.t === 'L')) continue;
      let s = '', rr = r, cc = c;
      while (rr < R && cc < C && cells[rr * C + cc].t === 'L') { s += cells[rr * C + cc].ch; rr += dr; cc += dc; }
      if (s.length >= 2 && (!placed.has(`${dir}${k}`) || !known.has(s))) errs.push(`suite ${s} (${dir}) sans définition`);
    }
  }
  if (g.myst) g.myst.cells.forEach((k, i) => { if (cells[k].ch !== g.myst.ans[i]) errs.push('mot mystère incohérent'); });
  const pub = JSON.stringify(publicGrid(g));
  if (/"(ch|ans|expl|author)"/.test(pub)) errs.push('la grille publique contient des solutions');
  return errs;
}

function draw(g) {
  const out = [];
  for (let r = 0; r < g.rows; r++) {
    out.push(g.cells.slice(r * g.cols, (r + 1) * g.cols).map((x, c) => {
      const k = r * g.cols + c;
      if (x.t !== 'L') return clueSlots(x).length ? '▪' : '·';
      if (g.myst?.cells.includes(k)) return x.ch.toLowerCase();
      return x.ch;
    }).join(' '));
  }
  return out.join('\n');
}

let last, ko = 0;
const times = [];
for (let i = 0; i < n; i++) {
  const t0 = performance.now();
  const g = await generateGameGrid(weights, { bank });
  times.push(performance.now() - t0);
  const errs = g ? check(g) : ['aucune grille'];
  if (errs.length) { ko++; console.log(`Grille ${i + 1} :`, errs.slice(0, 5)); }
  last = g;
}
const words = last.words.length, pop = last.words.filter((w) => w.theme !== 'mot_courant').length;
console.log(`${n} grilles, ${ko} en erreur. Temps : min ${Math.min(...times).toFixed(0)} ms, max ${Math.max(...times).toFixed(0)} ms.`);
console.log(`Dernière grille : ${words} mots dont ${pop} pop culture, mot mystère ${last.myst?.ans ?? 'aucun'} (en minuscules), ${last.twins.length} paires de jumelles.`);
console.log(draw(last));
await stopGridWorker();
