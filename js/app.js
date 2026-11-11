(function(){
'use strict';
var $ = function(s){ return document.querySelector(s); };
var ICON = {
  play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  more:'<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  up:'<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down:'<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x:'<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
};
var state = { songs:[], playlists:[], queue:[], qi:-1, queueName:'', view:'library', openPl:null, sync:null, loopA:null, loopB:null, rate:1 };
var db = null;
var mem = { songs:new Map(), audio:new Map(), playlists:new Map() };
var audio = new Audio();
audio.preload = 'auto';
var curUrl = null, playerOpen = false, seeking = false, lastActive = -2, userScrollAt = 0, wakeLock = null;
var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Armazenamento (IndexedDB, só neste aparelho) ---------- */
function openDB(){
  return new Promise(function(res, rej){
    var r = indexedDB.open('ensaio', 1);
    r.onupgradeneeded = function(){
      var d = r.result;
      d.createObjectStore('songs', {keyPath:'id'});
      d.createObjectStore('audio', {keyPath:'id'});
      d.createObjectStore('playlists', {keyPath:'id'});
    };
    r.onsuccess = function(){ res(r.result); };
    r.onerror = function(){ rej(r.error); };
  });
}
function tx(store, mode, fn){
  return new Promise(function(res, rej){
    var t = db.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = function(){ res(req ? req.result : undefined); };
    t.onerror = function(){ rej(t.error); };
    t.onabort = function(){ rej(t.error); };
  });
}
async function save(st, obj){
  if (db) { await tx(st, 'readwrite', function(s){ return s.put(obj); }); }
  else mem[st].set(obj.id, obj);
}
async function remove(st, id){
  mem[st].delete(id);
  if (db) { try { await tx(st, 'readwrite', function(s){ return s.delete(id); }); } catch(e){} }
}
async function loadAudio(id){
  if (mem.audio.has(id)) return mem.audio.get(id);
  if (!db) return null;
  try { return await tx('audio', 'readonly', function(s){ return s.get(id); }); } catch(e){ return null; }
}
async function loadAll(st){
  if (!db) return Array.from(mem[st].values());
  try { return await tx(st, 'readonly', function(s){ return s.getAll(); }); } catch(e){ return []; }
}
var saveTimers = {};
function saveSongSoon(s){
  clearTimeout(saveTimers[s.id]);
  saveTimers[s.id] = setTimeout(function(){ save('songs', s).catch(function(){ toast('Não foi possível salvar a letra'); }); }, 400);
}

/* ---------- Utilidades ---------- */
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function fmt(t){ if (!isFinite(t) || t < 0) t = 0; var m = Math.floor(t/60), s = Math.floor(t%60); return m + ':' + (s<10?'0':'') + s; }
function stamp(t){ var m = Math.floor(t/60), s = (t - m*60).toFixed(2); return (m<10?'0':'') + m + ':' + (s.length<5?'0':'') + s; }
function rateLabel(r){ return String(r).replace('.', ',') + '×'; }
var toastTimer;
function toast(msg){
  var el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(function(){ el.classList.remove('show'); }, 2600);
}
function songById(id){ return state.songs.find(function(s){ return s.id === id; }); }
function plById(id){ return state.playlists.find(function(p){ return p.id === id; }); }
function sortedSongs(){ return state.songs.slice().sort(function(a,b){ return a.title.localeCompare(b.title, 'pt-BR'); }); }
function curSong(){ return state.qi >= 0 ? songById(state.queue[state.qi]) : null; }
function lyricStatus(s){
  if (!s.lyrics.length) return 'sem letra';
  return s.lyrics.some(function(l){ return l.t != null; }) ? 'letra sincronizada' : 'letra sem tempos';
}
function songSub(s){ return (s.duration ? fmt(s.duration) + ', ' : '') + lyricStatus(s) + (s.notes || s.lyrics.some(function(l){ return l.note; }) ? ', com observações' : ''); }

/* ---------- Letras ---------- */
function parseLyrics(txt){
  var out = [];
  txt.replace(/\r/g,'').split('\n').forEach(function(raw){
    if (/^\s*\[(ar|ti|al|by|offset|length|re|ve|au|#)\s*:/i.test(raw)) return;
    var rest = raw, tags = [], m;
    while ((m = /^\s*\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/.exec(rest))) {
      tags.push(+m[1]*60 + parseFloat(m[2].replace(':','.')));
      rest = rest.slice(m[0].length);
    }
    var text = rest.trim();
    if (tags.length) tags.forEach(function(t){ out.push({t:+t.toFixed(2), text:text}); });
    else out.push({t:null, text:text});
  });
  var allTimed = out.some(function(l){ return l.t != null; }) && out.every(function(l){ return l.t != null || !l.text; });
  if (allTimed) out = out.filter(function(l){ return l.t != null; }).sort(function(a,b){ return a.t - b.t; });
  var clean = [];
  out.forEach(function(l){
    var blank = !l.text && l.t == null;
    if (blank && (!clean.length || (!clean[clean.length-1].text && clean[clean.length-1].t == null))) return;
    clean.push(l);
  });
  while (clean.length && !clean[clean.length-1].text && clean[clean.length-1].t == null) clean.pop();
  return clean;
}
function lyricsToText(lines){ return lines.map(function(l){ return l.t != null ? '[' + stamp(l.t) + ']' + l.text : l.text; }).join('\n'); }
function nextLine(s, from){ for (var i = Math.max(0,from); i < s.lyrics.length; i++) if (s.lyrics[i].text.trim()) return i; return -1; }
function prevLine(s, from){ for (var i = Math.min(from, s.lyrics.length-1); i >= 0; i--) if (s.lyrics[i].text.trim()) return i; return -1; }
function activeIdx(lines, t){ var a = -1; for (var i = 0; i < lines.length; i++) { var l = lines[i]; if (l.t != null && l.t <= t + 0.05 && (a < 0 || l.t >= lines[a].t)) a = i; } return a; }

/* ---------- Telas ---------- */
function render(){ renderHeader(); renderTabs(); renderView(); renderMini(); }
function renderHeader(){
  var h = $('#hdr');
  if (state.view === 'playlist') {
    var p = plById(state.openPl);
    h.innerHTML = '<button class="back" data-act="back">‹ Playlists</button><h1 class="h-pl">' + esc(p ? p.name : '') + '</h1>';
  } else if (state.view === 'library') {
    h.innerHTML = '<h1>Ensaio</h1>' + (state.songs.length ? '<button class="btn" data-act="add">Adicionar músicas</button>' : '');
  } else if (state.view === 'help') {
    h.innerHTML = '<h1>Ajuda</h1>';
  } else {
    h.innerHTML = '<h1>Playlists</h1><button class="btn" data-act="newpl">Nova playlist</button>';
  }
}
function renderTabs(){
  var v = state.view === 'playlist' ? 'playlists' : state.view;
  document.querySelectorAll('.tab').forEach(function(t){ if (t.dataset.v === v) t.setAttribute('aria-current','page'); else t.removeAttribute('aria-current'); });
}
function songRow(s, extra){
  var cur = curSong();
  return '<div class="row' + (cur && cur.id === s.id ? ' playing' : '') + '">' + (extra && extra.pre || '') +
    '<button class="row-main" data-act="' + (extra ? extra.act : 'play') + '" data-id="' + s.id + '"' + (extra ? ' data-i="' + extra.i + '"' : '') + '>' +
    '<span class="t">' + esc(s.title) + '</span><span class="s">' + esc(songSub(s)) + '</span></button>' +
    (extra ? extra.post : '<button class="icon-btn small" data-act="more" data-id="' + s.id + '" aria-label="Opções de ' + esc(s.title) + '">' + ICON.more + '</button>') +
    '</div>';
}
function renderView(){
  var m = $('#main');
  if (state.view === 'help') {
    if (!m.querySelector('.help')) m.innerHTML = $('#helpTpl').innerHTML;
    return;
  }
  if (state.view === 'library') {
    if (!state.songs.length) {
      m.innerHTML = '<div class="empty"><h2>Nenhuma música ainda</h2><p>Escolha arquivos de áudio do seu celular. Eles ficam guardados só neste aparelho, junto com as letras.</p><button class="btn" data-act="add">Adicionar músicas</button></div>';
      return;
    }
    m.innerHTML = sortedSongs().map(function(s){ return songRow(s); }).join('') + '<p class="foot" id="usage"></p>';
    showUsage();
  } else if (state.view === 'playlists') {
    if (!state.playlists.length) {
      m.innerHTML = '<div class="empty"><h2>Nenhuma playlist</h2><p>Monte o repertório do ensaio na ordem em que vocês vão tocar.</p><button class="btn" data-act="newpl">Nova playlist</button></div>';
      return;
    }
    m.innerHTML = state.playlists.map(function(p){
      var n = p.songIds.length;
      return '<div class="row' + (state.queueName === p.name && curSong() ? ' playing' : '') + '"><button class="row-main" data-act="openpl" data-id="' + p.id + '"><span class="t">' + esc(p.name) + '</span><span class="s">' + n + (n === 1 ? ' música' : ' músicas') + '</span></button></div>';
    }).join('');
  } else {
    var p = plById(state.openPl);
    if (!p) { state.view = 'playlists'; render(); return; }
    var html = '<div class="pl-actions">' + (p.songIds.length ? '<button class="btn" data-act="plplay">Tocar playlist</button>' : '') +
      '<button class="btn sec" data-act="pladd">Escolher músicas</button><button class="btn sec" data-act="plmore">Opções</button></div>';
    if (!p.songIds.length) html += '<div class="empty"><p>Esta playlist está vazia. Toque em “Escolher músicas” para montar a ordem.</p></div>';
    html += p.songIds.map(function(id, i){
      var s = songById(id); if (!s) return '';
      return songRow(s, { act:'plsong', i:i, pre:'<span class="num">' + (i+1) + '</span>',
        post:'<button class="icon-btn small" data-act="up" data-i="' + i + '" aria-label="Subir"' + (i===0?' disabled style="opacity:.3"':'') + '>' + ICON.up + '</button>' +
             '<button class="icon-btn small" data-act="down" data-i="' + i + '" aria-label="Descer"' + (i===p.songIds.length-1?' disabled style="opacity:.3"':'') + '>' + ICON.down + '</button>' +
             '<button class="icon-btn small" data-act="rm" data-i="' + i + '" aria-label="Tirar da playlist">' + ICON.x + '</button>' });
    }).join('');
    m.innerHTML = html;
  }
}
function showUsage(){
  if (!navigator.storage || !navigator.storage.estimate) return;
  navigator.storage.estimate().then(function(e){
    var el = $('#usage'); if (!el || !e.usage) return;
    el.textContent = 'Usando ' + Math.round(e.usage/1048576) + ' MB neste aparelho.';
  }).catch(function(){});
}
function renderMini(){
  var s = curSong(), el = $('#mini');
  if (!s) { el.hidden = true; return; }
  el.hidden = false;
  $('#miniT').textContent = s.title;
  $('#miniS').textContent = lyricStatus(s);
  setPlayIcons();
}
function setPlayIcons(){
  var playing = !audio.paused && !!audio.src;
  $('#miniPlay').innerHTML = playing ? ICON.pause : ICON.play;
  $('#miniPlay').setAttribute('aria-label', playing ? 'Pausar' : 'Tocar');
  $('#bPlay').innerHTML = playing ? ICON.pause : ICON.play;
  $('#bPlay').setAttribute('aria-label', playing ? 'Pausar' : 'Tocar');
}

/* ---------- Player ---------- */
function renderPlayerHead(){
  var s = curSong();
  $('#pTitle').textContent = s ? s.title : 'Nada tocando';
  $('#pSub').textContent = s ? (state.qi+1) + ' de ' + state.queue.length + ', ' + state.queueName : '';
}
function renderPlayer(){ renderPlayerHead(); renderNotes(); renderLyrics(); renderTools(); setPlayIcons(); }
function renderNotes(){
  var s = curSong(), el = $('#pNotes');
  if (!s) { el.hidden = true; return; }
  el.hidden = false;
  if (s.notes) { el.classList.remove('empty-n'); el.textContent = s.notes; }
  else { el.classList.add('empty-n'); el.textContent = '+ Adicionar observação'; }
}
function renderLyrics(){
  var box = $('#lyrics'), s = curSong(); lastActive = -2;
  box.classList.toggle('syncing', !!state.sync);
  if (!s) { box.innerHTML = '<div class="l-empty"><p>Escolha uma música para começar.</p></div>'; return; }
  if (!s.lyrics.length) { box.innerHTML = '<div class="l-empty"><p>Esta música ainda não tem letra.</p><button class="btn" data-act="editlyrics">Adicionar letra</button></div>'; return; }
  var synced = s.lyrics.some(function(l){ return l.t != null; });
  var useSpacer = synced || state.sync;
  box.innerHTML = (useSpacer ? '<div class="spacer"></div>' : '<p class="hint">Esta letra ainda não tem tempos. Toque em “Sincronizar” e marque o começo de cada verso enquanto a música toca.</p>') +
    s.lyrics.map(function(l, i){
      return l.text ? '<div class="line' + (l.t != null ? ' timed' : '') + '" data-act="line" data-i="' + i + '">' + esc(l.text) + (l.note ? '<span class="lnote">' + esc(l.note) + '</span>' : '') + '</div>' : '<div class="gap"></div>';
    }).join('') + '<p class="lhint">Segure uma linha para escrever uma anotação nela.</p><div class="spacer"></div>';
  if (state.sync) markTarget();
  updateActive();
}
function centerLine(i, force){
  if (!force && Date.now() - userScrollAt < 2500) return;
  var box = $('#lyrics'), el = box.querySelector('.line[data-i="' + i + '"]');
  if (!el) return;
  box.scrollTo({ top: el.offsetTop - box.clientHeight/2 + el.offsetHeight/2, behavior: reduceMotion ? 'auto' : 'smooth' });
}
function updateActive(){
  var s = curSong(); if (!s || !s.lyrics.length) return;
  var a = activeIdx(s.lyrics, audio.currentTime);
  if (a === lastActive) return;
  lastActive = a;
  $('#lyrics').querySelectorAll('.line').forEach(function(el){
    var i = +el.dataset.i;
    el.classList.toggle('on', i === a);
    el.classList.toggle('past', a >= 0 && i < a);
  });
  if (a >= 0 && !state.sync && playerOpen) centerLine(a);
}
function renderTools(){
  $('#bRate').textContent = rateLabel(state.rate);
  $('#bRate').setAttribute('aria-pressed', state.rate !== 1 ? 'true' : 'false');
  var lb = $('#bLoop');
  if (state.loopA == null) { lb.textContent = 'A–B'; lb.setAttribute('aria-pressed','false'); lb.setAttribute('aria-label','Repetir trecho: marcar início'); }
  else if (state.loopB == null) { lb.textContent = 'Marcar B'; lb.setAttribute('aria-pressed','false'); lb.setAttribute('aria-label','Repetir trecho: marcar fim'); }
  else { lb.textContent = 'A–B ✓'; lb.setAttribute('aria-pressed','true'); lb.setAttribute('aria-label','Repetindo trecho. Toque para desligar'); }
  var d = audio.duration;
  [['#mkA', state.loopA], ['#mkB', state.loopB]].forEach(function(p){
    var el = $(p[0]);
    if (p[1] == null || !d) { el.hidden = true; return; }
    el.hidden = false; el.style.left = (p[1]/d*100) + '%';
  });
  var syncing = !!state.sync;
  $('#tools').hidden = syncing; $('#syncBar').hidden = !syncing;
}
async function playAt(i){
  if (i < 0 || i >= state.queue.length) return;
  if (state.sync) finishSync(true);
  state.qi = i;
  var s = curSong();
  var a = await loadAudio(s.id);
  if (!a) { toast('O áudio de “' + s.title + '” não foi encontrado'); return; }
  if (curUrl) URL.revokeObjectURL(curUrl);
  curUrl = URL.createObjectURL(new Blob([a.buf], {type: a.type}));
  audio.src = curUrl;
  applyRate();
  state.loopA = state.loopB = null;
  try { await audio.play(); } catch(e){}
  updateMediaSession();
  renderMini(); renderPlayer(); renderView();
  if (playerOpen) setTimeout(function(){ userScrollAt = 0; lastActive = -2; updateActive(); $('#lyrics').scrollTop = 0; }, 50);
}
function playQueue(ids, start, name){
  state.queue = ids.slice(); state.queueName = name;
  playAt(Math.max(0, start));
}
function applyRate(){
  audio.defaultPlaybackRate = state.rate; audio.playbackRate = state.rate;
  audio.preservesPitch = true; audio.mozPreservesPitch = true; audio.webkitPreservesPitch = true;
}
function toggle(){ if (!audio.src) return; if (audio.paused) audio.play().catch(function(){}); else audio.pause(); }
function prev(){ if (audio.currentTime > 3 || state.qi <= 0) { audio.currentTime = state.loopA != null ? state.loopA : 0; } else playAt(state.qi - 1); }
function next(){ if (state.qi < state.queue.length - 1) playAt(state.qi + 1); }
function openPlayer(){
  if (!curSong()) return;
  playerOpen = true;
  var p = $('#player'); p.classList.add('open'); p.setAttribute('aria-hidden','false');
  renderPlayer();
  setTimeout(function(){ lastActive = -2; userScrollAt = 0; updateActive(); if (lastActive >= 0) centerLine(lastActive, true); }, 300);
  requestWake();
}
function closePlayer(){
  playerOpen = false;
  var p = $('#player'); p.classList.remove('open'); p.setAttribute('aria-hidden','true');
  releaseWake();
}
function checkLoop(){ if (state.loopB != null && audio.currentTime >= state.loopB) audio.currentTime = state.loopA; }
function tick(){
  if (playerOpen) {
    var d = audio.duration;
    if (!seeking && d) $('#seek').value = Math.round(audio.currentTime / d * 1000);
    if (!seeking) $('#tCur').textContent = fmt(audio.currentTime);
    $('#tDur').textContent = fmt(d);
    updateActive();
  }
  checkLoop();
  requestAnimationFrame(tick);
}

/* Tela ligada durante o ensaio */
async function requestWake(){
  try { if ('wakeLock' in navigator && playerOpen && !audio.paused && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', function(){ wakeLock = null; }); } } catch(e){}
}
function releaseWake(){ try { if (wakeLock) wakeLock.release(); } catch(e){} wakeLock = null; }
document.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'visible') requestWake(); });

/* Controles na tela de bloqueio */
function updateMediaSession(){
  if (!('mediaSession' in navigator)) return;
  var s = curSong(); if (!s) return;
  try { navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: state.queueName || 'Ensaio' }); } catch(e){}
}
if ('mediaSession' in navigator) {
  var h = { play: function(){ audio.play().catch(function(){}); }, pause: function(){ audio.pause(); },
    previoustrack: prev, nexttrack: next,
    seekbackward: function(){ audio.currentTime = Math.max(0, audio.currentTime - 5); },
    seekforward: function(){ audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); } };
  Object.keys(h).forEach(function(k){ try { navigator.mediaSession.setActionHandler(k, h[k]); } catch(e){} });
}

/* ---------- Sincronização ---------- */
function startSync(){
  var s = curSong(); if (!s) return;
  if (!s.lyrics.some(function(l){ return l.text; })) { toast('Adicione a letra antes de sincronizar'); lyricsEditor(s); return; }
  state.sync = { idx: nextLine(s, 0) };
  renderTools(); renderLyrics();
  centerLine(state.sync.idx, true);
  toast('Dê play e toque em “Marcar linha” no começo de cada verso');
}
function markTarget(){
  var box = $('#lyrics');
  box.querySelectorAll('.line.target').forEach(function(el){ el.classList.remove('target'); });
  if (!state.sync || state.sync.idx < 0) return;
  var el = box.querySelector('.line[data-i="' + state.sync.idx + '"]');
  if (el) el.classList.add('target');
}
function markLine(){
  var s = curSong(), sy = state.sync; if (!s || !sy || sy.idx < 0) return;
  if (audio.paused) { toast('Dê play primeiro'); return; }
  s.lyrics[sy.idx].t = Math.max(0, +(audio.currentTime - 0.15).toFixed(2));
  var el = $('#lyrics').querySelector('.line[data-i="' + sy.idx + '"]');
  if (el) el.classList.add('timed');
  saveSongSoon(s); lastActive = -2;
  var n = nextLine(s, sy.idx + 1);
  if (n < 0) { finishSync(); toast('Letra sincronizada'); return; }
  sy.idx = n; markTarget(); centerLine(n, true);
}
function undoLine(){
  var s = curSong(), sy = state.sync; if (!s || !sy) return;
  var p = prevLine(s, (sy.idx < 0 ? s.lyrics.length : sy.idx) - 1);
  if (p < 0) return;
  var t = s.lyrics[p].t;
  s.lyrics[p].t = null;
  var el = $('#lyrics').querySelector('.line[data-i="' + p + '"]'); if (el) el.classList.remove('timed');
  if (t != null) audio.currentTime = Math.max(0, t - 3);
  sy.idx = p; saveSongSoon(s); lastActive = -2; markTarget(); centerLine(p, true);
}
function finishSync(silent){
  var s = curSong();
  state.sync = null;
  if (s) save('songs', s).catch(function(){});
  if (!silent) { renderTools(); renderLyrics(); renderView(); renderMini(); }
}

/* ---------- Janelas ---------- */
var cancelFn = null, modalOpenedAt = 0;
function modal(html, onCancel){
  modalOpenedAt = Date.now();
  $('#sheet').innerHTML = html; $('#modal').hidden = false; cancelFn = onCancel || null;
  var f = $('#sheet').querySelector('[autofocus]'); if (f) setTimeout(function(){ f.focus(); }, 50);
}
function closeModal(){ $('#modal').hidden = true; $('#sheet').innerHTML = ''; $('#sheet').onclick = null; cancelFn = null; }
function cancelModal(){ var f = cancelFn; closeModal(); if (f) f(); }
$('#modal').addEventListener('click', function(e){ if (e.target === $('#modal') && Date.now() - modalOpenedAt > 450) cancelModal(); });
$('#sheet').addEventListener('click', function(e){ if (Date.now() - modalOpenedAt < 450) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
document.addEventListener('keydown', function(e){
  if (e.key !== 'Escape') return;
  if (!$('#modal').hidden) cancelModal(); else if (playerOpen) closePlayer();
});
function actionSheet(title, actions){
  modal('<h2>' + esc(title) + '</h2><div class="acts">' + actions.map(function(a, i){
    return '<button class="act' + (a.danger ? ' danger' : '') + '" data-m="' + i + '">' + esc(a.label) + '</button>';
  }).join('') + '<button class="act" data-m="x">Cancelar</button></div>');
  $('#sheet').onclick = function(e){
    var b = e.target.closest('[data-m]'); if (!b) return;
    closeModal(); if (b.dataset.m !== 'x') actions[+b.dataset.m].fn();
  };
}
function askText(title, value, okLabel){
  return new Promise(function(res){
    modal('<h2>' + esc(title) + '</h2><input class="field" id="askIn" autofocus maxlength="120"><div class="m-actions"><button class="btn sec" data-m="x">Cancelar</button><button class="btn" data-m="ok">' + esc(okLabel) + '</button></div>', function(){ res(null); });
    var inp = $('#askIn'); inp.value = value || '';
    function ok(){ var v = inp.value.trim(); if (!v) { inp.focus(); return; } closeModal(); res(v); }
    inp.addEventListener('keydown', function(e){ if (e.key === 'Enter') ok(); });
    $('#sheet').onclick = function(e){ var b = e.target.closest('[data-m]'); if (!b) return; if (b.dataset.m === 'ok') ok(); else { closeModal(); res(null); } };
  });
}
function confirmBox(text, okLabel){
  return new Promise(function(res){
    modal('<h2>' + esc(text) + '</h2><div class="m-actions"><button class="btn sec" data-m="x">Cancelar</button><button class="btn" data-m="ok">' + esc(okLabel) + '</button></div>', function(){ res(false); });
    $('#sheet').onclick = function(e){ var b = e.target.closest('[data-m]'); if (!b) return; closeModal(); res(b.dataset.m === 'ok'); };
  });
}
function pickSongs(selected){
  return new Promise(function(res){
    if (!state.songs.length) { toast('Adicione músicas na aba Músicas primeiro'); return res(null); }
    modal('<h2>Escolher músicas</h2><div>' + sortedSongs().map(function(s){
      return '<label class="pick"><input type="checkbox" value="' + s.id + '"' + (selected.indexOf(s.id) >= 0 ? ' checked' : '') + '><span>' + esc(s.title) + '</span></label>';
    }).join('') + '</div><div class="m-actions"><button class="btn sec" data-m="x">Cancelar</button><button class="btn" data-m="ok">Salvar</button></div>', function(){ res(null); });
    var picked = selected.filter(function(id){ return true; });
    $('#sheet').addEventListener('change', function(e){
      var v = e.target.value; if (!v) return;
      if (e.target.checked) { if (picked.indexOf(v) < 0) picked.push(v); } else picked = picked.filter(function(x){ return x !== v; });
    });
    $('#sheet').onclick = function(e){ var b = e.target.closest('[data-m]'); if (!b) return; closeModal(); res(b.dataset.m === 'ok' ? picked : null); };
  });
}
function notesEditor(s){
  modal('<h2>Observações de “' + esc(s.title) + '”</h2><p>Tom, capotraste, entradas, partes para prestar atenção.</p>' +
    '<textarea class="field notes-ta" id="notesTxt" maxlength="1000" autofocus placeholder="Ex.: Tom de Ré. Respirar antes do refrão. Segunda volta só voz e violão."></textarea>' +
    '<div class="m-actions"><button class="btn sec" data-m="x">Cancelar</button><button class="btn" data-m="ok">Salvar observações</button></div>');
  $('#notesTxt').value = s.notes || '';
  $('#sheet').onclick = async function(e){
    var b = e.target.closest('[data-m]'); if (!b) return;
    if (b.dataset.m === 'ok') {
      s.notes = $('#notesTxt').value.trim();
      closeModal();
      try { await save('songs', s); toast(s.notes ? 'Observações salvas' : 'Observações apagadas'); } catch(err){ toast('Não foi possível salvar as observações'); }
      renderView(); if (curSong() === s) renderNotes();
    } else closeModal();
  };
}
function carryNotes(oldL, newL){
  var pool = oldL.filter(function(l){ return l.note; }).map(function(l){ return { text:l.text.trim(), note:l.note }; });
  newL.forEach(function(l){
    var k = pool.findIndex(function(p){ return p.text === l.text.trim(); });
    if (k >= 0) { l.note = pool[k].note; pool.splice(k, 1); }
  });
  return pool.length;
}
function lineNoteEditor(s, i){
  var l = s.lyrics[i]; if (!l) return;
  modal('<h2>Anotação na linha</h2><p>“' + esc(l.text) + '”</p>' +
    '<textarea class="field notes-ta" id="lnTxt" maxlength="200" placeholder="Ex.: entra a segunda voz"></textarea>' +
    '<div class="m-actions">' + (l.note ? '<button class="btn ghost" data-m="del">Apagar</button><span class="grow"></span>' : '') +
    '<button class="btn sec" data-m="x">Cancelar</button><button class="btn" data-m="ok">Salvar anotação</button></div>');
  $('#lnTxt').value = l.note || '';
  $('#sheet').onclick = async function(e){
    var b = e.target.closest('[data-m]'); if (!b) return;
    if (b.dataset.m === 'x') { closeModal(); return; }
    var v = b.dataset.m === 'ok' ? $('#lnTxt').value.trim() : '';
    if (v) l.note = v; else delete l.note;
    closeModal();
    try { await save('songs', s); toast(v ? 'Anotação salva' : 'Anotação apagada'); } catch(err){ toast('Não foi possível salvar a anotação'); }
    if (curSong() === s) renderLyrics();
    renderView();
  };
}
var downloadsNs = null;
function safeName(t){ return String(t).replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'letra'; }
function lrcText(s, lines){ return '[ti:' + s.title.replace(/[\[\]\n]/g, '') + ']\n' + lyricsToText(lines) + '\n'; }
function exportLrc(s){
  var lines = s.lyrics;
  if (!lines.length) { toast('Esta música ainda não tem letra'); return; }
  var text = lrcText(s, lines), name = safeName(s.title), file = null;
  try { file = new File([text], name + '.lrc', { type:'text/plain' }); } catch(e){}
  var canShare = false;
  try { canShare = !!(file && navigator.canShare && navigator.canShare({ files:[file] })); } catch(e){}
  var synced = lines.some(function(l){ return l.t != null; });
  modal('<h2>Exportar letra</h2><p>' +
    (synced ? 'O arquivo .lrc leva a letra com os tempos e abre em outros players que mostram letra sincronizada.' : 'Esta letra ainda não tem tempos, então o arquivo sai só com o texto.') +
    ' Observações e anotações nas linhas não vão junto, porque o formato .lrc não tem lugar para elas.' +
    (downloadsNs ? ' Ao baixar, o arquivo vem como .lrc.txt: é só renomear tirando o .txt.' : '') + '</p>' +
    '<textarea class="field notes-ta" id="lrcOut" readonly></textarea>' +
    '<div class="m-actions"><button class="btn ghost" data-m="x">Fechar</button><span class="grow"></span><button class="btn sec" data-m="copy">Copiar texto</button>' +
    (downloadsNs ? '<button class="btn' + (canShare ? ' sec' : '') + '" data-m="dl">Baixar arquivo</button>' : '') +
    (canShare ? '<button class="btn" data-m="share">Compartilhar .lrc</button>' : '') + '</div>');
  $('#lrcOut').value = text;
  $('#sheet').onclick = function(e){
    var b = e.target.closest('[data-m]'); if (!b) return;
    var m = b.dataset.m;
    if (m === 'x') { closeModal(); return; }
    if (m === 'share') {
      navigator.share({ files:[file], title:s.title }).then(function(){ toast('Letra compartilhada'); })
        .catch(function(err){ if (!err || err.name !== 'AbortError') toast('Não deu para compartilhar daqui. Use Baixar ou Copiar.'); });
    } else if (m === 'dl') {
      downloadsNs.save({ filename: name + '.lrc.txt', data: text }).then(function(){ toast('Arquivo salvo'); })
        .catch(function(err){ if (err && err.code === 'declined') return; toast('Não foi possível baixar. Use Copiar texto.'); });
    } else if (m === 'copy') {
      var ta = $('#lrcOut');
      function fallback(){ try { ta.focus(); ta.setSelectionRange(0, ta.value.length); if (document.execCommand('copy')) { toast('Texto copiado'); return; } } catch(_){} toast('Selecione o texto acima e copie'); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function(){ toast('Texto copiado'); }, fallback);
      else fallback();
    }
  };
}
function lyricsEditor(s){
  if (state.sync) finishSync();
  modal('<h2>Letra de “' + esc(s.title) + '”</h2><p>Cole a letra com um verso por linha. Se tiver um arquivo .lrc (letra com tempos), importe ou cole o conteúdo e ela já fica sincronizada.</p>' +
    '<textarea class="field" id="lyrTxt" spellcheck="false" placeholder="Cole a letra aqui"></textarea>' +
    '<div class="m-actions"><button class="btn sec" data-m="imp">Importar .lrc</button><span class="grow"></span><button class="btn sec" data-m="x">Cancelar</button><button class="btn" data-m="ok">Salvar letra</button></div>');
  $('#lyrTxt').value = lyricsToText(s.lyrics);
  $('#sheet').onclick = async function(e){
    var b = e.target.closest('[data-m]'); if (!b) return;
    if (b.dataset.m === 'imp') { $('#lrcFile').value = ''; $('#lrcFile').click(); return; }
    if (b.dataset.m === 'ok') {
      var lost = carryNotes(s.lyrics, s.lyrics = parseLyrics($('#lyrTxt').value));
      closeModal();
      try { await save('songs', s); toast(lost ? 'Letra salva. ' + (lost === 1 ? '1 anotação perdeu sua linha e foi removida' : lost + ' anotações perderam sua linha e foram removidas') : 'Letra salva'); } catch(err){ toast('Não foi possível salvar a letra'); }
      renderView(); renderMini(); if (curSong() === s) renderLyrics();
    } else closeModal();
  };
}
$('#lrcFile').addEventListener('change', async function(e){
  var f = e.target.files[0]; if (!f) return;
  var ta = $('#lyrTxt'); if (ta) ta.value = await f.text();
});

/* ---------- Ações ---------- */
async function addFiles(files){
  var added = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i], id = uid();
    toast('Guardando ' + (i+1) + ' de ' + files.length + '…');
    try {
      var buf = await f.arrayBuffer();
      var title = f.name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim() || 'Sem título';
      var song = { id:id, title:title, lyrics:[], duration:null, added:Date.now() };
      if (db) await save('audio', { id:id, buf:buf, type:f.type || 'audio/mpeg' });
      else mem.audio.set(id, { id:id, buf:buf, type:f.type || 'audio/mpeg' });
      await save('songs', song);
      state.songs.push(song); added++;
    } catch(err) {
      await remove('audio', id);
      toast('Sem espaço para guardar “' + f.name + '”');
      await new Promise(function(r){ setTimeout(r, 1500); });
    }
  }
  if (added) toast(added === 1 ? 'Música adicionada' : added + ' músicas adicionadas');
  render();
}
$('#file').addEventListener('change', function(e){ var fs = Array.from(e.target.files || []); e.target.value = ''; if (fs.length) addFiles(fs); });

function songMenu(id){
  var s = songById(id); if (!s) return;
  actionSheet(s.title, [
    { label:'Editar letra', fn:function(){ lyricsEditor(s); } },
    { label: s.notes ? 'Editar observações' : 'Adicionar observações', fn:function(){ notesEditor(s); } },
    { label:'Exportar letra (.lrc)', fn:function(){ exportLrc(s); } },
    { label:'Adicionar a uma playlist', fn:function(){ addToPlaylistMenu(s); } },
    { label:'Renomear', fn:async function(){ var n = await askText('Renomear música', s.title, 'Salvar'); if (n) { s.title = n; await save('songs', s); render(); renderPlayerHead(); updateMediaSession(); } } },
    { label:'Excluir do aparelho', danger:true, fn:async function(){ if (await confirmBox('Excluir “' + s.title + '”? O áudio e a letra serão apagados deste aparelho.', 'Excluir')) deleteSong(id); } }
  ]);
}
async function newPlaylist(ids){
  var name = await askText('Nova playlist', '', 'Criar playlist'); if (!name) return null;
  var p = { id:uid(), name:name, songIds:ids || [] };
  state.playlists.push(p); await save('playlists', p);
  return p;
}
function addToPlaylistMenu(s){
  var acts = state.playlists.map(function(p){
    return { label:p.name, fn:async function(){
      if (p.songIds.indexOf(s.id) >= 0) { toast('Já está em “' + p.name + '”'); return; }
      p.songIds.push(s.id); await save('playlists', p); toast('Adicionada a “' + p.name + '”'); render();
    } };
  });
  acts.push({ label:'Nova playlist…', fn:async function(){ var p = await newPlaylist([s.id]); if (p) { toast('Playlist criada'); render(); } } });
  actionSheet('Adicionar a uma playlist', acts);
}
async function deleteSong(id){
  var cur = curSong();
  if (cur && cur.id === id) {
    audio.pause(); audio.removeAttribute('src'); audio.load();
    if (curUrl) { URL.revokeObjectURL(curUrl); curUrl = null; }
    state.queue = []; state.qi = -1; state.sync = null; closePlayer();
  } else if (state.queue.indexOf(id) >= 0) {
    var qi = state.queue.indexOf(id);
    state.queue.splice(qi, 1); if (qi < state.qi) state.qi--;
  }
  state.songs = state.songs.filter(function(s){ return s.id !== id; });
  for (var i = 0; i < state.playlists.length; i++) {
    var p = state.playlists[i];
    if (p.songIds.indexOf(id) >= 0) { p.songIds = p.songIds.filter(function(x){ return x !== id; }); await save('playlists', p); }
  }
  await remove('songs', id); await remove('audio', id);
  toast('Música excluída'); render();
}

document.addEventListener('click', async function(e){
  var b = e.target.closest('[data-act]'); if (!b) return;
  var act = b.dataset.act, id = b.dataset.id, i = +b.dataset.i, p = plById(state.openPl);
  switch (act) {
    case 'tab': state.view = b.dataset.v; render(); $('#main').scrollTop = 0; break;
    case 'add': $('#file').click(); break;
    case 'play': var list = sortedSongs().map(function(s){ return s.id; }); playQueue(list, list.indexOf(id), 'Todas as músicas'); break;
    case 'more': songMenu(id); break;
    case 'newpl': var np = await newPlaylist([]); if (np) { state.openPl = np.id; state.view = 'playlist'; render(); } break;
    case 'openpl': state.openPl = id; state.view = 'playlist'; render(); $('#main').scrollTop = 0; break;
    case 'back': state.view = 'playlists'; render(); break;
    case 'plplay': if (p && p.songIds.length) playQueue(p.songIds, 0, p.name); break;
    case 'plsong': if (p) playQueue(p.songIds, i, p.name); break;
    case 'pladd': if (!p) break; var picked = await pickSongs(p.songIds); if (picked) { p.songIds = picked; await save('playlists', p); render(); } break;
    case 'plmore': if (!p) break; actionSheet(p.name, [
      { label:'Renomear playlist', fn:async function(){ var n = await askText('Renomear playlist', p.name, 'Salvar'); if (n) { if (state.queueName === p.name) state.queueName = n; p.name = n; await save('playlists', p); render(); renderPlayerHead(); } } },
      { label:'Excluir playlist', danger:true, fn:async function(){ if (await confirmBox('Excluir a playlist “' + p.name + '”? As músicas continuam no aparelho.', 'Excluir')) { state.playlists = state.playlists.filter(function(x){ return x.id !== p.id; }); await remove('playlists', p.id); state.view = 'playlists'; render(); } } }
    ]); break;
    case 'up': case 'down':
      if (!p) break; var j = act === 'up' ? i - 1 : i + 1; if (j < 0 || j >= p.songIds.length) break;
      var tmp = p.songIds[i]; p.songIds[i] = p.songIds[j]; p.songIds[j] = tmp; await save('playlists', p); renderView(); break;
    case 'rm': if (!p) break; p.songIds.splice(i, 1); await save('playlists', p); renderView(); break;
    case 'openplayer': openPlayer(); break;
    case 'toggle': toggle(); break;
    case 'editlyrics': if (curSong()) lyricsEditor(curSong()); break;
    case 'line':
      if (suppressLineClick) { suppressLineClick = false; break; }
      var s = curSong(); if (!s) break;
      if (state.sync) { state.sync.idx = i; markTarget(); break; }
      var t = s.lyrics[i] && s.lyrics[i].t;
      if (t != null) { audio.currentTime = t; lastActive = -2; userScrollAt = 0; if (audio.paused) audio.play().catch(function(){}); }
      break;
  }
});

/* Player: botões */
$('#pClose').onclick = closePlayer;
$('#pEdit').onclick = function(){
  var s = curSong(); if (!s) return;
  actionSheet('Letra de “' + s.title + '”', [
    { label: s.lyrics.length ? 'Editar letra' : 'Adicionar letra', fn:function(){ lyricsEditor(s); } },
    { label:'Exportar letra (.lrc)', fn:function(){ exportLrc(s); } }
  ]);
};
$('#pNotes').onclick = function(){ if (curSong()) notesEditor(curSong()); };
$('#bPlay').onclick = toggle;
$('#bPrev').onclick = prev;
$('#bNext').onclick = next;
$('#bBack').onclick = function(){ audio.currentTime = Math.max(0, audio.currentTime - 5); lastActive = -2; userScrollAt = 0; };
$('#bFwd').onclick = function(){ audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); lastActive = -2; userScrollAt = 0; };
$('#bRate').onclick = function(){
  actionSheet('Velocidade (o tom não muda)', [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25].map(function(r){
    return { label: rateLabel(r) + (r === 1 ? ' (normal)' : '') + (r === state.rate ? '  ✓' : ''), fn:function(){ state.rate = r; applyRate(); renderTools(); } };
  }));
};
$('#bLoop').onclick = function(){
  if (!audio.src) return;
  if (state.loopA == null) { state.loopA = audio.currentTime; toast('Início marcado em ' + fmt(state.loopA) + '. Toque de novo no fim do trecho'); }
  else if (state.loopB == null) {
    if (audio.currentTime <= state.loopA + 0.5) { toast('O fim precisa vir depois do início (' + fmt(state.loopA) + ')'); return; }
    state.loopB = audio.currentTime; audio.currentTime = state.loopA; toast('Repetindo ' + fmt(state.loopA) + ' a ' + fmt(state.loopB));
  } else { state.loopA = state.loopB = null; toast('Repetição desligada'); }
  renderTools();
};
$('#bSync').onclick = startSync;
$('#sMark').onclick = markLine;
$('#sUndo').onclick = undoLine;
$('#sDone').onclick = function(){ finishSync(); toast('Sincronização salva'); };
var sizes = ['s','m','l'];
try { var sv = localStorage.getItem('ensaio-size'); if (sizes.indexOf(sv) >= 0) $('#lyrics').dataset.size = sv; } catch(e){}
$('#bSize').onclick = function(){
  var box = $('#lyrics'), n = sizes[(sizes.indexOf(box.dataset.size) + 1) % 3];
  box.dataset.size = n; try { localStorage.setItem('ensaio-size', n); } catch(e){}
  toast({s:'Letra pequena', m:'Letra média', l:'Letra grande'}[n]);
  if (lastActive >= 0) setTimeout(function(){ centerLine(lastActive, true); }, 30);
};
['touchstart','wheel','pointerdown'].forEach(function(ev){ $('#lyrics').addEventListener(ev, function(){ userScrollAt = Date.now(); }, {passive:true}); });
/* Segurar uma linha abre a anotação */
var lpTimer = null, lpStart = null, suppressLineClick = false;
$('#lyrics').addEventListener('pointerdown', function(e){
  suppressLineClick = false;
  var el = e.target.closest('.line'); if (!el) return;
  lpStart = { x:e.clientX, y:e.clientY };
  clearTimeout(lpTimer);
  lpTimer = setTimeout(function(){
    lpTimer = null; suppressLineClick = true;
    try { if (navigator.vibrate) navigator.vibrate(15); } catch(_){}
    var s = curSong(); if (s) lineNoteEditor(s, +el.dataset.i);
  }, 550);
});
function cancelLp(e){
  if (!lpTimer) return;
  if (e.type === 'pointermove' && lpStart && Math.abs(e.clientX - lpStart.x) < 10 && Math.abs(e.clientY - lpStart.y) < 10) return;
  clearTimeout(lpTimer); lpTimer = null;
}
['pointerup','pointercancel','pointerleave','pointermove'].forEach(function(ev){ $('#lyrics').addEventListener(ev, cancelLp, {passive:true}); });
$('#lyrics').addEventListener('contextmenu', function(e){ if (e.target.closest('.line')) e.preventDefault(); });

var seek = $('#seek');
seek.addEventListener('input', function(){ seeking = true; $('#tCur').textContent = fmt(seek.value / 1000 * (audio.duration || 0)); });
seek.addEventListener('change', function(){ if (audio.duration) audio.currentTime = seek.value / 1000 * audio.duration; seeking = false; lastActive = -2; userScrollAt = 0; });

/* Eventos do áudio */
audio.addEventListener('play', function(){ setPlayIcons(); requestWake(); });
audio.addEventListener('pause', function(){ setPlayIcons(); releaseWake(); });
audio.addEventListener('timeupdate', checkLoop);
audio.addEventListener('loadedmetadata', function(){
  applyRate(); renderTools();
  var s = curSong();
  if (s && isFinite(audio.duration) && !s.duration) { s.duration = audio.duration; save('songs', s).catch(function(){}); renderView(); }
});
audio.addEventListener('ended', function(){
  if (state.sync) finishSync();
  if (state.qi < state.queue.length - 1) playAt(state.qi + 1);
  else { audio.currentTime = 0; setPlayIcons(); }
});
audio.addEventListener('error', function(){ if (audio.src) toast('Este formato de áudio não toca neste aparelho'); });

/* ---------- Início ---------- */
(async function init(){
  try { db = await openDB(); }
  catch(e) { db = null; toast('Armazenamento indisponível: as músicas ficam só até fechar a página'); }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch(e){}
  state.songs = (await loadAll('songs')).map(function(s){ s.lyrics = s.lyrics || []; return s; });
  state.playlists = await loadAll('playlists');
  render();
  requestAnimationFrame(tick);
  try { if (window.claude && typeof window.claude.use === 'function') downloadsNs = await window.claude.use('downloads'); } catch(e){ downloadsNs = null; }
})();
})();
