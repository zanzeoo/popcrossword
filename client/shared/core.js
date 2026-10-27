// Cœur commun aux clients PC et mobile : connexion au serveur, accueil, salon, état de la partie,
// saisie et validation. Chaque page fournit son affichage : render(), notice(msg, kind), mNote(msg),
// renderFeed(), onLog(entry, pid), fitGrid(), renderRecap(), openReview(), closeReview().
// Le serveur fait autorité : la grille arrive sans les solutions et chaque saisie est validée par lui
// (voir docs/architecture.md).
'use strict';
const R = 13, C = 10;
const FILLER_THEME = 'mot_courant';
const PTS_LETTER = 10, HARD_MULT = 2, BONUS_VIERGE = 20, PRIME_TWIN = 20, BONUS_MYST = 100, MYST_THRESHOLD = 80;
const wordBase = w => w.len * PTS_LETTER * (w.hard ? HARD_MULT : 1);
const TWIN_SYM = ['★', '◆'];
const SVG_STAR = '<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 17.2 6.1 20.5l1.3-6.5L2.5 9.4l6.6-.8z"/>';
const SVG_DIAMOND = '<path d="M12 1.5l9.5 10.5L12 22.5 2.5 12z"/>';
const wmSvg = pair => `<svg class="wm" viewBox="0 0 24 24" aria-hidden="true">${pair === 0 ? SVG_STAR : SVG_DIAMOND}</svg>`;
const DIFF_LABELS = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile', expert: 'Expert' };
const SLOTS = ['r', 'd', 'rd', 'dr'];
function clueSlots(x) {
  if (!x || x.t !== 'D') return [];
  return SLOTS.filter(s => x[s] != null).map(s => [s, x[s]]);
}

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
function lsGet(store, key) { try { return JSON.parse(store.getItem(key)); } catch { return null; } }
function lsSet(store, key, v) { try { v == null ? store.removeItem(key) : store.setItem(key, JSON.stringify(v)); } catch { /* stockage indisponible */ } }

/* =====================================================================
   ÉTAT
   ===================================================================== */
let THEMES = [];          // [{ id, nom, mots }] depuis /api/themes
let room = null;          // dernier room:state
let me = null;            // id du joueur dans le salon
let G = null, S = null;   // grille et partie en cours (même forme que dans le prototype)
let clockOffset = 0;      // heure du serveur − heure locale
const serverNow = () => Date.now() + clockOffset;
// Le jeton de session est rangé par onglet : recharger la page reprend la partie,
// et deux onglets du même navigateur sont deux joueurs distincts.
let session = lsGet(sessionStorage, 'motscultes.session');
const P = id => (room && room.players.find(p => p.id === id)) || { id, pseudo: '?', color: '#94A3B8', tint: '#E5E7EB' };
const isHost = () => !!(room && room.hostId === me);

function show(id) { ['#scrHome', '#scrLobby', '#scrGame', '#scrRecap'].forEach(s => $(s).classList.toggle('on', s === id)); }
const onScreen = id => $(id).classList.contains('on');

/* =====================================================================
   CONNEXION
   ===================================================================== */
const socket = io({ transports: ['websocket', 'polling'] });
const send = (event, payload) => socket.timeout(10000).emitWithAck(event, payload || {})
  .catch(() => ({ ok: false, error: 'reseau', message: 'Pas de réponse du serveur.' }));

socket.on('connect', async () => {
  $('#netbar').hidden = true;
  if (!session) return;
  const r = await send('room:resume', { token: session.token });
  if (r.ok) { me = r.you.id; return; }
  endSession(r.message);
});
socket.on('disconnect', () => { $('#netbar').hidden = false; });

function startSession(r) {
  session = { token: r.token, code: r.code };
  lsSet(sessionStorage, 'motscultes.session', session);
  me = r.you.id;
  history.replaceState(null, '', `${location.pathname}?code=${r.code}`);
  renderLobby(); // l'état du salon arrive avant l'accusé : réafficher maintenant que l'on sait qui on est
}
function endSession(msg) {
  session = null; me = null; room = null; G = null; S = null;
  lsSet(sessionStorage, 'motscultes.session', null);
  history.replaceState(null, '', location.pathname);
  $('#loading').hidden = true;
  $('#hMsg').textContent = msg || '';
  show('#scrHome');
}

/* =====================================================================
   ACCUEIL
   ===================================================================== */
function pseudoValue() {
  const v = $('#hPseudo').value.trim();
  lsSet(localStorage, 'motscultes.pseudo', v);
  return v;
}
function initHome() {
  $('#hPseudo').value = lsGet(localStorage, 'motscultes.pseudo') || '';
  const code = new URLSearchParams(location.search).get('code');
  if (code) $('#hCode').value = code.toUpperCase();
  $('#hCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('#hCreate').onclick = async () => {
    const pseudo = pseudoValue();
    if (!pseudo) { $('#hMsg').textContent = 'Choisis un pseudo.'; $('#hPseudo').focus(); return; }
    $('#hCreate').disabled = true;
    const r = await send('room:create', { pseudo });
    $('#hCreate').disabled = false;
    if (!r.ok) { $('#hMsg').textContent = r.message; return; }
    startSession(r);
  };
  $('#hJoinForm').addEventListener('submit', async e => {
    e.preventDefault();
    const pseudo = pseudoValue(), code = $('#hCode').value.trim();
    if (!pseudo) { $('#hMsg').textContent = 'Choisis un pseudo.'; $('#hPseudo').focus(); return; }
    if (code.length !== 4) { $('#hMsg').textContent = 'Le code du salon fait 4 caractères.'; $('#hCode').focus(); return; }
    $('#hJoin').disabled = true;
    const r = await send('room:join', { code, pseudo });
    $('#hJoin').disabled = false;
    if (!r.ok) { $('#hMsg').textContent = r.message; return; }
    startSession(r);
  });
  // Arrivée par un lien d'invitation : le code est prérempli, il reste le pseudo.
  if (code && !session) ($('#hPseudo').value ? $('#hJoin') : $('#hPseudo')).focus();
}

/* =====================================================================
   SALON
   ===================================================================== */
let lastRoomStatus = null;
socket.on('room:state', st => {
  room = st;
  const prev = lastRoomStatus;
  lastRoomStatus = st.status;
  $('#loading').hidden = st.status !== 'starting';
  if (st.status === 'lobby' || st.status === 'starting') {
    if (prev !== 'lobby' && prev !== 'starting') { G = null; S = null; $('#lMsg').textContent = ''; }
    renderLobby();
    show('#scrLobby');
  } else if (S) {
    renderScores();
  }
});

// Répartition affichée en pourcentages entiers dont la somme fait 100.
function displayPercents(weights) {
  const keys = THEMES.map(t => t.id);
  const raw = keys.map(k => weights[k] || 0);
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const scaled = raw.map(v => v * 100 / sum);
  const floors = scaled.map(Math.floor);
  let rest = 100 - floors.reduce((a, b) => a + b, 0);
  const order = scaled.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let j = 0; j < order.length && rest > 0; j++, rest--) floors[order[j][1]]++;
  const out = {};
  keys.forEach((k, i) => out[k] = floors[i]);
  return out;
}

// Le créateur bouge un curseur : les autres thèmes se répartissent le reste, comme dans le prototype.
let pendingSettings = {}, settingsTimer = null;
function pushSettings(patch) {
  Object.assign(pendingSettings, patch);
  Object.assign(room.settings, patch);
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    const settings = pendingSettings;
    pendingSettings = {};
    const r = await send('room:settings', { settings });
    $('#lMsg').textContent = r.ok ? '' : r.message;
  }, 200);
}
function setTheme(id, v) {
  const w = { ...room.settings.weights };
  const total = THEMES.reduce((s, t) => s + (w[t.id] || 0), 0) || 1;
  const pct = {};
  THEMES.forEach(t => pct[t.id] = (w[t.id] || 0) * 100 / total);
  const keys = THEMES.map(t => t.id).filter(k => k !== id);
  const rest = 100 - v;
  const sumO = keys.reduce((s, k) => s + pct[k], 0);
  const next = {};
  keys.forEach(k => { next[k] = sumO > 0 ? pct[k] * rest / sumO : rest / keys.length; });
  next[id] = v;
  if (!Object.values(next).some(x => x > 0)) return;
  pushSettings({ weights: next });
  renderLobby();
}

function buildThemeSliders() {
  $('#lThemes').innerHTML = THEMES.length ? THEMES.map(t => `
    <div class="theme"><label for="th_${esc(t.id)}">${esc(t.nom)}<small>${t.mots} mots</small></label>
      <input type="range" id="th_${esc(t.id)}" min="0" max="100" step="1">
      <output id="tho_${esc(t.id)}" for="th_${esc(t.id)}"></output></div>`).join('')
    : '<p class="note">Aucun thème actif.</p>';
  THEMES.forEach(t => $('#th_' + t.id).addEventListener('input', e => setTheme(t.id, +e.target.value)));
}

function renderLobby() {
  if (!room) return;
  const s = room.settings, host = isHost();
  const link = `${location.origin}/?code=${room.code}`; // la racine envoie vers la version PC ou mobile
  $('#lCodeTitle').textContent = room.code;
  $('#lCode').textContent = room.code;
  $('#lLink').value = link;
  $('#lCount').textContent = `${room.players.length} / 8`;
  $('#lPlayers').innerHTML = room.players.map(p => `
    <span class="pill${p.online ? '' : ' off'}"><span class="dot" style="background:${p.color}"></span>${esc(p.pseudo)}${p.id === room.hostId ? ' <small>créateur</small>' : ''}${p.id === me ? ' <small>toi</small>' : ''}${p.online ? '' : ' <small>déconnecté</small>'}</span>`).join('');
  $('#lSub').textContent = host
    ? 'Partage le code ou le lien, règle la partie, puis lance-la quand tout le monde est là.'
    : `${P(room.hostId).pseudo} règle la partie et la lancera quand tout le monde sera là.`;

  document.querySelectorAll('#lMode button').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.v === s.mode)); b.disabled = !host; });
  $('#lModeNote').textContent = s.mode === 'classique'
    ? 'La partie se termine quand la grille est entièrement remplie.'
    : 'Dès qu’un joueur trouve le mot mystère, chaque autre joueur a droit à une dernière tentative (un mot de la grille ou le mot mystère), puis la partie s’arrête.';
  $('#lLastWrap').hidden = s.mode !== 'derniere_chance';
  [['#lStartScore', 'startScore'], ['#lPenWord', 'penWord'], ['#lPenMyst', 'penMyst'], ['#lLastTime', 'lastTime']].forEach(([sel, key]) => {
    if (document.activeElement !== $(sel)) $(sel).value = s[key];
    $(sel).disabled = !host;
  });
  const disp = displayPercents(s.weights);
  THEMES.forEach(t => {
    const inp = $('#th_' + t.id);
    if (!inp) return;
    if (document.activeElement !== inp) inp.value = disp[t.id];
    inp.disabled = !host;
    $('#tho_' + t.id).textContent = disp[t.id] + ' %';
  });

  // Le créateur peut lancer seul : les autres joueurs sont facultatifs.
  $('#lStart').hidden = !host;
  $('#lStart').disabled = room.status !== 'lobby';
  $('#lStart').textContent = room.players.length > 1 ? 'Lancer la partie' : 'Lancer la partie en solo';
}

function initLobby() {
  document.querySelectorAll('#lMode button').forEach(b => b.onclick = () => { pushSettings({ mode: b.dataset.v }); renderLobby(); });
  [['#lStartScore', 'startScore', 0, 1000], ['#lPenWord', 'penWord', 0, 500], ['#lPenMyst', 'penMyst', 0, 500], ['#lLastTime', 'lastTime', 5, 120]].forEach(([sel, key, min, max]) => {
    $(sel).addEventListener('change', e => {
      const v = Math.max(min, Math.min(max, parseInt(e.target.value, 10) || 0));
      e.target.value = v;
      pushSettings({ [key]: v });
    });
  });
  $('#lCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#lLink').value); $('#lCopy').textContent = 'Lien copié'; }
    catch { $('#lLink').select(); $('#lCopy').textContent = 'Copie avec Ctrl+C'; }
    setTimeout(() => { $('#lCopy').textContent = 'Copier le lien'; }, 2000);
  };
  $('#lLeave').onclick = leaveRoom;
  $('#lStart').onclick = async () => {
    $('#lStart').disabled = true;
    const r = await send('game:start');
    if (!r.ok) { $('#lMsg').textContent = r.message; renderLobby(); }
  };
}

async function leaveRoom() {
  await send('room:leave');
  endSession();
}

/* =====================================================================
   PARTIE
   ===================================================================== */
// Index utiles pour l'affichage : jumelles, cases du mot mystère, ordre de parcours des mots.
function indexGrid(grid) {
  const g = { cells: grid.cells, words: grid.words, myst: grid.myst, twins: grid.twins, twinOf: {}, mystIdx: {}, letters: [] };
  g.words.forEach(w => { if (w.len == null) w.len = w.ans.length; });
  if (g.myst && g.myst.len == null) g.myst.len = g.myst.ans.length;
  g.cells.forEach((x, k) => { if (x.t === 'L') g.letters.push(k); });
  g.twins.forEach((p, i) => { g.twinOf[p[0]] = { pair: i, partner: p[1] }; g.twinOf[p[1]] = { pair: i, partner: p[0] }; });
  if (g.myst) g.myst.cells.forEach((k, i) => g.mystIdx[k] = i + 1);
  g.orderIdx = g.words.map((w, i) => i).sort((a, b) => g.words[a].def - g.words[b].def || (g.words[a].dir === 'h' ? -1 : 1));
  return g;
}

socket.on('game:grid', d => {
  clockOffset = d.serverNow - Date.now();
  const same = S && S.startedAt === d.startedAt; // reconnexion pendant la même partie
  G = indexGrid(d.grid);
  const prev = S;
  S = {
    fill: d.fill, L: { ...d.revealed }, found: d.found, how: d.how, scores: d.scores,
    final: d.final ? { ...d.final, pending: new Set(d.final.pending) } : null,
    startedAt: d.startedAt, endedAt: null, over: false, review: false, endReason: '', ranking: null,
    sel: same ? prev.sel : { w: null, typed: {}, cursor: null },
    mode: same ? prev.mode : 'grid', mTyped: same ? prev.mTyped : [],
    lastTry: 0, busy: false, flash: {}, bump: {}, feed: same ? prev.feed : [],
    you: { mGuess: '', mLost: 0, ...(same ? prev.you : {}), ...d.you },
  };
  $('#loading').hidden = true;
  $('#gCode').textContent = 'Code ' + room.code;
  $('#gMenuBtn').hidden = false;
  closeMenu();
  buildGridDom();
  if (S.sel.w == null || S.found[S.sel.w] != null) selectNext(0);
  if (!same) log(`Partie lancée : ${G.words.length} mots à trouver. Mode ${room.settings.mode === 'classique' ? 'classique' : 'dernière chance'}.`);
  else renderFeed();
  show('#scrGame');
  fitGrid();
  render();
});

const wordText = wi => G.words[wi].cells.map(k => S.L[k] || G.cells[k].ch || '·').join('');

socket.on('word:found', d => {
  if (!S || S.over) return;
  const t = Date.now();
  for (const [k, ch] of Object.entries(d.revealed)) { S.L[k] = ch; S.fill[k] = d.by; S.flash[k] = t; }
  S.found[d.word] = d.by; S.how[d.word] = 'trouvé';
  d.combos.forEach(c => { S.found[c.word] = d.by; S.how[c.word] = c.how; });
  S.scores = d.scores;
  S.bump[d.by] = t;
  const msgs = [`${P(d.by).pseudo} trouve ${wordText(d.word)} +${d.base}${d.vierge ? ' · vierge +' + d.vierge : ''}`];
  d.twins.forEach(tw => msgs.push(`jumelle ${TWIN_SYM[tw.pair]} révélée +${tw.pts}`));
  d.combos.forEach(c => msgs.push(`${c.how === 'croisement' ? 'croisement' : 'combo'} ${wordText(c.word)} +${c.pts}`));
  log(msgs.join(' · '), d.by);
  // Mot en cours de saisie trouvé par quelqu'un d'autre.
  if (S.sel.w != null && S.found[S.sel.w] != null && d.by !== me) {
    notice(`${P(d.by).pseudo} a été plus rapide sur ${wordText(S.sel.w)} !`, 'err');
    selectNext(1);
  }
  render();
  setTimeout(render, 650);
});

socket.on('room:scores', d => {
  if (!S || S.over) return;
  S.scores = d.scores;
  if (d.penalty) { S.bump[d.penalty.by] = Date.now(); log(`${P(d.penalty.by).pseudo} se trompe −${d.penalty.lost}`, d.penalty.by); }
  render();
});

socket.on('mystery:result', d => {
  if (!S || S.over) return;
  S.scores = d.scores;
  S.bump[d.by] = Date.now();
  log(d.ok ? `${P(d.by).pseudo} trouve le mot mystère ! +${d.pts}` : `${P(d.by).pseudo} se trompe sur le mot mystère −${-d.pts}`, d.by);
  render();
});

socket.on('final:start', d => {
  if (!S || S.over) return;
  clockOffset = d.serverNow - Date.now();
  S.final = { by: d.by, endsAt: d.endsAt, pending: new Set(d.pending) };
  log(`${P(d.by).pseudo} a trouvé le mot mystère : dernière tentative pour les autres (${Math.round((d.endsAt - serverNow()) / 1000)} s) !`, d.by);
  if (S.final.pending.has(me)) notice('Dernière tentative ! Un seul essai : un mot de la grille ou le mot mystère.', 'err');
  render();
});

socket.on('final:update', d => {
  if (!S || S.over || !S.final) return;
  S.final.pending = new Set(d.pending);
  log(`${P(d.used).pseudo} a joué sa dernière tentative.`, d.used);
  render();
});

socket.on('game:over', d => {
  const fresh = !S; // page rechargée après la fin : on arrive directement au récapitulatif
  G = indexGrid(d.grid);
  if (fresh) {
    S = { feed: [], sel: { w: null, typed: {}, cursor: null }, mode: 'grid', mTyped: [], flash: {}, bump: {}, you: {} };
    buildGridDom();
  }
  Object.assign(S, {
    over: true, review: false, endReason: d.reason, ranking: d.ranking,
    fill: d.fill, found: d.found, how: d.how, L: {},
    startedAt: S.startedAt || 0, durationMs: d.durationMs,
    scores: Object.fromEntries(d.ranking.map(p => [p.id, p.score])),
    final: null, mode: 'grid',
  });
  G.cells.forEach((x, k) => { if (x.t === 'L') S.L[k] = x.ch; });
  const mine = d.ranking.find(p => p.id === me);
  if (mine) Object.assign(S.you, { mAttempt: mine.mAttempt, mOk: mine.mOk, mGuess: mine.mGuess, mLost: mine.mLost || 0 });
  $('#loading').hidden = true;
  closeMenu();
  if (fresh || !onScreen('#scrGame')) { renderRecap(); show('#scrRecap'); return; }
  render();
  setTimeout(() => { if (S && S.over && !S.review) { renderRecap(); show('#scrRecap'); } }, 1100);
});

function fillPct() {
  if (!G || !S) return 0;
  return Math.round(G.letters.filter(k => S.fill[k] != null).length / G.letters.length * 100);
}
const locked = pid => !!(S.final && !S.final.pending.has(pid));

/* ---------------- Sélection, curseur et saisie ---------------- */
// Le joueur tape le mot EN ENTIER, lettres déjà posées comprises :
// le curseur parcourt toutes les cases du mot, sans sauter les lettres trouvées.
function selectWord(wi, cursor) {
  if (S.sel.w !== wi) S.sel = { w: wi, typed: {}, cursor: null };
  const cells = G.words[wi].cells;
  S.sel.cursor = (cursor != null && cells.includes(cursor)) ? cursor : (cells.find(k => !S.sel.typed[k]) ?? cells[0]);
}

function selectNext(step) {
  const open = G.orderIdx.filter(i => S.review || S.found[i] == null);
  if (!open.length) { S.sel = { w: null, typed: {}, cursor: null }; return; }
  if (S.sel.w == null || step === 0) { selectWord(open[0]); return; }
  const pos = G.orderIdx.indexOf(S.sel.w), n = G.orderIdx.length;
  for (let s = 1; s <= n; s++) {
    const cand = G.orderIdx[((pos + step * s) % n + n) % n];
    if (S.review || S.found[cand] == null) { selectWord(cand); return; }
  }
}

function ensureCursor() {
  if (S.sel.w == null) return null;
  const cells = G.words[S.sel.w].cells;
  if (!cells.includes(S.sel.cursor)) S.sel.cursor = cells.find(k => !S.sel.typed[k]) ?? cells[0];
  return S.sel.cursor;
}

function moveCursor(step) {
  if (S.sel.w == null) return;
  const cells = G.words[S.sel.w].cells, i = cells.indexOf(ensureCursor());
  S.sel.cursor = cells[Math.max(0, Math.min(cells.length - 1, i + step))];
  render();
}

function typeLetter(ch) {
  if (!S || S.over || locked(me)) return;
  if (S.sel.w == null) selectNext(0);
  if (S.sel.w == null) return;
  const k = ensureCursor();
  S.sel.typed[k] = ch;
  const cells = G.words[S.sel.w].cells, i = cells.indexOf(k);
  if (i < cells.length - 1) S.sel.cursor = cells[i + 1];
  render();
}

function backspace() {
  if (!S || S.over || S.sel.w == null) return;
  const k = ensureCursor();
  const cells = G.words[S.sel.w].cells, i = cells.indexOf(k);
  if (S.sel.typed[k]) delete S.sel.typed[k];
  else if (i > 0) { S.sel.cursor = cells[i - 1]; delete S.sel.typed[cells[i - 1]]; }
  render();
}

function clearWord() {
  if (!S || S.sel.w == null) return;
  S.sel.typed = {};
  S.sel.cursor = G.words[S.sel.w].cells[0];
  render();
}

function toggleDirection() {
  if (!S || S.sel.w == null) return;
  const k = ensureCursor();
  const x = G.cells[k];
  const other = [x.h, x.v].find(v => v != null && v !== S.sel.w && S.found[v] == null);
  if (other != null) { selectWord(other, k); render(); }
}

async function submit() {
  if (!S || S.over || S.sel.w == null || S.busy) return;
  if (locked(me)) { notice('Ta dernière tentative est déjà jouée.', 'err'); return; }
  const now = Date.now();
  if (now - S.lastTry < 1000) return; // limite de fréquence (aussi vérifiée par le serveur)
  const wi = S.sel.w, w = G.words[wi];
  if (w.cells.some(k => !S.sel.typed[k])) { notice('Tape le mot en entier avant de valider.', 'err'); return; }
  S.lastTry = now;
  S.busy = true;
  const guess = w.cells.map(k => S.sel.typed[k]).join('');
  const r = await send('word:submit', { word: wi, letters: guess });
  S.busy = false;
  if (!S || S.over) return;
  if (!r.ok) {
    if (r.error === 'deja_trouve') { notice(`Déjà trouvé par ${P(r.by).pseudo} : ${wordText(wi)}`); selectNext(1); }
    else if (r.error !== 'trop_rapide') notice(r.message, 'err');
    render();
    return;
  }
  if (r.correct) {
    notice(`Bien joué ! ${guess} +${r.pts}`, 'ok');
    S.sel = { w: wi, typed: {}, cursor: null };
    selectNext(1);
  } else {
    if (S.sel.w === wi) { S.sel.typed = {}; S.sel.cursor = w.cells[0]; }
    const g = $('#gGrid');
    g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake');
    notice(`Raté : −${r.lost} points.`, 'err');
  }
  render();
}

function tapCell(k) {
  if (S && S.review) {
    const x = G.cells[k];
    const opts = x.t === 'D' ? clueSlots(x).map(p => p[1]) : [x.h, x.v].filter(v => v != null);
    if (!opts.length) return;
    S.sel = { w: (opts.includes(S.sel.w) && opts.length > 1) ? opts.find(o => o !== S.sel.w) : opts[0], typed: {}, cursor: null };
    render();
    return;
  }
  if (!S || S.over) return;
  if (S.mode === 'mystery') { closeMystery(); }
  const x = G.cells[k];
  if (x.t === 'D') {
    const opts = clueSlots(x).map(p => p[1]);
    if (!opts.length) return;
    const open = opts.filter(o => S.found[o] == null);
    if (!open.length) { notice(`Déjà trouvé par ${P(S.found[opts[0]]).pseudo} : ${wordText(opts[0])}`); return; }
    const target = (S.sel.w != null && open.includes(S.sel.w) && open.length > 1) ? open.find(o => o !== S.sel.w) : open[0];
    selectWord(target, G.words[target].cells[0]);
    render();
    return;
  }
  const opts = [x.h, x.v].filter(v => v != null);
  const open = opts.filter(o => S.found[o] == null);
  if (!open.length) { notice(`Déjà trouvé par ${P(S.found[opts[0]]).pseudo} : ${wordText(opts[0])}`); return; }
  let target;
  if (S.sel.w != null && open.includes(S.sel.w)) {
    target = (S.sel.cursor === k && open.length > 1) ? open.find(o => o !== S.sel.w) : S.sel.w;
  } else target = open[0];
  selectWord(target, k);
  render();
}

/* ---------------- Mot mystère ---------------- */
function canPropose() {
  return !!(S && G.myst && !S.over && !locked(me) && !S.you.mAttempt && fillPct() >= MYST_THRESHOLD);
}
function openMystery() {
  if (!canPropose()) return;
  S.mode = 'mystery';
  S.mTyped = [];
  render();
}
function closeMystery() {
  if (!S || S.mode !== 'mystery') return;
  S.mode = 'grid';
  S.mTyped = [];
  render();
}
function mysteryType(ch) {
  if (S.mTyped.length < G.myst.len) S.mTyped.push(ch);
  renderMystery();
}
function mysteryBack() {
  S.mTyped.pop();
  renderMystery();
}
async function submitMystery() {
  if (!canPropose() || S.mode !== 'mystery' || S.busy) return;
  const n = G.myst.len;
  if (S.mTyped.length < n) { mNote(`Il manque ${n - S.mTyped.length} lettre(s) : le mot en compte ${n}.`); return; }
  const guess = S.mTyped.join('');
  S.busy = true;
  const r = await send('mystery:submit', { letters: guess });
  S.busy = false;
  if (!S || S.over) return;
  if (!r.ok) { mNote(r.message); return; }
  Object.assign(S.you, { mAttempt: true, mGuess: guess, mOk: r.correct, mLost: r.correct ? 0 : -r.pts });
  notice(r.correct ? `Mot mystère trouvé : ${guess} ! +${r.pts}` : `Mot mystère : ${guess} est faux. ${r.pts} points.`, r.correct ? 'ok' : 'err');
  S.mode = 'grid'; S.mTyped = [];
  render();
}

/* ---------------- Rendu ---------------- */
let cellEls = [];
function buildGridDom() {
  const grid = $('#gGrid');
  grid.innerHTML = '';
  cellEls = [];
  for (let k = 0; k < R * C; k++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell';
    b.tabIndex = -1;
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => tapCell(k));
    grid.appendChild(b);
    cellEls.push(b);
  }
}

const AR_RIGHT = '<svg class="ar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12h12"/><path d="M13 7l5 5-5 5"/></svg>';
const AR_DOWN = '<svg class="ar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6v12"/><path d="M7 13l5 5 5-5"/></svg>';
const AR_RD = '<svg class="ar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h10v12"/><path d="M10 15l4 4 4-4"/></svg>';
const AR_DR = '<svg class="ar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v10h12"/><path d="M15 10l4 4-4 4"/></svg>';
const ARROWS = { r: AR_RIGHT, d: AR_DOWN, rd: AR_RD, dr: AR_DR };

function renderGrid() {
  const now = Date.now();
  const sel = S.sel.w != null ? G.words[S.sel.w] : null;
  const selSet = new Set(sel ? sel.cells : []);
  const cur = S.over ? null : ensureCursor();
  for (let k = 0; k < R * C; k++) {
    const x = G.cells[k], el = cellEls[k];
    if (x.t === 'D') {
      const parts = clueSlots(x);
      el.style.background = ''; el.style.boxShadow = '';
      if (!parts.length) { el.className = 'cell filler'; el.innerHTML = ''; el.removeAttribute('title'); el.setAttribute('aria-label', 'Case vide'); continue; }
      const hard = parts.some(p => G.words[p[1]].hard);
      el.className = 'cell def' + (hard ? ' hard' : '') + (parts.length > 1 ? ' two' : '');
      el.innerHTML = parts.map(([d, wi]) => {
        const w = G.words[wi];
        return `<div class="dq ${d === 'r' || d === 'rd' ? 'r' : 'd'}${S.found[wi] != null && !S.review ? ' done' : ''}${S.sel.w === wi ? ' on' : ''}"><span class="tx">${esc(w.clue)}</span>${ARROWS[d]}</div>`;
      }).join('');
      const label = parts.map(([d, wi]) => ({ r: '→ ', d: '↓ ', rd: '→↓ ', dr: '↓→ ' }[d]) + G.words[wi].clue).join('\n');
      el.title = label;
      el.setAttribute('aria-label', 'Définition : ' + label);
      continue;
    }
    const pid = S.fill[k], tw = G.twinOf[k];
    const known = S.L[k] || '';
    let bg = '#FFFFFF', fg = '#1F2937', ring = '';
    if (pid) { bg = P(pid).tint; fg = P(pid).color; }
    let letter = pid ? known : '', ghost = false;
    if (S.review) { letter = known; if (!pid) { fg = '#A8B0BE'; bg = '#FFFFFF'; } }
    if (selSet.has(k) && S.review) {
      ring = 'inset 0 0 0 3px var(--act-ring)';
    } else if (selSet.has(k)) {
      if (!pid) bg = 'var(--sel)';
      ring = 'inset 0 0 0 2px var(--sel-ring)';
      const t = S.sel.typed[k];
      if (t) { letter = t; fg = (pid && t !== known) ? '#DC2626' : '#1F2937'; }
      else if (pid) ghost = true; // lettre connue, à retaper
      if (k === cur) { bg = 'var(--act)'; ring = 'inset 0 0 0 3px var(--act-ring)'; }
    }
    el.className = 'cell let' + (S.flash[k] && now - S.flash[k] < 650 ? ' flash' : '');
    el.style.background = bg;
    el.style.boxShadow = ring;
    el.removeAttribute('title');
    let h = '';
    if (tw) h += wmSvg(tw.pair);
    if (G.mystIdx[k]) h += `<span class="mc"></span><span class="mn">${G.mystIdx[k]}</span>`;
    h += `<span class="l" style="color:${fg}${ghost ? ';opacity:.35' : ''}">${letter}</span>`;
    el.innerHTML = h;
    el.setAttribute('aria-label', `Ligne ${Math.floor(k / C) + 1}, colonne ${k % C + 1}${letter ? ', ' + letter : ', vide'}${tw ? ', case jumelle ' + TWIN_SYM[tw.pair] : ''}`);
  }
}


function log(msg, pid) {
  if (!S) return;
  const entry = { t: fmtTime(serverNow() - S.startedAt), msg, color: pid ? P(pid).color : '#A9ADCB' };
  S.feed.unshift(entry);
  S.feed = S.feed.slice(0, 60);
  onLog(entry, pid);
}

/* ---------------- Menu ---------------- */
function closeMenu() { $('#gMenu').hidden = true; $('#gMenuBtn').setAttribute('aria-expanded', 'false'); }

/* =====================================================================
   DÉMARRAGE
   ===================================================================== */
function boot() {
  initHome();
  initLobby();
  fetch('/api/themes')
    .then(r => r.json())
    .then(list => { THEMES = list; buildThemeSliders(); renderLobby(); })
    .catch(() => { $('#hMsg').textContent = 'Impossible de charger les thèmes : recharge la page.'; });
}

