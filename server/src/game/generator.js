// Générateur de grilles de mots fléchés (10 colonnes × 13 rangées).
// Port à l'identique de prototypes/pc/index.html : seules changent la forme des entrées
// (définitions lues en base) et le nom du thème de remplissage (« mot_courant »).
// Une entrée de la banque : { id, ans, theme, clue, hard, diff, expl, author, user }.

export const R = 13, C = 10;
export const FILLER_THEME = 'mot_courant';
const FILLER_W = 4;

function weightedOrder(items, wfn) {
  return items
    .map(it => { const w = wfn(it); return { it, k: w > 0 ? -Math.log(Math.random()) / w : Infinity }; })
    .filter(x => x.k !== Infinity)
    .sort((a, b) => a.k - b.k)
    .map(x => x.it);
}

// Emplacements de définition dans une case :
//  r  = mot horizontal qui commence à droite de la case
//  d  = mot vertical qui commence sous la case
//  rd = flèche coudée → puis ↓ : mot vertical qui commence à droite (1re rangée)
//  dr = flèche coudée ↓ puis → : mot horizontal qui commence dessous (1re colonne)
export const SLOTS = ['r', 'd', 'rd', 'dr'];
export function clueSlots(x) {
  if (!x || x.t !== 'D') return [];
  return SLOTS.filter(s => x[s] != null).map(s => [s, x[s]]);
}

export function buildOnce(bank, weights) {
  const cells = new Array(R * C).fill(null);
  const words = [];
  const used = new Set();
  const at = (r, c) => (r < 0 || c < 0 || r >= R || c >= C) ? undefined : cells[r * C + c];
  // les définitions de la communauté sont favorisées (×3) pour qu'on les voie vite en test
  const order = weightedOrder(bank, w => (w.theme === FILLER_THEME ? FILLER_W : (weights[w.theme] || 0)) * (w.user ? 3 : 1));
  const byAns = new Map();
  for (const w of order) if (!byAns.has(w.ans)) byAns.set(w.ans, w);
  const newD = () => ({ t: 'D', r: null, d: null, rd: null, dr: null });

  function slotFree(pr, pc, slot) {
    if (pr < 0 || pc < 0 || pr >= R || pc >= C) return false;
    const d = at(pr, pc);
    if (!d) return true;
    if (d.t !== 'D' || d[slot] != null) return false;
    return clueSlots(d).length < 2; // deux définitions maximum par case
  }
  // où placer la définition d'un mot qui commence en (r, c) ? → [ligne, colonne, emplacement] ou null
  function defFor(r, c, dir) {
    if (dir === 'h') {
      if (c > 0) return slotFree(r, c - 1, 'r') ? [r, c - 1, 'r'] : null;
      return (r > 0 && slotFree(r - 1, 0, 'dr')) ? [r - 1, 0, 'dr'] : null;
    }
    if (r > 0) return slotFree(r - 1, c, 'd') ? [r - 1, c, 'd'] : null;
    return (c > 0 && slotFree(0, c - 1, 'rd')) ? [0, c - 1, 'rd'] : null;
  }
  function endOk(er, ec) {
    if (er >= R || ec >= C) return true;
    const e = at(er, ec);
    return !(e && e.t === 'L');
  }

  // Les lettres peuvent toucher des lettres voisines, à condition que chaque nouvelle suite
  // de lettres ainsi formée soit elle-même un mot de la banque (qui reçoit sa définition).
  function check(ans, r, c, dir) {
    const dr = dir === 'v' ? 1 : 0, dc = dir === 'h' ? 1 : 0, n = ans.length;
    const pdir = dir === 'h' ? 'v' : 'h', pr = dc, pc = dr;
    if (r < 0 || c < 0 || r + dr * (n - 1) >= R || c + dc * (n - 1) >= C) return null;
    const def = defFor(r, c, dir);
    if (!def) return null;
    if (!endOk(r + dr * n, c + dc * n)) return null;
    let cross = 0;
    const fresh = [], freshSet = new Set();
    for (let i = 0; i < n; i++) {
      const rr = r + dr * i, cc = c + dc * i, x = at(rr, cc);
      if (x) {
        if (x.t !== 'L' || x.ch !== ans[i]) return null;
        if (dir === 'h' ? x.h != null : x.v != null) return null;
        cross++;
      } else { fresh.push(i); freshSet.add(rr * C + cc); }
    }
    if (cross === n) return null;
    if (freshSet.has(def[0] * C + def[1])) return null;
    const extra = [], pend = new Set([ans]);
    const pendDef = new Map([[def[0] * C + def[1], [def[2]]]]); // définitions ajoutées par ce placement
    for (const i of fresh) {
      const rr = r + dr * i, cc = c + dc * i;
      let a = 0, b = 0;
      while (true) { const y = at(rr - pr * (a + 1), cc - pc * (a + 1)); if (y && y.t === 'L') a++; else break; }
      while (true) { const y = at(rr + pr * (b + 1), cc + pc * (b + 1)); if (y && y.t === 'L') b++; else break; }
      if (a === 0 && b === 0) continue;
      let str = '';
      for (let j = -a; j <= b; j++) {
        if (j === 0) { str += ans[i]; continue; }
        const y = at(rr + pr * j, cc + pc * j);
        if (pdir === 'h' ? y.h != null : y.v != null) return null;
        str += y.ch;
      }
      const ew = byAns.get(str);
      if (!ew || used.has(str) || pend.has(str)) return null;
      const sr = rr - pr * a, sc = cc - pc * a;
      const ed = defFor(sr, sc, pdir);
      if (!ed || freshSet.has(ed[0] * C + ed[1])) return null;
      const dk = ed[0] * C + ed[1], prev = pendDef.get(dk) || [];
      if (prev.includes(ed[2]) || clueSlots(at(ed[0], ed[1])).length + prev.length >= 2) return null;
      const er = sr + pr * str.length, ec = sc + pc * str.length;
      if (!endOk(er, ec) || (er < R && ec < C && freshSet.has(er * C + ec))) return null;
      pend.add(str); pendDef.set(dk, prev.concat(ed[2]));
      extra.push({ w: ew, r: sr, c: sc, dir: pdir });
    }
    if (words.length && cross === 0 && !extra.length) return null;
    return { cross, extra };
  }

  function place(w, r, c, dir) {
    const def = defFor(r, c, dir);
    if (!def) return false;
    const idx = words.length;
    const dr = dir === 'v' ? 1 : 0, dc = dir === 'h' ? 1 : 0, n = w.ans.length;
    const pk = def[0] * C + def[1];
    if (!cells[pk]) cells[pk] = newD();
    cells[pk][def[2]] = idx;
    const list = [];
    for (let i = 0; i < n; i++) {
      const k = (r + dr * i) * C + (c + dc * i);
      if (!cells[k]) cells[k] = { t: 'L', ch: w.ans[i], h: null, v: null };
      if (dir === 'h') cells[k].h = idx; else cells[k].v = idx;
      list.push(k);
    }
    const er = r + dr * n, ec = c + dc * n;
    if (er < R && ec < C && !cells[er * C + ec]) cells[er * C + ec] = newD();
    words.push({ id: w.id, ans: w.ans, theme: w.theme, clue: w.clue, hard: w.hard, diff: w.diff, expl: w.expl, author: w.author, user: !!w.user, r, c, dir, cells: list, def: pk, slot: def[2] });
    used.add(w.ans);
    return true;
  }

  // premier mot : un mot pop culture de 5 à 9 lettres
  const first = order.find(w => w.theme !== FILLER_THEME && w.ans.length >= 5 && w.ans.length <= 9);
  if (!first) return null;
  if (Math.random() < 0.5) {
    place(first, 1 + Math.floor(Math.random() * (R - 2)), 1 + Math.floor(Math.random() * (C - first.ans.length)), 'h');
  } else {
    place(first, 1 + Math.floor(Math.random() * (R - first.ans.length)), 1 + Math.floor(Math.random() * (C - 1)), 'v');
  }

  // anchors=false : le mot doit croiser une lettre existante ;
  // anchors=true  : on essaie aussi les positions qui bouchent un trou voisin d'une lettre.
  function runPass(list, anchors) {
    let progress = true;
    while (progress) {
      progress = false;
      for (const w of list) {
        if (used.has(w.ans)) continue;
        let best = [], bestS = 0;
        const tryAt = (r, c, dir) => {
          const res = check(w.ans, r, c, dir);
          if (!res) return;
          const sc = res.cross * 2 + res.extra.length * 3 + (w.theme !== FILLER_THEME ? 2 : 0) + w.ans.length * 0.5;
          if (sc > bestS) { bestS = sc; best = [[r, c, dir, res.extra]]; }
          else if (sc === bestS) best.push([r, c, dir, res.extra]);
        };
        for (let k = 0; k < R * C; k++) {
          const x = cells[k];
          const r0 = Math.floor(k / C), c0 = k % C;
          if (x && x.t === 'L') {
            for (let i = 0; i < w.ans.length; i++) {
              if (w.ans[i] !== x.ch) continue;
              if (x.h == null) tryAt(r0, c0 - i, 'h');
              if (x.v == null) tryAt(r0 - i, c0, 'v');
            }
          } else if (anchors && !x) {
            const nb = [at(r0 - 1, c0), at(r0 + 1, c0), at(r0, c0 - 1), at(r0, c0 + 1)];
            if (!nb.some(y => y && y.t === 'L')) continue;
            for (let i = 0; i < w.ans.length; i++) { tryAt(r0, c0 - i, 'h'); tryAt(r0 - i, c0, 'v'); }
          }
        }
        if (best.length) {
          const [r, c, dir, extra] = best[Math.floor(Math.random() * best.length)];
          place(w, r, c, dir);
          extra.forEach(e => place(e.w, e.r, e.c, e.dir));
          progress = true;
        }
      }
    }
  }
  runPass(order.filter(w => w.theme !== FILLER_THEME), false);  // 1. la pop culture d'abord
  runPass(order, false);                                     // 2. tout, en croisement
  runPass(order, true);                                      // 3. bouche-trous

  for (let k = 0; k < R * C; k++) if (!cells[k]) cells[k] = newD();
  const letters = cells.filter(x => x.t === 'L').length;
  const fillers = cells.filter(x => x.t === 'D' && !clueSlots(x).length).length;
  const pop = words.filter(w => w.theme !== FILLER_THEME).length;
  return { cells, words, letters, score: letters * 2 - fillers * 2 + pop * 3 };
}

export function generateGrid(bank, weights, attempts) {
  let best = null;
  for (let a = 0; a < attempts; a++) {
    const g = buildOnce(bank, weights);
    if (g && (!best || g.score > best.score)) best = g;
  }
  return best;
}

export function letterCells(g) {
  const out = [];
  g.cells.forEach((x, k) => { if (x.t === 'L') out.push(k); });
  return out;
}

export function pickMystery(g, bank, weights) {
  const used = new Set(g.words.map(w => w.ans));
  const L = letterCells(g);
  const cand = weightedOrder(
    bank.filter(w => w.theme !== FILLER_THEME && !used.has(w.ans) && w.ans.length >= 5 && w.ans.length <= 9),
    w => weights[w.theme] || 0
  );
  for (const m of cand) {
    const taken = new Set(), pos = [];
    let ok = true;
    for (const ch of m.ans) {
      const opts = L.filter(k => g.cells[k].ch === ch && !taken.has(k));
      if (!opts.length) { ok = false; break; }
      const k = opts[Math.floor(Math.random() * opts.length)];
      taken.add(k); pos.push(k);
    }
    if (ok) return { ans: m.ans, clue: m.clue, theme: m.theme, cells: pos };
  }
  return null;
}

export function pickTwins(g, myst) {
  const blocked = new Set(myst ? myst.cells : []);
  const L = letterCells(g).filter(k => !blocked.has(k));
  const wordsOf = k => [g.cells[k].h, g.cells[k].v].filter(x => x != null);
  const pairs = [], used = new Set();
  for (let p = 0; p < 2; p++) {
    for (let t = 0; t < 400; t++) {
      const a = L[Math.floor(Math.random() * L.length)], b = L[Math.floor(Math.random() * L.length)];
      if (a === b || used.has(a) || used.has(b)) continue;
      const wa = wordsOf(a), wb = wordsOf(b);
      if (wa.some(x => wb.includes(x))) continue;
      const dist = Math.abs(Math.floor(a / C) - Math.floor(b / C)) + Math.abs(a % C - b % C);
      if (dist < 4) continue;
      pairs.push([a, b]); used.add(a); used.add(b);
      break;
    }
  }
  return pairs; // paire 0 = jaune, paire 1 = noire
}

// Grille complète d'une partie, comme startGame() du prototype : jusqu'à 4 grilles pour trouver
// un mot mystère, puis les cases jumelles. Contient les solutions : ne jamais l'envoyer telle quelle.
export function createGrid(bank, weights, attempts = 30) {
  let g = null, myst = null;
  for (let i = 0; i < 4 && !myst; i++) {
    g = generateGrid(bank, weights, attempts);
    myst = g ? pickMystery(g, bank, weights) : null;
  }
  if (!g) return null;
  const twins = pickTwins(g, myst);
  return { rows: R, cols: C, cells: g.cells, words: g.words, score: g.score, myst, twins };
}

// Ce que reçoivent les joueurs pendant la partie (message game:grid) : la structure seulement.
// Ni lettres, ni réponses, ni explications, ni mot mystère.
export function publicGrid(grid) {
  return {
    rows: grid.rows,
    cols: grid.cols,
    cells: grid.cells.map((x) => (x.t === 'L'
      ? { t: 'L', h: x.h, v: x.v }
      : { t: 'D', r: x.r, d: x.d, rd: x.rd, dr: x.dr })),
    words: grid.words.map((w) => ({
      clue: w.clue, theme: w.theme, hard: w.hard, diff: w.diff ?? null,
      len: w.ans.length, r: w.r, c: w.c, dir: w.dir, cells: w.cells, def: w.def, slot: w.slot,
    })),
    myst: grid.myst ? { len: grid.myst.ans.length, cells: grid.myst.cells } : null,
    twins: grid.twins,
  };
}
