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
var state = { songs:[], playlists:[], pending:[], queue:[], qi:-1, queueName:'', view:'library', openPl:null, sync:null, adjust:null, loopA:null, loopB:null, rate:1 };
var db = null;
var mem = { songs:new Map(), audio:new Map(), playlists:new Map(), pending:new Map() };
var audio = new Audio();
audio.preload = 'auto';
var curUrl = null, playerOpen = false, seeking = false, lastActive = -2, userScrollAt = 0, wakeLock = null;
var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Armazenamento (IndexedDB, só neste aparelho) ---------- */
function openDB(){
  return new Promise(function(res, rej){
    var r = indexedDB.open('ensaio', 2);
    r.onupgradeneeded = function(){
      var d = r.result;
      ['songs', 'audio', 'playlists', 'pending'].forEach(function(n){
        if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, {keyPath:'id'});
      });
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
function toast(msg, ms){
  var el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(function(){ el.classList.remove('show'); }, ms || 2600);
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
  var h = $('#hdr'), tb = themeBtn();
  if (state.view === 'playlist') {
    var p = plById(state.openPl);
    h.innerHTML = '<button class="back" data-act="back">‹ Playlists</button>' + tb + '<h1 class="h-pl">' + esc(p ? p.name : '') + '</h1>';
  } else if (state.view === 'library') {
    h.innerHTML = '<h1>Ensaio</h1><div class="hdr-actions">' + tb + (state.songs.length ? '<button class="btn" data-act="add">Adicionar músicas</button>' : '') + '</div>';
  } else if (state.view === 'help') {
    h.innerHTML = '<h1>Ajuda</h1><div class="hdr-actions">' + tb + '</div>';
  } else {
    h.innerHTML = '<h1>Playlists</h1><div class="hdr-actions">' + tb + '<button class="btn" data-act="newpl">Nova playlist</button></div>';
  }
}

/* ---------- Tema ---------- */
var THEMES = { auto:'Automático (igual ao celular)', light:'Claro', dark:'Escuro' };
function getTheme(){ try { var t = localStorage.getItem('ensaio-theme'); return THEMES[t] ? t : 'auto'; } catch(e){ return 'auto'; } }
function themeBtn(){
  return '<button class="icon-btn theme-btn" data-act="theme" aria-label="Tema: ' + esc(THEMES[getTheme()]) + '. Toque para mudar">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg></button>';
}
function applyTheme(t){
  var root = document.documentElement;
  if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
  /* Cor da barra do navegador acompanha o fundo do app */
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#E9EDF4');
}
function themeMenu(){
  var cur = getTheme();
  actionSheet('Tema', Object.keys(THEMES).map(function(k){
    return { label: THEMES[k] + (k === cur ? '  ✓' : ''), fn:function(){
      try { if (k === 'auto') localStorage.removeItem('ensaio-theme'); else localStorage.setItem('ensaio-theme', k); } catch(e){}
      applyTheme(k); renderHeader();
      toast('Tema: ' + THEMES[k].replace(' (igual ao celular)', ''));
    } };
  }));
}
applyTheme(getTheme());
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){ if (getTheme() === 'auto') applyTheme('auto'); }); } catch(e){}
function renderTabs(){
  var v = state.view === 'playlist' ? 'playlists' : state.view;
  document.querySelectorAll('.tab').forEach(function(t){ if (t.dataset.v === v) t.setAttribute('aria-current','page'); else t.removeAttribute('aria-current'); });
}
function songRow(s, extra, sub){
  var cur = curSong();
  return '<div class="row' + (cur && cur.id === s.id ? ' playing' : '') + '">' + (extra && extra.pre || '') +
    '<button class="row-main" data-act="' + (extra ? extra.act : 'play') + '" data-id="' + s.id + '"' + (extra ? ' data-i="' + extra.i + '"' : '') + '>' +
    '<span class="t">' + esc(s.title) + '</span><span class="s">' + esc(sub || songSub(s)) + '</span></button>' +
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
      m.innerHTML = '<div class="empty"><h2>Nenhuma música ainda</h2><p>Escolha arquivos de áudio do seu celular. Eles ficam guardados só neste aparelho, junto com as letras.</p><button class="btn" data-act="add">Adicionar músicas</button>' +
        (state.pending.length ? '' : '<p class="empty-alt">Já tem um arquivo de dados exportado do Ensaio? <button class="link-btn" data-act="import">Importar dados</button></p>') + '</div>' + pendingBlock();
      return;
    }
    if (!m.querySelector('#libList')) libraryShell(m);
    renderLibList();
    $('#libRest').innerHTML = pendingBlock() +
      '<div class="data-actions"><button class="btn sec" data-act="export">Exportar dados</button><button class="btn sec" data-act="import">Importar dados</button></div>' +
      '<div id="usage"></div>';
    showUsage();
  } else if (state.view === 'playlists') {
    if (!state.playlists.length) {
      m.innerHTML = '<div class="empty"><h2>Nenhuma playlist</h2><p>Monte o repertório do ensaio na ordem em que vocês vão tocar.</p><button class="btn" data-act="newpl">Nova playlist</button></div>';
      return;
    }
    m.innerHTML = state.playlists.map(function(p){
      var n = p.songIds.length, w = (p.pendingTitles || []).length;
      return '<div class="row' + (state.queueName === p.name && curSong() ? ' playing' : '') + '"><button class="row-main" data-act="openpl" data-id="' + p.id + '"><span class="t">' + esc(p.name) + '</span><span class="s">' + n + (n === 1 ? ' música' : ' músicas') + (w ? ', ' + w + ' esperando o áudio' : '') + '</span></button></div>';
    }).join('');
  } else {
    var p = plById(state.openPl);
    if (!p) { state.view = 'playlists'; render(); return; }
    var html = '<div class="pl-actions">' + (p.songIds.length ? '<button class="btn" data-act="plplay">Tocar playlist</button>' : '') +
      '<button class="btn sec" data-act="pladd">Escolher músicas</button><button class="btn sec" data-act="plmore">Opções</button></div>';
    if (!p.songIds.length) html += '<div class="empty"><p>Esta playlist está vazia. Toque em “Escolher músicas” para montar a ordem.</p></div>';
    if (p.pendingTitles && p.pendingTitles.length) html += '<p class="foot">Esperando o áudio: ' + esc(p.pendingTitles.map(function(x){ return x.title; }).join(', ')) + '. Ao adicionar um arquivo com o mesmo nome, ela entra na playlist sozinha.</p>';
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
/* ---------- Lista de músicas: busca e páginas (nunca mostra todas de uma vez) ---------- */
var PER_OPTS = [10, 20, 50];
var lib = { q:'', page:0, per:20 };
try { var savedPer = +localStorage.getItem('ensaio-per'); if (PER_OPTS.indexOf(savedPer) >= 0) lib.per = savedPer; } catch(e){}
function perSelect(id){
  return '<label class="per">Mostrar <select id="' + id + '">' + PER_OPTS.map(function(n){ return '<option value="' + n + '"' + (n === lib.per ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select> por página</label>';
}
function setPer(n){ lib.per = n; try { localStorage.setItem('ensaio-per', String(n)); } catch(e){} }
/* Busca no nome e, se não achar no nome, num verso da letra. Sem diferença de maiúsculas e acentos. */
function searchSongs(query, inLyrics){
  var q = normTitle(query), all = sortedSongs();
  if (!q) return all.map(function(s){ return { s:s }; });
  var byTitle = [], byLyric = [];
  all.forEach(function(s){
    if (normTitle(s.title).indexOf(q) >= 0) { byTitle.push({ s:s }); return; }
    if (!inLyrics) return;
    var l = s.lyrics.find(function(x){ return x.text && normTitle(x.text).indexOf(q) >= 0; });
    if (l) byLyric.push({ s:s, line:l.text });
  });
  return byTitle.concat(byLyric);
}
function pageOf(list, page, per){
  var pages = Math.max(1, Math.ceil(list.length / per));
  page = Math.min(Math.max(0, page), pages - 1);
  return { page:page, pages:pages, from:page * per, items:list.slice(page * per, page * per + per) };
}
function pagerHtml(pg, total, attr){
  if (total <= lib.per) return '';
  return '<div class="pager"><button class="btn sec" ' + attr + '="prev"' + (pg.page === 0 ? ' disabled' : '') + '>‹ Anterior</button>' +
    '<span class="pg-info">' + (pg.from + 1) + '–' + (pg.from + pg.items.length) + ' de ' + total + '</span>' +
    '<button class="btn sec" ' + attr + '="next"' + (pg.page >= pg.pages - 1 ? ' disabled' : '') + '>Próxima ›</button></div>';
}
function libraryShell(m){
  m.innerHTML = '<div class="lib-tools"><input type="search" id="libSearch" class="field search" placeholder="Buscar por nome ou trecho da letra" aria-label="Buscar músicas" autocomplete="off" enterkeyhint="search">' +
    perSelect('libPer') + '</div><div id="libList" aria-live="polite"></div><div id="libRest"></div>';
  var inp = $('#libSearch'), t;
  inp.value = lib.q;
  inp.addEventListener('input', function(){ clearTimeout(t); t = setTimeout(function(){ lib.q = inp.value; lib.page = 0; renderLibList(); }, 150); });
  inp.addEventListener('keydown', function(e){ if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape' && inp.value) { e.stopPropagation(); inp.value = ''; lib.q = ''; lib.page = 0; renderLibList(); } });
  $('#libPer').addEventListener('change', function(e){ setPer(+e.target.value); lib.page = 0; renderLibList(); });
}
function libResults(){ return searchSongs(lib.q, true); }
function renderLibList(){
  var box = $('#libList'); if (!box) return;
  var res = libResults(), pg = pageOf(res, lib.page, lib.per);
  lib.page = pg.page;
  var head = '';
  if (lib.q.trim()) head = '<p class="lib-count">' + (res.length ? res.length + (res.length === 1 ? ' música encontrada' : ' músicas encontradas') : 'Nada encontrado para “' + esc(lib.q.trim()) + '”') +
    ' <button class="link-btn" data-act="clearsearch">Limpar busca</button></p>';
  box.innerHTML = head + pg.items.map(function(r){ return songRow(r.s, null, r.line ? 'na letra: “' + r.line + '”' : null); }).join('') + pagerHtml(pg, res.length, 'data-pg');
}

/* Limite de espaço do próprio app: soma dos áudios guardados */
var STORAGE_LIMIT = 1024 * 1048576; /* 1 GB */
function usedBytes(){ return state.songs.reduce(function(n, s){ return n + (s.size || 0); }, 0); }
function freeBytes(){ return Math.max(0, STORAGE_LIMIT - usedBytes()); }
function fmtSize(b){
  if (b >= 1024 * 1048576 * 0.995) return String(+(b / (1024 * 1048576)).toFixed(1)).replace('.', ',') + ' GB';
  if (b > 0 && b < 1048576) return 'menos de 1 MB';
  return Math.round(b / 1048576) + ' MB';
}
function showUsage(){
  var el = $('#usage'); if (!el) return;
  var counting = state.songs.some(function(s){ return s.size == null; });
  var used = usedBytes(), pct = Math.min(100, used / STORAGE_LIMIT * 100), full = pct >= 90;
  el.className = 'storage' + (full ? ' warn' : '');
  el.innerHTML = '<div class="st-row"><span class="st-k">Espaço do Ensaio</span><span class="st-v">' + (counting ? 'Calculando…' : fmtSize(used) + ' de ' + fmtSize(STORAGE_LIMIT)) + '</span></div>' +
    '<div class="st-bar" role="progressbar" aria-label="Espaço usado" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '"><span style="width:' + pct.toFixed(1) + '%"></span></div>' +
    (counting ? '' : '<p class="st-free">' + (freeBytes() < 1048576 ? 'Cheio. Exclua músicas que saíram do repertório para adicionar outras.' :
      'Faltam ' + fmtSize(freeBytes()) + (full ? '. Está quase cheio: exclua músicas que saíram do repertório.' : ' para novas músicas.')) + '</p>');
}
async function backfillSizes(){
  /* Músicas guardadas antes do limite não sabem o próprio tamanho: mede uma de cada vez */
  var todo = state.songs.filter(function(s){ return s.size == null; });
  for (var i = 0; i < todo.length; i++) {
    var s = todo[i], a = await loadAudio(s.id);
    s.size = a && a.buf ? a.buf.byteLength : 0;
    a = null;
    try { await save('songs', s); } catch(e){}
  }
  if (todo.length && state.view === 'library') showUsage();
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
  box.classList.toggle('syncing', !!state.sync || !!state.adjust);
  if (!s) { box.innerHTML = '<div class="l-empty"><p>Escolha uma música para começar.</p></div>'; return; }
  if (!s.lyrics.length) { box.innerHTML = '<div class="l-empty"><p>Esta música ainda não tem letra.</p><button class="btn" data-act="editlyrics">Adicionar letra</button></div>'; return; }
  var synced = s.lyrics.some(function(l){ return l.t != null; });
  var useSpacer = synced || state.sync;
  box.innerHTML = (useSpacer ? '<div class="spacer"></div>' : '<p class="hint">Esta letra ainda não tem tempos. Toque em “Sincronizar” e marque o começo de cada verso enquanto a música toca.</p>') +
    s.lyrics.map(function(l, i){
      return l.text ? '<div class="line' + (l.t != null ? ' timed' : '') + '" data-act="line" data-i="' + i + '">' + esc(l.text) + (l.note ? '<span class="lnote">' + esc(l.note) + '</span>' : '') + '</div>' : '<div class="gap"></div>';
    }).join('') + '<p class="lhint">Segure uma linha para escrever uma anotação nela.</p><div class="spacer"></div>';
  if (state.sync || state.adjust) markTarget();
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
  if (a >= 0 && !state.sync && !state.adjust && playerOpen) centerLine(a);
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
  var syncing = !!state.sync, adj = state.adjust;
  $('#tools').hidden = syncing || !!adj; $('#syncBar').hidden = !syncing; $('#adjBar').hidden = !adj;
  if (adj) renderAdjust();
}
async function playAt(i){
  if (i < 0 || i >= state.queue.length) return;
  if (state.sync) finishSync(true);
  if (state.adjust) finishAdjust(true);
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
  if (state.adjust) finishAdjust(true);
  if (!s.lyrics.some(function(l){ return l.text; })) { toast('Adicione a letra antes de sincronizar'); lyricsEditor(s); return; }
  state.sync = {
    idx: nextLine(s, 0),
    originalTimes: s.lyrics.map(function(l){
      return Object.prototype.hasOwnProperty.call(l, 't') ? { present:true, value:l.t } : { present:false };
    })
  };
  renderTools(); renderLyrics();
  centerLine(state.sync.idx, true);
  toast('Dê play e toque em “Marcar linha” no começo de cada verso');
}
function markTarget(){
  var box = $('#lyrics');
  box.querySelectorAll('.line.target').forEach(function(el){ el.classList.remove('target'); });
  var idx = state.sync ? state.sync.idx : state.adjust ? state.adjust.idx : -1;
  if (idx < 0) return;
  var el = box.querySelector('.line[data-i="' + idx + '"]');
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
function cancelSync(){
  var s = curSong(), sy = state.sync;
  if (!s || !sy) return;
  clearTimeout(saveTimers[s.id]);
  delete saveTimers[s.id];
  s.lyrics.forEach(function(l, i){
    var original = sy.originalTimes[i];
    if (original && original.present) l.t = original.value;
    else delete l.t;
  });
  state.sync = null;
  save('songs', s).catch(function(){ toast('Não foi possível salvar a letra'); });
  renderTools(); renderLyrics(); renderView(); renderMini();
  toast('Sincronização cancelada');
}
function snapshotTimes(s){
  return s.lyrics.map(function(l){
    return Object.prototype.hasOwnProperty.call(l, 't') ? { present:true, value:l.t } : { present:false };
  });
}
function restoreTimes(s, snap){
  s.lyrics.forEach(function(l, i){
    var o = snap[i];
    if (o && o.present) l.t = o.value; else delete l.t;
  });
}

/* ---------- Ajuste fino dos tempos ---------- */
function timedIdx(s){ var out = []; s.lyrics.forEach(function(l, i){ if (l.t != null && l.text) out.push(i); }); return out; }
function startAdjust(){
  var s = curSong(); if (!s) return;
  var timed = timedIdx(s);
  if (!timed.length) { toast('Sincronize a letra primeiro'); return; }
  if (state.sync) finishSync(true);
  var a = activeIdx(s.lyrics, audio.currentTime);
  var idx = timed.indexOf(a) >= 0 ? a : timed[0];
  state.adjust = { idx:idx, scope:'line', original:snapshotTimes(s) };
  renderTools(); renderLyrics();
  centerLine(idx, true);
  toast('Toque num verso e use os botões para adiantar ou atrasar');
}
function renderAdjust(){
  var adj = state.adjust, s = curSong(); if (!adj || !s) return;
  document.querySelectorAll('#adjBar [data-scope]').forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.scope === adj.scope ? 'true' : 'false'); });
  var l = s.lyrics[adj.idx];
  $('#aTime').textContent = l && l.t != null ? stamp(l.t) : '—';
}
function nudge(delta){
  var s = curSong(), adj = state.adjust; if (!s || !adj) return;
  var timed = timedIdx(s), k = timed.indexOf(adj.idx);
  if (k < 0) return;
  var dur = isFinite(audio.duration) ? audio.duration : Infinity;
  var targets, lo, hi;
  if (adj.scope === 'line') {
    targets = [adj.idx];
    lo = k > 0 ? s.lyrics[timed[k-1]].t + 0.1 : 0;
    hi = k < timed.length - 1 ? s.lyrics[timed[k+1]].t - 0.1 : dur;
  } else {
    targets = adj.scope === 'all' ? timed : timed.slice(k);
    lo = adj.scope === 'all' || k === 0 ? 0 : s.lyrics[timed[k-1]].t + 0.1;
    hi = dur;
  }
  var firstT = s.lyrics[targets[0]].t, lastT = s.lyrics[targets[targets.length-1]].t;
  var d = delta;
  if (firstT + d < lo) d = lo - firstT;
  if (lastT + d > hi) d = hi - lastT;
  if (d * delta < 0) d = 0; /* já estava colado no vizinho: não anda para o lado contrário */
  d = +d.toFixed(2);
  if (d === 0) { toast(adj.scope === 'line' ? 'Não dá para passar do verso vizinho' : 'Chegou no limite'); return; }
  targets.forEach(function(i){ s.lyrics[i].t = Math.max(0, +(s.lyrics[i].t + d).toFixed(2)); });
  if (d !== delta) toast(adj.scope === 'line' ? 'Parou no tempo do verso vizinho' : 'Parou no limite');
  saveSongSoon(s); lastActive = -2;
  renderAdjust();
  audio.currentTime = Math.max(0, s.lyrics[adj.idx].t - 2);
  if (audio.paused) audio.play().catch(function(){});
}
function finishAdjust(silent){
  var s = curSong();
  if (s && state.adjust) { clearTimeout(saveTimers[s.id]); delete saveTimers[s.id]; save('songs', s).catch(function(){ toast('Não foi possível salvar a letra'); }); }
  state.adjust = null;
  if (!silent) { renderTools(); renderLyrics(); renderView(); }
}
function cancelAdjust(){
  var s = curSong(), adj = state.adjust;
  if (!s || !adj) return;
  clearTimeout(saveTimers[s.id]); delete saveTimers[s.id];
  restoreTimes(s, adj.original);
  state.adjust = null;
  save('songs', s).catch(function(){ toast('Não foi possível salvar a letra'); });
  lastActive = -2;
  renderTools(); renderLyrics(); renderView();
  toast('Ajuste cancelado');
}

/* ---------- Janelas ---------- */
var cancelFn = null, modalOpenedAt = 0;
function modal(html, onCancel){
  modalOpenedAt = Date.now();
  $('#sheet').innerHTML = html; $('#modal').hidden = false; cancelFn = onCancel || null;
  var f = $('#sheet').querySelector('[autofocus]'); if (f) setTimeout(function(){ f.focus(); }, 50);
}
function closeModal(){ $('#modal').hidden = true; $('#sheet').innerHTML = ''; $('#sheet').onclick = null; $('#sheet').onchange = null; cancelFn = null; }
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
    modal('<h2>Escolher músicas</h2>' +
      '<div class="pick-tools"><input type="search" id="pickSearch" class="field search" placeholder="Buscar pelo nome" aria-label="Buscar músicas" autocomplete="off" enterkeyhint="search"></div>' +
      '<p class="pick-count" id="pickCount"></p><div id="pickList"></div>' +
      '<div class="m-actions"><button class="btn sec" data-m="x">Cancelar</button><button class="btn" data-m="ok">Salvar</button></div>', function(){ res(null); });
    var picked = selected.filter(function(id){ return !!songById(id); }), pq = '', pp = 0, pt;
    function renderPick(){
      var list = searchSongs(pq, false), pg = pageOf(list, pp, lib.per);
      pp = pg.page;
      $('#pickCount').textContent = picked.length + (picked.length === 1 ? ' selecionada' : ' selecionadas') + ' · entram na ordem em que você marca' +
        (pq.trim() && !list.length ? ' · nada encontrado' : '');
      $('#pickList').innerHTML = pg.items.map(function(r){
        var s = r.s, n = picked.indexOf(s.id);
        return '<label class="pick"><input type="checkbox" value="' + s.id + '"' + (n >= 0 ? ' checked' : '') + '><span>' + esc(s.title) + '</span>' + (n >= 0 ? '<span class="pick-n">' + (n + 1) + '</span>' : '') + '</label>';
      }).join('') + pagerHtml(pg, list.length, 'data-ppg');
    }
    renderPick();
    var ps = $('#pickSearch');
    ps.addEventListener('input', function(){ clearTimeout(pt); pt = setTimeout(function(){ pq = ps.value; pp = 0; renderPick(); }, 150); });
    ps.addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); ps.blur(); } });
    $('#sheet').onchange = function(e){
      var v = e.target.value; if (!v || e.target.type !== 'checkbox') return;
      if (e.target.checked) { if (picked.indexOf(v) < 0) picked.push(v); } else picked = picked.filter(function(x){ return x !== v; });
      renderPick();
    };
    $('#sheet').onclick = function(e){
      var g = e.target.closest('[data-ppg]');
      if (g) { if (!g.disabled) { pp += g.dataset.ppg === 'next' ? 1 : -1; renderPick(); $('#sheet').scrollTop = 0; } return; }
      var b = e.target.closest('[data-m]'); if (!b) return; closeModal(); res(b.dataset.m === 'ok' ? picked : null);
    };
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
  if (state.adjust) finishAdjust();
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

/* ---------- Exportar e importar dados (letras, observações, playlists; sem áudio) ---------- */
function normTitle(t){ return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_\s]+/g, ' ').trim().toLowerCase(); }
function pendingBlock(){
  if (!state.pending.length) return '';
  var names = state.pending.slice().sort(function(a,b){ return a.title.localeCompare(b.title, 'pt-BR'); }).map(function(p){ return p.title; });
  return '<div class="pending"><h3>Esperando o áudio (' + names.length + ')</h3><p>Letras importadas de músicas que ainda não estão neste aparelho. Adicione um arquivo de áudio com o mesmo nome e a letra entra sozinha.</p>' +
    '<p class="pending-list">' + esc(names.join(' · ')) + '</p><button class="btn ghost" data-act="droppending">Descartar estas letras</button></div>';
}
function cleanLyrics(arr){
  if (!Array.isArray(arr)) return [];
  return arr.filter(function(l){ return l && typeof l === 'object'; }).map(function(l){
    var o = { text: typeof l.text === 'string' ? l.text.slice(0, 500) : '' };
    if (typeof l.t === 'number' && isFinite(l.t) && l.t >= 0) o.t = +l.t.toFixed(2); else if ('t' in l) o.t = null;
    if (typeof l.note === 'string' && l.note.trim()) o.note = l.note.slice(0, 200);
    return o;
  });
}
function buildExport(){
  var songs = state.songs.map(function(s){
    return { title:s.title, notes:s.notes || '', duration:s.duration || null, lyrics:cleanLyrics(s.lyrics) };
  }).concat(state.pending.map(function(p){
    return { title:p.title, notes:p.notes || '', duration:p.duration || null, lyrics:cleanLyrics(p.lyrics) };
  }));
  var playlists = state.playlists.map(function(p){
    var order = p.songIds.map(function(id){ var s = songById(id); return s ? s.title : null; }).filter(Boolean);
    (p.pendingTitles || []).slice().sort(function(a,b){ return a.pos - b.pos; }).forEach(function(x){ order.splice(Math.min(x.pos, order.length), 0, x.title); });
    return { name:p.name, songs:order };
  });
  return { app:'ensaio', kind:'dados', version:1, exportedAt:new Date().toISOString(), songs:songs, playlists:playlists };
}
function downloadBlob(name, text, type){
  var url = URL.createObjectURL(new Blob([text], { type:type }));
  var a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
}
function exportData(){
  if (!state.songs.length && !state.pending.length) { toast('Ainda não há nada para exportar'); return; }
  var data = buildExport(), text = JSON.stringify(data, null, 1);
  var d = new Date(), pad = function(n){ return (n < 10 ? '0' : '') + n; };
  var name = 'ensaio-dados-' + d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + '.json';
  var file = null, canShare = false;
  try { file = new File([text], name, { type:'application/json' }); } catch(e){}
  try { canShare = !!(file && navigator.canShare && navigator.canShare({ files:[file] })); } catch(e){}
  var nS = data.songs.length, nP = data.playlists.length;
  var withLyr = data.songs.filter(function(s){ return s.lyrics.length; }).length;
  modal('<h2>Exportar dados</h2><p>Um arquivo com ' + nS + (nS === 1 ? ' música' : ' músicas') + ' (' + withLyr + ' com letra), as observações, as anotações nos versos e ' + nP + (nP === 1 ? ' playlist' : ' playlists') + '. ' +
    '<b>Os áudios não vão junto</b>: no outro aparelho, importe este arquivo e adicione os áudios com os mesmos nomes.</p>' +
    '<p class="small">Tamanho: ' + Math.max(1, Math.round(text.length / 1024)) + ' KB · ' + esc(name) + '</p>' +
    '<div class="m-actions"><button class="btn ghost" data-m="x">Fechar</button><span class="grow"></span>' +
    '<button class="btn' + (canShare ? ' sec' : '') + '" data-m="dl">Baixar arquivo</button>' +
    (canShare ? '<button class="btn" data-m="share">Compartilhar</button>' : '') + '</div>');
  $('#sheet').onclick = function(e){
    var b = e.target.closest('[data-m]'); if (!b) return;
    var m = b.dataset.m;
    if (m === 'x') { closeModal(); return; }
    if (m === 'share') {
      navigator.share({ files:[file], title:'Dados do Ensaio' }).then(function(){ toast('Dados compartilhados'); })
        .catch(function(err){ if (!err || err.name !== 'AbortError') toast('Não deu para compartilhar daqui. Use Baixar arquivo.'); });
    } else if (m === 'dl') {
      if (downloadsNs) {
        downloadsNs.save({ filename: name + '.txt', data: text }).then(function(){ toast('Arquivo salvo'); })
          .catch(function(err){ if (err && err.code === 'declined') return; toast('Não foi possível baixar o arquivo'); });
      } else {
        try { downloadBlob(name, text, 'application/json'); toast('Arquivo baixado'); } catch(err){ toast('Não foi possível baixar o arquivo'); }
      }
    }
  };
}
function parseImport(text){
  var data;
  try { data = JSON.parse(text); } catch(e){ return null; }
  if (!data || data.app !== 'ensaio' || !Array.isArray(data.songs)) return null;
  return {
    songs: data.songs.filter(function(s){ return s && typeof s.title === 'string' && s.title.trim(); }).map(function(s){
      return { title:s.title.trim().slice(0, 120), notes: typeof s.notes === 'string' ? s.notes.slice(0, 1000) : '',
        duration: typeof s.duration === 'number' && isFinite(s.duration) ? s.duration : null, lyrics:cleanLyrics(s.lyrics) };
    }),
    playlists: (Array.isArray(data.playlists) ? data.playlists : []).filter(function(p){ return p && typeof p.name === 'string' && p.name.trim() && Array.isArray(p.songs); }).map(function(p){
      return { name:p.name.trim().slice(0, 120), songs:p.songs.filter(function(t){ return typeof t === 'string' && t.trim(); }) };
    })
  };
}
function matchSongs(titles){
  /* Liga cada título importado a uma música daqui com o mesmo nome (sem diferença de maiúsculas, acentos ou _). */
  var used = {}, out = {};
  titles.forEach(function(t){
    var k = normTitle(t);
    if (k in out) return;
    var s = state.songs.find(function(x){ return !used[x.id] && normTitle(x.title) === k; });
    if (s) used[s.id] = true;
    out[k] = s || null;
  });
  return out;
}
async function importData(text){
  var data = parseImport(text);
  if (!data) { toast('Este arquivo não é um arquivo de dados do Ensaio'); return; }
  if (!data.songs.length && !data.playlists.length) { toast('O arquivo está vazio'); return; }
  var match = matchSongs(data.songs.map(function(s){ return s.title; }));
  var found = data.songs.filter(function(s){ return match[normTitle(s.title)]; });
  var missing = data.songs.filter(function(s){ return !match[normTitle(s.title)]; });
  var plSame = data.playlists.filter(function(p){ return state.playlists.some(function(x){ return normTitle(x.name) === normTitle(p.name); }); }).length;
  var parts = [];
  if (found.length) parts.push('<li><b>' + found.length + (found.length === 1 ? ' música' : ' músicas') + '</b> deste aparelho ' + (found.length === 1 ? 'recebe' : 'recebem') + ' a letra, as observações e as anotações do arquivo. O que elas têm hoje é substituído.</li>');
  if (missing.length) parts.push('<li><b>' + missing.length + (missing.length === 1 ? ' música' : ' músicas') + '</b> ainda não ' + (missing.length === 1 ? 'está' : 'estão') + ' aqui. A letra fica esperando: ao adicionar um áudio com o mesmo nome, ela entra sozinha.</li>');
  if (data.playlists.length) parts.push('<li><b>' + data.playlists.length + (data.playlists.length === 1 ? ' playlist' : ' playlists') + '</b>' + (plSame ? ' (' + plSame + ' com nome igual a uma daqui, que terá a ordem substituída)' : '') + '.</li>');
  var ok = await new Promise(function(res){
    modal('<h2>Importar dados</h2><ul class="imp-sum">' + parts.join('') + '</ul><p class="small">Os áudios não estão no arquivo. Nada é apagado deste aparelho.</p>' +
      '<div class="m-actions"><button class="btn sec" data-m="x">Cancelar</button><button class="btn" data-m="ok">Importar</button></div>', function(){ res(false); });
    $('#sheet').onclick = function(e){ var b = e.target.closest('[data-m]'); if (!b) return; closeModal(); res(b.dataset.m === 'ok'); };
  });
  if (!ok) return;
  if (state.sync) finishSync(true);
  if (state.adjust) finishAdjust(true);
  try {
    for (var i = 0; i < found.length; i++) {
      var src = found[i], s = match[normTitle(src.title)];
      s.lyrics = src.lyrics; s.notes = src.notes;
      if (!s.duration && src.duration) s.duration = src.duration;
      await save('songs', s);
    }
    for (var j = 0; j < missing.length; j++) {
      var m = missing[j], pid = normTitle(m.title);
      var pend = { id:pid, title:m.title, lyrics:m.lyrics, notes:m.notes, duration:m.duration };
      await save('pending', pend);
      state.pending = state.pending.filter(function(p){ return p.id !== pid; }).concat([pend]);
    }
    for (var k = 0; k < data.playlists.length; k++) {
      var ip = data.playlists[k];
      var pl = state.playlists.find(function(x){ return normTitle(x.name) === normTitle(ip.name); });
      if (!pl) { pl = { id:uid(), name:ip.name, songIds:[] }; state.playlists.push(pl); }
      var plMatch = matchSongs(ip.songs), ids = [], waiting = [];
      ip.songs.forEach(function(t){
        var s2 = plMatch[normTitle(t)];
        if (s2 && ids.indexOf(s2.id) < 0) ids.push(s2.id);
        else if (!s2) waiting.push({ title:t, pos:ids.length + waiting.length });
      });
      pl.songIds = ids;
      if (waiting.length) pl.pendingTitles = waiting; else delete pl.pendingTitles;
      await save('playlists', pl);
    }
  } catch(err) {
    toast('A importação parou no meio: ' + (err && err.message ? err.message : 'erro ao salvar'));
    render(); return;
  }
  render(); if (playerOpen) renderPlayer(); else renderMini();
  toast('Dados importados');
}
async function applyPending(song){
  var k = normTitle(song.title), changed = false;
  var p = state.pending.find(function(x){ return x.id === k; });
  if (p) {
    song.title = p.title; song.lyrics = p.lyrics || []; song.notes = p.notes || '';
    await save('songs', song);
    state.pending = state.pending.filter(function(x){ return x !== p; });
    await remove('pending', p.id);
    changed = true;
  }
  for (var i = 0; i < state.playlists.length; i++) {
    var pl = state.playlists[i], w = pl.pendingTitles || [];
    var hit = w.find(function(x){ return normTitle(x.title) === k; });
    if (!hit) continue;
    /* pos é a posição na ordem completa; descontar as que ainda esperam antes dela */
    var before = w.filter(function(x){ return x !== hit && x.pos < hit.pos; }).length;
    pl.songIds.splice(Math.min(hit.pos - before, pl.songIds.length), 0, song.id);
    pl.pendingTitles = w.filter(function(x){ return x !== hit; });
    if (!pl.pendingTitles.length) delete pl.pendingTitles;
    await save('playlists', pl);
    changed = true;
  }
  return changed;
}
$('#dataFile').addEventListener('change', async function(e){
  var f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (f.size > 20 * 1048576) { toast('Arquivo grande demais para ser de dados do Ensaio'); return; }
  try { await importData(await f.text()); } catch(err){ toast('Não foi possível ler o arquivo'); }
});

/* ---------- Ações ---------- */
async function addFiles(files){
  var added = 0, restored = 0, skipped = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i], id = uid();
    if (usedBytes() + f.size > STORAGE_LIMIT) { skipped.push(f.name); continue; }
    toast('Guardando ' + (i+1) + ' de ' + files.length + '…');
    try {
      var buf = await f.arrayBuffer();
      var title = f.name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim() || 'Sem título';
      var song = { id:id, title:title, lyrics:[], duration:null, added:Date.now(), size:buf.byteLength };
      if (db) await save('audio', { id:id, buf:buf, type:f.type || 'audio/mpeg' });
      else mem.audio.set(id, { id:id, buf:buf, type:f.type || 'audio/mpeg' });
      await save('songs', song);
      state.songs.push(song); added++;
      try { if (await applyPending(song)) restored++; } catch(e){}
    } catch(err) {
      await remove('audio', id);
      toast('Sem espaço para guardar “' + f.name + '”');
      await new Promise(function(r){ setTimeout(r, 1500); });
    }
  }
  var msg = [];
  if (added) msg.push((added === 1 ? 'Música adicionada' : added + ' músicas adicionadas') +
    (restored ? (restored === 1 ? '. 1 recebeu a letra importada' : '. ' + restored + ' receberam a letra importada') : ''));
  if (skipped.length) msg.push((skipped.length === 1 ? '“' + skipped[0] + '” não coube' : skipped.length + ' músicas não couberam') +
    ' no limite de ' + fmtSize(STORAGE_LIMIT) + ' (faltam ' + fmtSize(freeBytes()) + '). Exclua músicas que saíram do repertório');
  if (msg.length) toast(msg.join('. '), skipped.length ? 6000 : 0);
  render();
}
async function addRequest(){
  if (freeBytes() < 1048576) { toast('O espaço de ' + fmtSize(STORAGE_LIMIT) + ' do Ensaio está cheio. Exclua músicas que saíram do repertório para adicionar outras.', 6000); return; }
  $('#file').click();
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
    state.queue = []; state.qi = -1; state.sync = null; state.adjust = null; closePlayer();
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

document.addEventListener('click', function(e){
  var b = e.target.closest('#libList [data-pg]'); if (!b || b.disabled) return;
  lib.page += b.dataset.pg === 'next' ? 1 : -1;
  renderLibList();
  var tools = $('.lib-tools'); $('#main').scrollTop = tools ? tools.offsetTop - 8 : 0;
});
document.addEventListener('click', async function(e){
  var b = e.target.closest('[data-act]'); if (!b) return;
  var act = b.dataset.act, id = b.dataset.id, i = +b.dataset.i, p = plById(state.openPl);
  switch (act) {
    case 'tab': state.view = b.dataset.v; render(); $('#main').scrollTop = 0; break;
    case 'add': addRequest(); break;
    case 'export': exportData(); break;
    case 'theme': themeMenu(); break;
    case 'import': $('#dataFile').value = ''; $('#dataFile').click(); break;
    case 'droppending':
      if (!(await confirmBox('Descartar as letras de ' + state.pending.length + (state.pending.length === 1 ? ' música que ainda não tem' : ' músicas que ainda não têm') + ' áudio aqui?', 'Descartar'))) break;
      for (var dp = 0; dp < state.pending.length; dp++) await remove('pending', state.pending[dp].id);
      state.pending = [];
      for (var dq = 0; dq < state.playlists.length; dq++) { var dpl = state.playlists[dq]; if (dpl.pendingTitles) { delete dpl.pendingTitles; await save('playlists', dpl); } }
      toast('Letras descartadas'); render(); break;
    case 'play':
      /* Com busca ativa, a fila são os resultados da busca (todos, não só a página) */
      var searching = !!lib.q.trim();
      var list = libResults().map(function(r){ return r.s.id; });
      playQueue(list, list.indexOf(id), searching ? 'Busca “' + lib.q.trim() + '”' : 'Todas as músicas'); break;
    case 'clearsearch': lib.q = ''; lib.page = 0; if ($('#libSearch')) $('#libSearch').value = ''; renderLibList(); break;
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
      if (state.adjust) {
        if (!s.lyrics[i] || s.lyrics[i].t == null) { toast('Este verso não tem tempo. Use Sincronizar.'); break; }
        state.adjust.idx = i; markTarget(); renderAdjust(); break;
      }
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
    { label: s.lyrics.length ? 'Editar letra' : 'Adicionar letra', fn:function(){ lyricsEditor(s); } }
  ].concat(timedIdx(s).length ? [{ label:'Ajustar tempos (±1s, ±5s, ±10s)', fn:startAdjust }] : [])
   .concat([{ label:'Exportar letra (.lrc)', fn:function(){ exportLrc(s); } }]));
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
$('#bSync').onclick = function(){
  var s = curSong(); if (!s) return;
  if (!timedIdx(s).length) { startSync(); return; }
  actionSheet('Tempos da letra', [
    { label:'Ajustar tempos (±1s, ±5s, ±10s)', fn:startAdjust },
    { label:'Sincronizar de novo, verso por verso', fn:startSync }
  ]);
};
$('#adjBar').addEventListener('click', function(e){
  var b = e.target.closest('button'); if (!b || !state.adjust) return;
  if (b.dataset.adj) nudge(+b.dataset.adj);
  else if (b.dataset.scope) { state.adjust.scope = b.dataset.scope; renderAdjust(); }
  else if (b.id === 'aDone') { finishAdjust(); toast('Tempos salvos'); }
  else if (b.id === 'aCancel') cancelAdjust();
});
$('#sMark').onclick = markLine;
$('#sUndo').onclick = undoLine;
$('#sDone').onclick = function(){ finishSync(); toast('Sincronização salva'); };
$('#sCancel').onclick = cancelSync;
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
  if (state.adjust) { setPlayIcons(); return; }
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
  state.pending = await loadAll('pending');
  render();
  backfillSizes().catch(function(){});
  requestAnimationFrame(tick);
  try { if (window.claude && typeof window.claude.use === 'function') downloadsNs = await window.claude.use('downloads'); } catch(e){ downloadsNs = null; }
})();
})();
