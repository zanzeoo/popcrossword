// Règles d'une partie : port de la logique du prototype (claimWord, penalize, dernière chance…),
// sans interface. Les fonctions modifient l'état de la partie et renvoient de quoi informer les joueurs.
// L'état reste sérialisable en JSON (sauvegarde Redis).

export const PTS_LETTER = 10, HARD_MULT = 2, BONUS_VIERGE = 20, PRIME_TWIN = 20, BONUS_MYST = 100, MYST_THRESHOLD = 80;

export const wordBase = (w) => w.ans.length * PTS_LETTER * (w.hard ? HARD_MULT : 1);

export function newGame(grid, players, settings, now = Date.now()) {
  const stats = {};
  for (const p of players) {
    stats[p.id] = {
      score: settings.startScore, start: settings.startScore, pen: 0, penN: 0,
      words: 0, wordPts: 0, vierge: 0, twins: 0, combos: 0, comboPts: 0,
      mystery: 0, mAttempt: false, mOk: false, mGuess: '',
    };
  }
  const letters = [];
  grid.cells.forEach((x, k) => { if (x.t === 'L') letters.push(k); });
  return {
    grid,
    letters,
    fill: new Array(grid.cells.length).fill(null), // id du joueur qui a révélé la case
    found: new Array(grid.words.length).fill(null), // id du joueur crédité du mot
    how: new Array(grid.words.length).fill(null),   // 'trouvé', 'croisement' ou 'combo jumelle'
    foundAt: new Array(grid.words.length).fill(null),
    wrong: new Array(grid.words.length).fill(0),     // erreurs par mot, pour les statistiques
    stats,
    final: null,                                     // { by, endsAt, pending: [ids] }
    startedAt: now,
    endedAt: null,
    reason: '',
  };
}

function twinOf(game, k) {
  const i = game.grid.twins.findIndex((p) => p.includes(k));
  if (i < 0) return null;
  const [a, b] = game.grid.twins[i];
  return { pair: i, partner: a === k ? b : a };
}

export function fillPct(game) {
  const filled = game.letters.filter((k) => game.fill[k] != null).length;
  return Math.round((filled / game.letters.length) * 100);
}

export const isComplete = (game) => game.letters.every((k) => game.fill[k] != null);

export function penalize(game, pid, n) {
  const st = game.stats[pid];
  const lost = Math.min(n, st.score); // le score ne descend pas sous zéro
  st.score -= lost; st.pen += lost; st.penN++;
  return lost;
}

// Le joueur pid valide le mot wi. Renvoie le détail de ce qui a été révélé et rapporté.
export function claimWord(game, wi, pid, now = Date.now()) {
  const { grid, fill, found, how, stats } = game;
  const w = grid.words[wi];
  const st = stats[pid];
  const pre = w.cells.filter((k) => fill[k] != null).length;
  const base = wordBase(w), vierge = pre === 0;
  found[wi] = pid; how[wi] = 'trouvé'; game.foundAt[wi] = now;
  st.words++; st.wordPts += base; st.score += base;
  if (vierge) { st.vierge += BONUS_VIERGE; st.score += BONUS_VIERGE; }

  const newly = [];
  w.cells.forEach((k) => { if (fill[k] == null) { fill[k] = pid; newly.push(k); } });
  const twins = [];
  newly.forEach((k) => {
    const t = twinOf(game, k);
    if (t && fill[t.partner] == null) {
      fill[t.partner] = pid;
      twins.push({ cell: t.partner, pair: t.pair, pts: PRIME_TWIN });
      st.twins += PRIME_TWIN; st.score += PRIME_TWIN;
    }
  });
  const twinCells = twins.map((t) => t.cell);
  const combos = [];
  grid.words.forEach((w2, j) => {
    if (found[j] == null && w2.cells.every((k) => fill[k] != null)) {
      const viaTwin = w2.cells.some((k) => twinCells.includes(k));
      found[j] = pid; how[j] = viaTwin ? 'combo jumelle' : 'croisement'; game.foundAt[j] = now;
      const b = wordBase(w2);
      st.combos++; st.comboPts += b; st.score += b;
      combos.push({ word: j, how: how[j], pts: b });
    }
  });

  const revealed = {};
  newly.concat(twinCells).forEach((k) => { revealed[k] = grid.cells[k].ch; });
  return { word: wi, by: pid, base, vierge: vierge ? BONUS_VIERGE : 0, twins, combos, revealed };
}

// Le joueur pid propose le mot mystère (longueur déjà vérifiée).
export function proposeMystery(game, pid, guess, penMyst) {
  const st = game.stats[pid];
  st.mAttempt = true; st.mGuess = guess;
  if (guess === game.grid.myst.ans) {
    st.mOk = true; st.mystery = BONUS_MYST; st.score += BONUS_MYST;
    return { ok: true, pts: BONUS_MYST };
  }
  const lost = penalize(game, pid, penMyst);
  st.mLost = lost;
  return { ok: false, pts: -lost };
}

export const locked = (game, pid) => !!(game.final && !game.final.pending.includes(pid));

export function canProposeMystery(game, pid) {
  return !!(game.grid.myst && !locked(game, pid) && !game.stats[pid].mAttempt && fillPct(game) >= MYST_THRESHOLD);
}

// Mode dernière chance : chacun des autres joueurs a droit à un essai avant endsAt.
export function startFinal(game, by, lastTimeS, playerIds, now = Date.now()) {
  game.final = { by, endsAt: now + lastTimeS * 1000, pending: playerIds.filter((id) => id !== by) };
  return game.final;
}

// Consomme l'essai de dernière chance de pid. Renvoie true si plus personne n'est attendu.
export function useFinal(game, pid) {
  if (!game.final || !game.final.pending.includes(pid)) return false;
  game.final.pending = game.final.pending.filter((id) => id !== pid);
  return game.final.pending.length === 0;
}

// Classement : à score égal, même rang (1, 1, 3…).
export function ranking(game, players) {
  const list = players
    .map((p) => ({ id: p.id, pseudo: p.pseudo, color: p.color, ...game.stats[p.id] }))
    .sort((a, b) => b.score - a.score);
  list.forEach((p, i) => { p.rank = i > 0 && p.score === list[i - 1].score ? list[i - 1].rank : i + 1; });
  return list;
}
