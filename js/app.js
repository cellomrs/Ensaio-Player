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
var state = { songs:[], playlists:[], pending:[], queue:[], qi:-1, queueName:'', view:'library', openPl:null, sync:null, adjust:null, loopA:null, loopB:null, loopPart:null, rate:1 };
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
function hideToast(){ clearTimeout(toastTimer); $('#toast').classList.remove('show'); }
function songById(id){ return state.songs.find(function(s){ return s.id === id; }); }
function plById(id){ return state.playlists.find(function(p){ return p.id === id; }); }
function sortedSongs(){ return state.songs.slice().sort(function(a,b){ return a.title.localeCompare(b.title, 'pt-BR'); }); }
function curSong(){ return state.qi >= 0 ? songById(state.queue[state.qi]) : null; }
function lyricStatus(s){
  if (!s.lyrics.length) return 'sem letra';
  return s.lyrics.some(function(l){ return l.t != null; }) ? 'letra sincronizada' : 'letra sem tempos';
}
function songSub(s){ return (s.duration ? fmt(s.duration) + ', ' : '') + (hasVersions(s) ? s.versions.length + ' versões, ' : '') + lyricStatus(s) + (s.notes || s.lyrics.some(function(l){ return l.note || (l.vnotes && l.vnotes.length); }) ? ', com observações' : ''); }

/* ---------- Letras ---------- */
var STAMP_RE = /^\s*\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/;
function takeStamps(raw){
  var rest = raw, tags = [], m;
  while ((m = STAMP_RE.exec(rest))) { tags.push(+m[1]*60 + parseFloat(m[2].replace(':','.'))); rest = rest.slice(m[0].length); }
  return { tags:tags, rest:rest, prefix:raw.slice(0, raw.length - rest.length) };
}
function isBlank(l){ return !l.text && l.t == null && !(l.chords && l.chords.length); }
function parseLyrics(txt){
  var out = [];
  mergeChordLines(txt.replace(/\r/g,'').split('\n')).forEach(function(raw){
    if (/^\s*\[(ar|ti|al|by|offset|length|re|ve|au|#)\s*:/i.test(raw)) return;
    if (/^\s*\{[^}]*\}\s*$/.test(raw)) return;   /* diretivas ChordPro, como {title: …} */
    var st = takeStamps(raw), sc = splitChords(st.rest);
    function line(t){ var l = { t:t, text:sc.text }; if (sc.chords.length) l.chords = sc.chords.map(function(c){ return { i:c.i, c:c.c }; }); return l; }
    if (st.tags.length) st.tags.forEach(function(t){ out.push(line(+t.toFixed(2))); });
    else out.push(line(null));
  });
  var allTimed = out.some(function(l){ return l.t != null; }) && out.every(function(l){ return l.t != null || isBlank(l); });
  if (allTimed) out = out.filter(function(l){ return l.t != null; }).sort(function(a,b){ return a.t - b.t; });
  var clean = [];
  out.forEach(function(l){
    if (isBlank(l) && (!clean.length || isBlank(clean[clean.length-1]))) return;
    clean.push(l);
  });
  while (clean.length && isBlank(clean[clean.length-1])) clean.pop();
  return clean;
}
function lyricsToText(lines, withChords){
  return lines.map(function(l){
    var body = withChords && l.chords && l.chords.length ? joinChords(l.text, l.chords) : l.text;
    return l.t != null ? '[' + stamp(l.t) + ']' + body : body;
  }).join('\n');
}

/* ---------- Cifras: acordes guardados à parte do texto ({ i: posição no texto, c: acorde }) ---------- */
var CHORD_RE = /^[A-G](?:#|b)?(?:m|M|maj|min|dim|aug|sus|add|º|°|ø|\+|-|\d|\(|\)|#|b|\/[A-G](?:#|b)?)*$/;
function isChord(tok){ return CHORD_RE.test(tok); }
function splitChords(raw){
  var text = '', chords = [], last = 0, m, re = /\[([^\]\s]{1,12})\]/g;
  while ((m = re.exec(raw))) {
    if (!isChord(m[1])) continue;
    text += raw.slice(last, m.index); chords.push({ i:text.length, c:m[1] }); last = m.index + m[0].length;
  }
  text += raw.slice(last);
  var lead = text.length - text.replace(/^\s+/, '').length;
  text = text.trim();
  chords.forEach(function(c){ c.i = Math.max(0, Math.min(text.length, c.i - lead)); });
  return { text:text, chords:chords };
}
function joinChords(text, chords){
  if (!chords || !chords.length) return text;
  if (!text) return chords.map(function(c){ return '[' + c.c + ']'; }).join(' ');
  var out = text;
  chords.slice().sort(function(a, b){ return b.i - a.i; }).forEach(function(c){ out = out.slice(0, c.i) + '[' + c.c + ']' + out.slice(c.i); });
  return out;
}
/* Formato dos sites de cifra: uma linha só com acordes em cima do verso */
function isChordLine(str){
  if (!str.trim() || /[\[\]{}:]/.test(str)) return false;
  var toks = str.trim().split(/\s+/), n = 0;
  for (var i = 0; i < toks.length; i++) {
    if (isChord(toks[i])) n++;
    else if (!/^(\||-+|–|\.+|\(?\d+x\)?)$/i.test(toks[i])) return false;
  }
  return n > 0;
}
function mergeChordLines(lines){
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var cur = lines[i];
    if (!isChordLine(cur)) { out.push(cur); continue; }
    var next = lines[i + 1], st = next != null ? takeStamps(next) : null;
    if (next != null && st.rest.trim() && !isChordLine(next)) {
      var lyr = st.rest, m, re = /\S+/g, ins = [];
      while ((m = re.exec(cur))) if (isChord(m[0])) ins.push({ col:m.index, c:m[0] });
      ins.sort(function(a, b){ return b.col - a.col; }).forEach(function(x){
        while (lyr.length < x.col) lyr += ' ';
        lyr = lyr.slice(0, x.col) + '[' + x.c + ']' + lyr.slice(x.col);
      });
      out.push(st.prefix + lyr); i++;
    } else {
      out.push(cur.trim().split(/\s+/).filter(isChord).map(function(c){ return '[' + c + ']'; }).join(' '));
    }
  }
  return out;
}
var NOTES_S = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'], NOTES_F = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
var NOTE_ALIAS = { 'E#':'F', 'B#':'C', 'Fb':'E', 'Cb':'B' };
function transposeNote(note, n, flat){
  note = NOTE_ALIAS[note] || note;
  var k = NOTES_S.indexOf(note); if (k < 0) k = NOTES_F.indexOf(note); if (k < 0) return note;
  return (flat ? NOTES_F : NOTES_S)[((k + n) % 12 + 12) % 12];
}
function transposeChord(c, n){
  if (!n) return c;
  var m = /^([A-G](?:#|b)?)(.*?)(?:\/([A-G](?:#|b)?))?$/.exec(c); if (!m) return c;
  var flat = m[1].length > 1 && m[1][1] === 'b';
  return transposeNote(m[1], n, flat) + m[2] + (m[3] ? '/' + transposeNote(m[3], n, flat || (m[3].length > 1 && m[3][1] === 'b')) : '');
}
function hasChords(s){ return !!s && s.lyrics.some(function(l){ return l.chords && l.chords.length; }); }
function songKey(s){
  for (var i = 0; i < s.lyrics.length; i++) {
    var ch = s.lyrics[i].chords;
    if (ch && ch.length) { var m = /^[A-G](?:#|b)?(?:m(?!aj))?/.exec(ch.slice().sort(function(a, b){ return a.i - b.i; })[0].c); return m ? m[0] : null; }
  }
  return null;
}
/* ---------- Marca-texto: trechos coloridos do verso ({ a, b, k }: início, fim no texto e cor) ---------- */
var MARK_COLORS = { y:'Amarelo', g:'Verde', p:'Rosa', b:'Azul' };
function markNames(){ try { var o = JSON.parse(localStorage.getItem('ensaio-marks') || '{}'); return o && typeof o === 'object' ? o : {}; } catch(e){ return {}; } }
function setMarkNames(o){ try { localStorage.setItem('ensaio-marks', JSON.stringify(o)); } catch(e){} }
function cleanMarkNames(o){
  var out = {}; if (!o || typeof o !== 'object') return out;
  Object.keys(MARK_COLORS).forEach(function(k){ if (typeof o[k] === 'string' && o[k].trim()) out[k] = o[k].trim().slice(0, 24); });
  return out;
}
function markLabel(k){ return markNames()[k] || MARK_COLORS[k]; }
/* Pinta [a, b) com a cor k (ou tira a cor, se k vazio) e devolve as marcas sem sobreposição */
function paintMarks(marks, len, a, b, k){
  var arr = [], i;
  for (i = 0; i < len; i++) arr.push(null);
  (marks || []).forEach(function(m){ if (!MARK_COLORS[m.k]) return; for (var j = Math.max(0, m.a); j < Math.min(len, m.b); j++) arr[j] = m.k; });
  for (i = Math.max(0, a); i < Math.min(len, b); i++) arr[i] = k || null;
  var out = [], cur = null;
  for (i = 0; i < len; i++) {
    if (!arr[i]) { cur = null; continue; }
    if (cur && cur.k === arr[i] && cur.b === i) cur.b = i + 1;
    else { cur = { a:i, b:i + 1, k:arr[i] }; out.push(cur); }
  }
  return out;
}
/* Texto mudou: mantém as marcas que ainda acham o mesmo trecho */
function relocateMarks(oldText, newText, marks){
  if (!marks || !marks.length) return [];
  if (oldText === newText) return marks;
  var out = [];
  marks.forEach(function(m){
    if (m.a === 0 && m.b >= oldText.length) { out = paintMarks(out, newText.length, 0, newText.length, m.k); return; }
    var sub = oldText.slice(m.a, m.b), at = sub.trim() ? newText.indexOf(sub) : -1;
    if (at >= 0) out = paintMarks(out, newText.length, at, at + sub.length, m.k);
  });
  return out;
}
function markedHtml(text, marks, from, to){
  if (from == null) { from = 0; to = text.length; }
  if (!marks || !marks.length) return esc(text.slice(from, to));
  var out = '', pos = from;
  marks.forEach(function(m){
    var a = Math.max(m.a, pos), b = Math.min(m.b, to); if (a >= b) return;
    if (a > pos) out += esc(text.slice(pos, a));
    out += '<mark class="hl hl-' + m.k + '">' + esc(text.slice(a, b)) + '</mark>'; pos = b;
  });
  if (pos < to) out += esc(text.slice(pos, to));
  return out;
}
/* Posição no campo "Texto do verso" (com [acordes]) → posição no texto do verso */
function inputPos(str, pos){
  var re = /\[([^\]\s]{1,12})\]/g, m, removed = 0;
  while ((m = re.exec(str)) && m.index < pos) { if (isChord(m[1])) removed += Math.min(m[0].length, pos - m.index); }
  var lead = str.length - str.replace(/^\s+/, '').length;
  return Math.max(0, pos - removed - Math.min(lead, pos));
}
function usedMarks(s){
  var used = {};
  s.lyrics.forEach(function(l){ (l.marks || []).forEach(function(m){ used[m.k] = true; }); });
  return Object.keys(MARK_COLORS).filter(function(k){ return used[k]; });
}
function renderLegend(){
  var s = curSong(), el = $('#mkLegend'), names = markNames();
  var ks = s ? usedMarks(s).filter(function(k){ return names[k]; }) : [];
  if (!ks.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = ks.map(function(k){ return '<span><i class="hl-' + k + '"></i>' + esc(names[k]) + '</span>'; }).join('');
}
function markNamesEditor(){
  var names = markNames();
  modal('<h2>Cores do marca-texto</h2><p>Dê um nome a cada cor, como “Minha voz” ou “2ª voz”. Vale para todas as músicas, e o player mostra a legenda.</p>' +
    Object.keys(MARK_COLORS).map(function(k){
      return '<label class="mk-name"><i class="hl-' + k + '"></i><input class="field" data-k="' + k + '" maxlength="24" placeholder="' + MARK_COLORS[k] + '" autocomplete="off"></label>';
    }).join('') +
    '<div class="m-actions"><span class="grow"></span><button class="btn sec" data-m="x">Cancelar</button><button class="btn" data-m="ok">Salvar</button></div>');
  document.querySelectorAll('#sheet .mk-name input').forEach(function(inp){ inp.value = names[inp.dataset.k] || ''; });
  $('#sheet').onclick = function(e){
    var b = e.target.closest('[data-m]'); if (!b) return;
    if (b.dataset.m === 'ok') {
      var o = {}; document.querySelectorAll('#sheet .mk-name input').forEach(function(inp){ o[inp.dataset.k] = inp.value; });
      setMarkNames(cleanMarkNames(o)); toast('Nomes das cores salvos');
    }
    closeModal(); if (curSong()) renderLyrics();
  };
}
/* ---------- Anotações por naipe ({ k: naipe, text }) ---------- */
var NAIPE_NOTE = ['Soprano', 'Mezzo', 'Contralto', 'Tenor', 'Barítono', 'Baixo'];
function othersHidden(){ try { return localStorage.getItem('ensaio-vnotes') === 'mine'; } catch(e){ return false; } }
function hasVnotes(s){ return !!s && s.lyrics.some(function(l){ return l.vnotes && l.vnotes.length; }); }
function vnotesHtml(l){
  if (!l.vnotes || !l.vnotes.length) return '';
  var my = myNaipe() ? naipeKey(myNaipe()) : '', hide = my && othersHidden();
  return l.vnotes.map(function(v){
    var mine = my && naipeKey(v.k) === my;
    if (hide && !mine) return '';
    return '<span class="lnote vn' + (mine ? ' mine' : '') + '"><b>' + esc(v.k) + ':</b> ' + esc(v.text) + '</span>';
  }).join('');
}
function cleanVnotes(arr){
  if (!Array.isArray(arr)) return [];
  return arr.filter(function(v){ return v && typeof v.k === 'string' && v.k.trim() && typeof v.text === 'string' && v.text.trim(); }).slice(0, 8)
    .map(function(v){ return { k:v.k.trim().slice(0, 20), text:v.text.trim().slice(0, 200) }; });
}
function vnRow(k, text){
  var opts = NAIPE_NOTE.slice(); if (k && opts.indexOf(k) < 0) opts.push(k);
  return '<div class="vn-row"><select class="vn-k" aria-label="Naipe">' + opts.map(function(n){ return '<option' + (n === k ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>' +
    '<input class="field vn-t" maxlength="200" placeholder="Ex.: respirar aqui" autocomplete="off" value="' + esc(text || '') + '">' +
    '<button type="button" class="icon-btn small" data-vndel="1" aria-label="Tirar esta anotação">' + ICON.x + '</button></div>';
}

/* ---------- Notas iniciais por naipe (diapasão) ---------- */
var PITCH_KEYS = ['Todos', 'Soprano', 'Mezzo', 'Contralto', 'Tenor', 'Barítono', 'Baixo'];
var PITCH_NAMES = { C:'Dó', D:'Ré', E:'Mi', F:'Fá', G:'Sol', A:'Lá', B:'Si' };
var PITCH_LIST = (function(){ var out = [], ns = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']; for (var o = 2; o <= 5; o++) ns.forEach(function(n){ out.push(n + o); }); out.push('C6'); return out; })();
var PITCH_RE = /^([A-G])(#?)([2-6])$/;
function pitchLabel(n){ var m = PITCH_RE.exec(n); return m ? PITCH_NAMES[m[1]] + (m[2] ? '♯' : '') + m[3] : n; }
function pitchFreq(n){
  var m = PITCH_RE.exec(n); if (!m) return 440;
  var midi = 12 * (+m[3] + 1) + ['C','','D','','E','F','','G','','A','','B'].indexOf(m[1]) + (m[2] ? 1 : 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
}
function cleanPitches(arr){
  if (!Array.isArray(arr)) return [];
  return arr.filter(function(p){ return p && PITCH_KEYS.indexOf(p.k) >= 0 && PITCH_RE.test(p.n); }).slice(0, 7).map(function(p){ return { k:p.k, n:p.n }; });
}
function hasPitches(s){ return !!(s && s.pitches && s.pitches.length); }
var actx = null;
function playTones(freqs, when, dur){
  try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){ toast('Este aparelho não toca notas'); return; }
  if (actx.state === 'suspended') actx.resume();
  var t0 = actx.currentTime + (when || 0), out = actx.createGain();
  out.gain.value = 0.32 / Math.max(1, freqs.length * 0.75);
  out.connect(actx.destination);
  freqs.forEach(function(f){
    [[1, 'triangle', 1], [2, 'sine', 0.25]].forEach(function(h){
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = h[1]; o.frequency.value = f * h[0];
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(h[2], t0 + 0.03);
      g.gain.setValueAtTime(h[2], t0 + dur - 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + dur + 0.05);
    });
  });
}
function playPitch(n){ playTones([pitchFreq(n)], 0, 1.6); }
function playAllPitches(s){
  var ps = (s.pitches || []).filter(function(p){ return p.k !== 'Todos'; });
  if (!ps.length) ps = s.pitches || [];
  ps.forEach(function(p, i){ playTones([pitchFreq(p.n)], i * 0.85, 0.8); });
  if (ps.length > 1) playTones(ps.map(function(p){ return pitchFreq(p.n); }), ps.length * 0.85 + 0.1, 2.4);
}
function myPitch(s){
  var my = myNaipe(); if (!hasPitches(s)) return null;
  var p = my && s.pitches.find(function(x){ return naipeKey(x.k) === naipeKey(my); });
  return p || s.pitches.find(function(x){ return x.k === 'Todos'; }) || null;
}
function pitchSheet(s){
  if (!hasPitches(s)) { pitchEditor(s); return; }
  var mine = myPitch(s);
  modal('<h2>Notas iniciais</h2><p>' + esc(s.title) + '</p>' +
    (mine ? '<button class="btn pitch-big" data-pn="' + mine.n + '">▶ ' + (mine.k === 'Todos' ? 'Nota inicial' : 'Minha nota (' + esc(mine.k) + ')') + ': ' + pitchLabel(mine.n) + '</button>' : '') +
    (s.pitches.length > 1 ? '<button class="btn sec pitch-big" data-pall="1">▶ Todas, uma a uma, e o acorde</button>' : '') +
    '<div class="pitch-grid">' + s.pitches.map(function(p){ return '<button class="pitch-b" data-pn="' + p.n + '"><b>' + esc(p.k) + '</b><span>' + pitchLabel(p.n) + '</span></button>'; }).join('') + '</div>' +
    '<div class="m-actions"><button class="btn ghost" data-m="edit">Editar notas</button><span class="grow"></span><button class="btn" data-m="x">Pronto</button></div>');
  $('#sheet').onclick = function(e){
    var b = e.target.closest('[data-pn],[data-pall],[data-m]'); if (!b) return;
    if (b.dataset.pn) { playPitch(b.dataset.pn); return; }
    if (b.dataset.pall) { playAllPitches(s); return; }
    if (b.dataset.m === 'edit') { pitchEditor(s); return; }
    closeModal();
  };
}
function pitchEditor(s){
  var cur = {}; (s.pitches || []).forEach(function(p){ cur[p.k] = p.n; });
  modal('<h2>Notas iniciais de “' + esc(s.title) + '”</h2><p>A nota de partida de cada naipe, para dar o tom antes de começar. Use <b>Todos</b> quando o coro começa em uníssono.</p>' +
    '<div class="pitch-edit">' + PITCH_KEYS.map(function(k){
      return '<div class="pe-row"><span class="pe-k">' + k + '</span><select data-pk="' + k + '" aria-label="Nota inicial: ' + k + '"><option value="">—</option>' +
        PITCH_LIST.map(function(n){ return '<option value="' + n + '"' + (cur[k] === n ? ' selected' : '') + '>' + pitchLabel(n) + ' (' + n + ')</option>'; }).join('') +
        '</select><button type="button" class="icon-btn small" data-pplay="' + k + '" aria-label="Ouvir">▶</button></div>';
    }).join('') + '</div>' +
    '<div class="m-actions"><span class="grow"></span><button class="btn sec" data-m="x">Cancelar</button><button class="btn" data-m="ok">Salvar</button></div>');
  $('#sheet').onclick = async function(e){
    var pb = e.target.closest('[data-pplay]');
    if (pb) { var v = document.querySelector('#sheet select[data-pk="' + pb.dataset.pplay + '"]').value; if (v) playPitch(v); else toast('Escolha a nota primeiro'); return; }
    var b = e.target.closest('[data-m]'); if (!b) return;
    if (b.dataset.m === 'ok') {
      var ps = [];
      document.querySelectorAll('#sheet select[data-pk]').forEach(function(sel){ if (sel.value) ps.push({ k:sel.dataset.pk, n:sel.value }); });
      if (ps.length) s.pitches = ps; else delete s.pitches;
      await saveSong(s); toast(ps.length ? 'Notas iniciais salvas' : 'Notas iniciais apagadas');
      closeModal(); if (curSong() === s) renderPitchBtn();
      return;
    }
    closeModal();
  };
}
function renderPitchBtn(){ var on = hasPitches(curSong()); $('#pPitch').hidden = !on; $('#stPitch').hidden = !on; }

function chordsOn(){ try { return localStorage.getItem('ensaio-chords') !== 'off'; } catch(e){ return true; } }
function chordsHtml(l, n){
  var ch = l.chords.slice().sort(function(a, b){ return a.i - b.i; }), text = l.text, out = '';
  if (!text) return '<span class="ch-only">' + ch.map(function(c){ return '<b>' + esc(transposeChord(c.c, n)) + '</b>'; }).join('') + '</span>';
  if (ch[0].i > 0) out += markedHtml(text, l.marks, 0, ch[0].i);
  ch.forEach(function(c, k){
    var end = k + 1 < ch.length ? ch[k + 1].i : text.length, seg = text.slice(c.i, end), name = transposeChord(c.c, n);
    var short = seg.length < name.length + 1;
    out += '<span class="cs' + (short ? ' short' : '') + '"' + (short ? ' style="min-width:' + (name.length * 0.42 + 0.5).toFixed(2) + 'em"' : '') + '><b class="ch">' + esc(name) + '</b>' + (seg ? markedHtml(text, l.marks, c.i, end) : '&nbsp;') + '</span>';
  });
  return out;
}
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
    h.innerHTML = '<h1 class="brand"><img src="img/logo-96.png" alt="" width="40" height="40">Ensaio</h1><div class="hdr-actions">' + tb + (state.songs.length ? '<button class="btn" data-act="add">Adicionar músicas</button>' : '') + '</div>';
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
    renderInstall();
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
      return '<div class="row' + (state.queueName === p.name && curSong() ? ' playing' : '') + '"><button class="row-main" data-act="openpl" data-id="' + p.id + '"><span class="t">' + esc(p.name) + '</span><span class="s">' + n + (n === 1 ? ' música' : ' músicas') + (plDuration(p) ? ', ' + plDuration(p) : '') + (w ? ', ' + w + ' esperando o áudio' : '') + '</span></button></div>';
    }).join('');
  } else {
    var p = plById(state.openPl);
    if (!p) { state.view = 'playlists'; render(); return; }
    var html = '<div class="pl-actions">' + (p.songIds.length ? '<button class="btn" data-act="plplay">Tocar playlist</button>' : '') +
      '<button class="btn sec" data-act="pladd">Escolher músicas</button><button class="btn sec" data-act="plmore">Opções</button></div>' +
      (p.songIds.length ? '<p class="pl-dur">' + p.songIds.length + (p.songIds.length === 1 ? ' música' : ' músicas') + (plDuration(p) ? ' · ' + plDuration(p) + ' de repertório' : '') + '</p>' : '');
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
function usedBytes(){
  return state.songs.reduce(function(n, s){
    return n + (s.size || 0) + (s.versions || []).reduce(function(m, v){ return m + (v.id !== s.id ? (v.size || 0) : 0); }, 0);
  }, 0);
}
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
function renderPlayer(){ renderPlayerHead(); renderVersions(); renderNotes(); renderLyrics(); renderTools(); setPlayIcons(); renderStage(); renderPitchBtn(); }

/* ---------- Partes da música (Intro, Verso, Refrão…) ---------- */
var PART_NAMES = ['Intro', 'Verso', 'Pré-refrão', 'Refrão', 'Ponte', 'Solo', 'Final'];
var LOOP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/></svg>';
var lastPart = -2;
function partsOf(s){ return (s && s.parts) || []; }
function partAt(s, t){ var p = partsOf(s), k = -1; for (var i = 0; i < p.length; i++) if (p[i].t <= t + 0.05) k = i; return k; }
function partRange(s, k){
  var p = partsOf(s), d = audio.duration || s.duration || 0;
  return { a: p[k].t, b: k + 1 < p.length ? p[k + 1].t : (d || p[k].t + 30) };
}
function sortParts(s){ s.parts.sort(function(a, b){ return a.t - b.t; }); }
function saveSong(s){ return save('songs', s).catch(function(){ toast('Não foi possível salvar'); }); }
/* Rótulo da parte antes do primeiro verso sincronizado dela */
function partTags(s){
  var out = {}, ps = partsOf(s);
  ps.forEach(function(p, k){
    var end = k + 1 < ps.length ? ps[k + 1].t - 0.3 : Infinity;
    for (var i = 0; i < s.lyrics.length; i++) {
      var l = s.lyrics[i];
      if (l.t != null && (l.text || (l.chords && l.chords.length)) && l.t >= p.t - 0.3) { if (l.t < end) out[i] = out[i] ? out[i] + ' · ' + p.name : p.name; return; }
    }
  });
  return out;
}
function renderParts(){
  var s = curSong(), box = $('#parts'), marks = $('#partMarks');
  if (!s) { box.innerHTML = ''; marks.innerHTML = ''; return; }
  var p = partsOf(s), cur = partAt(s, audio.currentTime); lastPart = cur;
  box.innerHTML = p.map(function(x, k){
    var loop = state.loopPart === x;
    return '<button class="part-chip' + (k === cur ? ' on' : '') + (loop ? ' looping' : '') + '" data-k="' + k + '" aria-label="' + esc(x.name) + ', ' + fmt(x.t) + (loop ? ', repetindo' : '') + '. Segure para mais opções">' +
      (loop ? LOOP_SVG : '') + '<span class="pn">' + esc(x.name) + '</span><span class="pt">' + fmt(x.t) + '</span></button>';
  }).join('') + '<button class="part-chip add" data-add="1" aria-label="Marcar uma parte no tempo atual">+ Parte</button>';
  var d = audio.duration || s.duration;
  marks.innerHTML = d ? p.map(function(x){ return '<span class="pmk" style="left:' + Math.min(100, x.t / d * 100) + '%"></span>'; }).join('') : '';
}
function updatePartActive(){
  var s = curSong(); if (!s || !partsOf(s).length) return;
  var cur = partAt(s, audio.currentTime); if (cur === lastPart) return;
  lastPart = cur;
  var box = $('#parts');
  box.querySelectorAll('.part-chip[data-k]').forEach(function(el){
    var on = +el.dataset.k === cur; el.classList.toggle('on', on);
    if (on && Date.now() - partsTouchAt > 3000) box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2, behavior: reduceMotion ? 'auto' : 'smooth' });
  });
}
var partsTouchAt = 0;
function loopPart(p, quiet){
  var s = curSong(), k = partsOf(s).indexOf(p); if (k < 0) return;
  var r = partRange(s, k);
  if (r.b - r.a < 1) { toast('Esta parte é curta demais para repetir'); return; }
  state.loopA = r.a; state.loopB = r.b; state.loopPart = p;
  audio.currentTime = r.a; lastActive = -2; userScrollAt = 0;
  if (audio.paused) audio.play().catch(function(){});
  renderTools();
  if (!quiet) toast('Repetindo ' + p.name);
}
function stopLoop(){ state.loopA = state.loopB = null; state.loopPart = null; renderTools(); toast('Repetição desligada'); }
function jumpPart(k){
  var s = curSong(), p = partsOf(s)[k]; if (!p) return;
  if (state.loopPart && state.loopPart !== p) { loopPart(p); return; }
  audio.currentTime = p.t; lastActive = -2; lastPart = -2; userScrollAt = 0;
  if (audio.paused) audio.play().catch(function(){});
}
function uniquePartName(s, base, except){
  var names = partsOf(s).filter(function(x){ return x !== except; }).map(function(x){ return normTitle(x.name); });
  if (names.indexOf(normTitle(base)) < 0) return base;
  for (var n = 2; ; n++) if (names.indexOf(normTitle(base + ' ' + n)) < 0) return base + ' ' + n;
}
function choosePartName(s, title, except, done){
  actionSheet(title, PART_NAMES.map(function(n){ return { label:n, fn:function(){ done(uniquePartName(s, n, except)); } }; }).concat([
    { label:'Outro nome…', fn:async function(){ var n = await askText('Nome da parte', except ? except.name : '', 'Salvar'); if (n && n.trim()) done(uniquePartName(s, n.trim().slice(0, 30), except)); } }
  ]));
}
function partNear(s, t, except){ return partsOf(s).some(function(x){ return x !== except && Math.abs(x.t - t) < 1; }); }
function addPart(){
  var s = curSong(); if (!s || !audio.src) return;
  if (state.sync || state.adjust) { toast('Termine a sincronização antes'); return; }
  var t = +audio.currentTime.toFixed(2);
  if (partNear(s, t)) { toast('Já tem uma parte começando aqui'); return; }
  choosePartName(s, 'Nova parte em ' + fmt(t), null, function(name){
    s.parts = partsOf(s).concat([{ t:t, name:name }]); sortParts(s);
    saveSong(s); renderTools(); renderLyrics(); toast('Parte marcada: ' + name);
  });
}
function partMenu(k){
  var s = curSong(), p = partsOf(s)[k]; if (!p) return;
  var looping = state.loopPart === p;
  actionSheet(p.name + ' (' + fmt(p.t) + ')', [
    { label: looping ? 'Parar de repetir' : 'Repetir esta parte', fn:function(){ if (looping) stopLoop(); else loopPart(p); } },
    { label:'Começa agora (' + fmt(audio.currentTime) + ')', fn:function(){
      var t = +audio.currentTime.toFixed(2);
      if (partNear(s, t, p)) { toast('Já tem outra parte começando aqui'); return; }
      p.t = t; sortParts(s); saveSong(s);
      if (state.loopPart === p) loopPart(p, true); else renderTools();
      renderLyrics(); toast(p.name + ' agora começa em ' + fmt(t));
    } },
    { label:'Renomear', fn:function(){ choosePartName(s, 'Renomear “' + p.name + '”', p, function(n){ p.name = n; saveSong(s); renderTools(); renderLyrics(); }); } },
    { label:'Apagar parte', danger:true, fn:function(){
      s.parts.splice(s.parts.indexOf(p), 1);
      if (state.loopPart === p) { state.loopA = state.loopB = null; state.loopPart = null; }
      saveSong(s); renderTools(); renderLyrics(); toast('Parte apagada');
    } }
  ]);
}

/* ---------- Cifras: mostrar/esconder e transpor ---------- */
function toggleChords(){
  var on = !chordsOn();
  try { localStorage.setItem('ensaio-chords', on ? 'on' : 'off'); } catch(e){}
  renderLyrics(); toast(on ? 'Cifras visíveis' : 'Cifras escondidas');
}
function transposeSheet(s){
  if (!hasChords(s)) { toast('Esta letra ainda não tem cifras'); return; }
  function body(){
    var n = s.transpose || 0, k = songKey(s);
    return '<h2>Tom de “' + esc(s.title) + '”</h2>' +
      '<p class="tr-now">' + (k ? 'Original <b>' + esc(k) + '</b> → agora <b>' + esc(transposeChord(k, n)) + '</b>' : 'Agora') + ' <span>(' + (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n) + (Math.abs(n) === 1 ? ' semitom' : ' semitons') + ')</span></p>' +
      '<div class="tr-row"><button class="btn sec" data-m="-1" aria-label="Descer meio tom">−1</button>' +
      '<button class="btn sec" data-m="0"' + (n === 0 ? ' disabled' : '') + '>Tom original</button>' +
      '<button class="btn sec" data-m="1" aria-label="Subir meio tom">+1</button></div>' +
      '<p class="small">Muda só os acordes mostrados nesta música. O áudio continua no tom gravado.</p>' +
      '<div class="m-actions"><span class="grow"></span><button class="btn" data-m="x">Pronto</button></div>';
  }
  modal(body());
  $('#sheet').onclick = function(e){
    var b = e.target.closest('[data-m]'); if (!b || b.disabled) return;
    if (b.dataset.m === 'x') { closeModal(); return; }
    var n = b.dataset.m === '0' ? 0 : (s.transpose || 0) + (+b.dataset.m);
    if (n > 11) n -= 12; if (n < -11) n += 12;
    if (n) s.transpose = n; else delete s.transpose;
    saveSong(s); $('#sheet').innerHTML = body(); if (curSong() === s) renderLyrics();
  };
}


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
  if (!s) { box.innerHTML = '<div class="l-empty"><p>Escolha uma música para começar.</p></div>'; $('#mkLegend').hidden = true; return; }
  if (!s.lyrics.length) { box.innerHTML = '<div class="l-empty"><p>Esta música ainda não tem letra.</p><button class="btn" data-act="editlyrics">Adicionar letra</button></div>'; return; }
  var synced = s.lyrics.some(function(l){ return l.t != null; });
  var useSpacer = synced || state.sync;
  var showCh = chordsOn(), tr = s.transpose || 0, tags = synced ? partTags(s) : {};
  box.innerHTML = (useSpacer ? '<div class="spacer"></div>' : '<p class="hint">Esta letra ainda não tem tempos. Toque em “Sincronizar” e marque o começo de cada verso enquanto a música toca.</p>') +
    s.lyrics.map(function(l, i){
      var ch = showCh && l.chords && l.chords.length;
      var tag = tags[i] ? '<div class="part-tag">' + esc(tags[i]) + '</div>' : '';
      if (!l.text && !ch) return tag + (l.chords && l.chords.length ? '' : '<div class="gap"></div>');
      return tag + '<div class="line' + (l.t != null ? ' timed' : '') + (ch ? ' has-ch' + (l.text ? '' : ' ch-line') : '') + '" data-act="line" data-i="' + i + '">' +
        (ch ? chordsHtml(l, tr) : markedHtml(l.text, l.marks)) + (l.note ? '<span class="lnote">' + esc(l.note) + '</span>' : '') + vnotesHtml(l) + '</div>';
    }).join('') + '<p class="lhint">Segure um verso para corrigir o texto' + (hasChords(s) ? ', os acordes' : '') + ' ou escrever uma anotação.</p><div class="spacer"></div>';
  if (state.sync || state.adjust) markTarget();
  renderLegend();
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
  var rb = $('#bRepeat'), r = REPEAT[repeatMode];
  rb.innerHTML = r.icon; rb.setAttribute('aria-label', 'Ao terminar: ' + r.label + '. Toque para mudar');
  rb.setAttribute('aria-pressed', repeatMode !== 'next' ? 'true' : 'false');
  var syncing = !!state.sync, adj = state.adjust;
  renderParts(); $('#parts').hidden = syncing || !!adj;
  $('#tools').hidden = syncing || !!adj; $('#syncBar').hidden = !syncing; $('#adjBar').hidden = !adj;
  if (adj) renderAdjust();
}
async function playAt(i, noPlay){
  if (i < 0 || i >= state.queue.length) return;
  if (state.sync) finishSync(true);
  if (state.adjust) finishAdjust(true);
  state.qi = i;
  var s = curSong();
  state.vid = pickVersion(s);
  var a = await loadAudio(state.vid);
  if (!a && state.vid !== s.id) { state.vid = s.id; a = await loadAudio(s.id); }
  if (!a) { toast('O áudio de “' + s.title + '” não foi encontrado'); return; }
  if (curUrl) URL.revokeObjectURL(curUrl);
  curUrl = URL.createObjectURL(new Blob([a.buf], {type: a.type}));
  audio.src = curUrl;
  applyRate();
  state.loopA = state.loopB = null; state.loopPart = null; lastPart = -2;
  if (!noPlay) { try { await audio.play(); } catch(e){} }
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
/* Ao terminar a música: pausar, seguir a fila, repetir a música ou repetir a fila */
var REPEAT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
var REPEAT = {
  stop: { label:'Pausar ao fim da música', short:'Pausa ao fim da música',
    icon: REPEAT_SVG + '<path d="M5 6l8 6-8 6z" fill="currentColor"/><path d="M18 6v12"/></svg>' },
  next: { label:'Seguir a fila até o fim', short:'Segue a fila até o fim',
    icon: REPEAT_SVG + '<path d="M3 6h12M3 12h12M3 18h7"/><path d="M15 15l6 3-6 3z" fill="currentColor"/></svg>' },
  one: { label:'Repetir esta música', short:'Repetindo esta música',
    icon: REPEAT_SVG + '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/><path d="M11 10.5l1.5-1v5.5" stroke-width="2"/></svg>' },
  all: { label:'Repetir a fila toda', short:'Repetindo a fila toda',
    icon: REPEAT_SVG + '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/></svg>' }
};
var repeatMode = 'next';
try { var savedRep = localStorage.getItem('ensaio-repeat'); if (REPEAT[savedRep]) repeatMode = savedRep; } catch(e){}
function setRepeat(m){
  repeatMode = m; try { localStorage.setItem('ensaio-repeat', m); } catch(e){}
  renderTools(); toast(REPEAT[m].short);
}
function repeatMenu(){
  actionSheet('Ao terminar a música', ['stop','next','one','all'].map(function(m){
    return { label: REPEAT[m].label + (m === repeatMode ? '  ✓' : ''), fn:function(){ setRepeat(m); } };
  }));
}
function restartSong(){
  audio.currentTime = 0; lastActive = -2; userScrollAt = 0;
  if (playerOpen) $('#lyrics').scrollTop = 0;
}
function toggle(){ if (!audio.src) return; if (audio.paused) audio.play().catch(function(){}); else audio.pause(); }
function prev(){
  if (audio.currentTime <= 3 && state.qi <= 0 && repeatMode === 'all' && state.queue.length > 1) { playAt(state.queue.length - 1); return; }
  if (audio.currentTime > 3 || state.qi <= 0) { audio.currentTime = state.loopA != null ? state.loopA : 0; } else playAt(state.qi - 1);
}
function next(){
  if (state.qi < state.queue.length - 1) playAt(state.qi + 1);
  else if (repeatMode === 'all' && state.queue.length) playAt(0);
}
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
    updatePartActive();
  }
  checkLoop();
  requestAnimationFrame(tick);
}

/* Tela ligada durante o ensaio */
async function requestWake(){
  try { if ('wakeLock' in navigator && playerOpen && (!audio.paused || stageOn()) && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', function(){ wakeLock = null; }); } } catch(e){}
}
function releaseWake(){ try { if (wakeLock) wakeLock.release(); } catch(e){} wakeLock = null; }
document.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'visible') requestWake(); });

/* Controles na tela de bloqueio */
function updateMediaSession(){
  if (!('mediaSession' in navigator)) return;
  var s = curSong(); if (!s) return;
  var v = hasVersions(s) ? curVersion() : null;
  try { navigator.mediaSession.metadata = new MediaMetadata({ title: s.title + (v ? ' (' + v.name + ')' : ''), artist: state.queueName || 'Ensaio' }); } catch(e){}
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
  if (!$('#modal').hidden) cancelModal(); else if (stageOn()) exitStage(); else if (playerOpen) closePlayer();
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
  var vpool = oldL.filter(function(l){ return l.vnotes && l.vnotes.length; }).map(function(l){ return { text:l.text, vnotes:l.vnotes }; });
  newL.forEach(function(l){ var k = vpool.findIndex(function(p){ return p.text === l.text; }); if (k >= 0) { l.vnotes = vpool[k].vnotes; vpool.splice(k, 1); } });
  var mpool = oldL.filter(function(l){ return l.marks && l.marks.length; }).map(function(l){ return { text:l.text, marks:l.marks }; });
  newL.forEach(function(l){
    var k = mpool.findIndex(function(p){ return p.text === l.text; });
    if (k >= 0) { l.marks = mpool[k].marks; mpool.splice(k, 1); }
  });
  var pool = oldL.filter(function(l){ return l.note; }).map(function(l){ return { text:l.text.trim(), note:l.note }; });
  newL.forEach(function(l){
    var k = pool.findIndex(function(p){ return p.text === l.text.trim(); });
    if (k >= 0) { l.note = pool[k].note; pool.splice(k, 1); }
  });
  return pool.length;
}
function cleanVerse(v){ return String(v || '').replace(/[\r\n]+/g, ' ').replace(/^\s*(\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]\s*)+/, '').trim(); }
function lineEditor(s, i){
  var l = s.lyrics[i]; if (!l) return;
  modal('<h2>Editar verso</h2>' +
    (l.t != null ? '<p class="small">Começa em ' + fmt(l.t) + '. O tempo continua o mesmo.</p>' : '') +
    '<label class="m-lbl" for="lvTxt">Texto do verso</label>' +
    '<input class="field" id="lvTxt" maxlength="400" autocomplete="off" spellcheck="false">' +
    (hasChords(s) ? '<p class="small field-hint">Acordes entre colchetes, antes da sílaba: [G]terra</p>' : '') +
    '<span class="m-lbl">Marca-texto</span>' +
    '<div class="mk-row" role="group" aria-label="Cor do marca-texto">' + Object.keys(MARK_COLORS).map(function(k){
      return '<button type="button" class="mk-btn" data-mk="' + k + '"><i class="hl-' + k + '"></i>' + esc(markLabel(k)) + '</button>';
    }).join('') + '<button type="button" class="mk-btn none" data-mk="">Sem cor</button></div>' +
    '<p class="small field-hint">Selecione um trecho no texto e toque na cor. Sem seleção, vale para o verso inteiro.</p>' +
    '<div class="mk-prev" id="mkPrev" aria-live="polite"></div>' +
    '<label class="m-lbl" for="lnTxt">Anotação <span>(opcional)</span></label>' +
    '<textarea class="field notes-ta ln-ta" id="lnTxt" maxlength="200" placeholder="Ex.: entra a segunda voz"></textarea>' +
    '<span class="m-lbl">Anotações por naipe <span>(opcional)</span></span>' +
    '<div class="vn-list" id="vnList">' + (l.vnotes || []).map(function(v){ return vnRow(v.k, v.text); }).join('') + '</div>' +
    '<button type="button" class="link-btn vn-add" data-vnadd="1">+ Anotação para um naipe</button>' +
    '<div class="m-actions"><button class="btn ghost" data-m="del" aria-label="Apagar verso">Apagar</button><span class="grow"></span>' +
    '<button class="btn sec" data-m="x">Cancelar</button><button class="btn" data-m="ok">Salvar</button></div>');
  $('#lvTxt').value = joinChords(l.text, l.chords); $('#lnTxt').value = l.note || '';
  /* Cópia de trabalho das marcas: só vai para o verso ao salvar */
  var work = { text:l.text, marks:(l.marks || []).map(function(m){ return { a:m.a, b:m.b, k:m.k }; }) }, sel = null, inp = $('#lvTxt');
  function syncWork(){
    var t = splitChords(cleanVerse(inp.value)).text;
    if (t !== work.text) { work.marks = relocateMarks(work.text, t, work.marks); work.text = t; }
    $('#mkPrev').innerHTML = work.text ? markedHtml(work.text, work.marks) : '<span class="muted">(verso vazio)</span>';
  }
  syncWork();
  inp.addEventListener('input', function(){ sel = null; syncWork(); });
  function keepSel(){ if (document.activeElement === inp) sel = inp.selectionStart !== inp.selectionEnd ? { s:inp.selectionStart, e:inp.selectionEnd } : null; }
  document.addEventListener('selectionchange', keepSel);
  ['select','keyup','pointerup'].forEach(function(ev){ inp.addEventListener(ev, keepSel); });
  /* Tocar na cor não pode tirar a seleção do campo */
  document.querySelectorAll('#sheet .mk-btn').forEach(function(bt){ ['pointerdown','mousedown'].forEach(function(ev){ bt.addEventListener(ev, function(e){ e.preventDefault(); }); }); });
  $('#sheet').onclick = async function(e){
    if (e.target.closest('[data-vnadd]')) {
      $('#vnList').insertAdjacentHTML('beforeend', vnRow(NAIPE_NOTE.indexOf(prettyNaipe(myNaipe())) >= 0 ? prettyNaipe(myNaipe()) : 'Soprano', ''));
      var ins = document.querySelectorAll('#vnList .vn-t'); ins[ins.length - 1].focus(); return;
    }
    var vd = e.target.closest('[data-vndel]'); if (vd) { vd.closest('.vn-row').remove(); return; }
    var mk = e.target.closest('[data-mk]');
    if (mk) {
      syncWork();
      var len = work.text.length, a = 0, z = len, part = false;
      if (sel) { a = inputPos(inp.value, Math.min(sel.s, sel.e)); z = inputPos(inp.value, Math.max(sel.s, sel.e)); part = z > a; if (!part) { a = 0; z = len; } }
      work.marks = paintMarks(work.marks, len, a, z, mk.dataset.mk);
      syncWork();
      toast(mk.dataset.mk ? (part ? 'Trecho marcado' : 'Verso marcado') + ': ' + markLabel(mk.dataset.mk) : (part ? 'Cor tirada do trecho' : 'Cor tirada do verso'), 1600);
      return;
    }
    var b = e.target.closest('[data-m]'); if (!b) return;
    document.removeEventListener('selectionchange', keepSel);
    var m = b.dataset.m;
    if (m === 'x') { closeModal(); return; }
    if (m === 'ok') {
      var sc = splitChords(cleanVerse($('#lvTxt').value)), note = $('#lnTxt').value.trim();
      if (!sc.text && !sc.chords.length) { toast('Escreva o verso ou use Apagar'); $('#lvTxt').focus(); return; }
      var mks = relocateMarks(work.text, sc.text, work.marks);
      l.text = sc.text; if (sc.chords.length) l.chords = sc.chords; else delete l.chords;
      if (mks.length) l.marks = mks; else delete l.marks;
      if (note) l.note = note; else delete l.note;
      var vns = cleanVnotes([].map.call(document.querySelectorAll('#vnList .vn-row'), function(r){ return { k:r.querySelector('.vn-k').value, text:r.querySelector('.vn-t').value }; }));
      if (vns.length) l.vnotes = vns; else delete l.vnotes;
      closeModal();
      try { await save('songs', s); toast('Verso salvo'); } catch(err){ toast('Não foi possível salvar o verso'); }
    } else if (m === 'del') {
      closeModal();
      if (!(await confirmBox('Apagar este verso?', 'Apagar'))) return;
      if (s.lyrics[i] !== l) return;
      if (curSong() === s) { if (state.sync) finishSync(); if (state.adjust) finishAdjust(); }
      s.lyrics.splice(i, 1);
      var prevGap = i > 0 && !s.lyrics[i-1].text.trim(), nextGap = i < s.lyrics.length && !s.lyrics[i].text.trim();
      if (nextGap && (prevGap || i === 0)) s.lyrics.splice(i, 1);
      else if (prevGap && i === s.lyrics.length) s.lyrics.splice(i - 1, 1);
      try { await save('songs', s); toast('Verso apagado'); } catch(err){ toast('Não foi possível apagar o verso'); }
    }
    if (curSong() === s) { renderLyrics(); updateActive(); }
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
    ' Acordes, observações e anotações nas linhas não vão junto, porque o formato .lrc não tem lugar para eles.' +
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
  modal('<h2>Letra de “' + esc(s.title) + '”</h2><p>Cole a letra com um verso por linha. Se tiver um arquivo .lrc (letra com tempos), importe ou cole o conteúdo e ela já fica sincronizada. Cifra também vale: acordes entre colchetes antes da sílaba, como <b>[G]terra</b>, ou numa linha só de acordes em cima do verso, como nos sites de cifra.</p>' +
    '<textarea class="field" id="lyrTxt" spellcheck="false" placeholder="Cole a letra aqui"></textarea>' +
    '<div class="m-actions"><button class="btn sec" data-m="imp">Importar .lrc</button><span class="grow"></span><button class="btn sec" data-m="x">Cancelar</button><button class="btn" data-m="ok">Salvar letra</button></div>');
  $('#lyrTxt').value = lyricsToText(s.lyrics, true);
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
  var rows = state.pending.slice().sort(function(a,b){ return a.title.localeCompare(b.title, 'pt-BR'); }).map(function(p){
    return '<div class="pending-row"><span class="pr-t">' + esc(p.title) + '</span><button class="btn sec small" data-act="pendaudio" data-id="' + esc(p.id) + '" aria-label="Escolher o áudio de ' + esc(p.title) + '">Escolher áudio</button></div>';
  }).join('');
  return '<div class="pending"><h3>Esperando o áudio (' + names.length + ')</h3><p>Letras importadas de músicas que ainda não estão neste aparelho. Um áudio com o mesmo nome recebe a letra sozinho. Se o arquivo tem outro nome, toque em <b>Escolher áudio</b>.</p>' +
    rows + '<button class="btn ghost" data-act="droppending">Descartar estas letras</button></div>';
}
function cleanLyrics(arr){
  if (!Array.isArray(arr)) return [];
  return arr.filter(function(l){ return l && typeof l === 'object'; }).map(function(l){
    var o = { text: typeof l.text === 'string' ? l.text.slice(0, 500) : '' };
    if (typeof l.t === 'number' && isFinite(l.t) && l.t >= 0) o.t = +l.t.toFixed(2); else if ('t' in l) o.t = null;
    if (typeof l.note === 'string' && l.note.trim()) o.note = l.note.slice(0, 200);
    if (Array.isArray(l.chords)) {
      var cs = l.chords.filter(function(c){ return c && typeof c.c === 'string' && c.c.trim() && typeof c.i === 'number' && isFinite(c.i); }).slice(0, 40)
        .map(function(c){ return { i: Math.max(0, Math.min(o.text.length, Math.round(c.i))), c: c.c.trim().slice(0, 12) }; });
      if (cs.length) o.chords = cs;
    }
    var vn = cleanVnotes(l.vnotes); if (vn.length) o.vnotes = vn;
    if (Array.isArray(l.marks)) {
      var ms = paintMarks(l.marks.filter(function(m){ return m && MARK_COLORS[m.k] && typeof m.a === 'number' && typeof m.b === 'number'; })
        .map(function(m){ return { a:Math.round(m.a), b:Math.round(m.b), k:m.k }; }), o.text.length, 0, 0, '');
      if (ms.length) o.marks = ms;
    }
    return o;
  });
}
function cleanParts(arr){
  if (!Array.isArray(arr)) return [];
  return arr.filter(function(p){ return p && typeof p.t === 'number' && isFinite(p.t) && p.t >= 0 && typeof p.name === 'string' && p.name.trim(); }).slice(0, 40)
    .map(function(p){ return { t: +p.t.toFixed(2), name: p.name.trim().slice(0, 30) }; }).sort(function(a, b){ return a.t - b.t; });
}
function cleanTranspose(n){ n = Math.round(+n); return isFinite(n) && n >= -11 && n <= 11 ? n : 0; }
function songExport(s){
  var o = { title:s.title, notes:s.notes || '', duration:s.duration || null, lyrics:cleanLyrics(s.lyrics), parts:cleanParts(s.parts), transpose:cleanTranspose(s.transpose), pitches:cleanPitches(s.pitches) };
  if (hasVersions(s)) o.versions = s.versions.map(function(v){ return v.name; });
  return o;
}
function buildExport(){
  var songs = state.songs.map(function(s){
    return songExport(s);
  }).concat(state.pending.map(function(p){
    return { title:p.title, notes:p.notes || '', duration:p.duration || null, lyrics:cleanLyrics(p.lyrics), parts:cleanParts(p.parts), transpose:cleanTranspose(p.transpose), pitches:cleanPitches(p.pitches) };
  }));
  var playlists = state.playlists.map(function(p){
    var order = p.songIds.map(function(id){ var s = songById(id); return s ? s.title : null; }).filter(Boolean);
    (p.pendingTitles || []).slice().sort(function(a,b){ return a.pos - b.pos; }).forEach(function(x){ order.splice(Math.min(x.pos, order.length), 0, x.title); });
    return { name:p.name, songs:order };
  });
  return { app:'ensaio', kind:'dados', version:1, exportedAt:new Date().toISOString(), markNames:cleanMarkNames(markNames()), songs:songs, playlists:playlists };
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
        duration: typeof s.duration === 'number' && isFinite(s.duration) ? s.duration : null, lyrics:cleanLyrics(s.lyrics),
        parts:cleanParts(s.parts), transpose:cleanTranspose(s.transpose), pitches:cleanPitches(s.pitches) };
    }),
    playlists: (Array.isArray(data.playlists) ? data.playlists : []).filter(function(p){ return p && typeof p.name === 'string' && p.name.trim() && Array.isArray(p.songs); }).map(function(p){
      return { name:p.name.trim().slice(0, 120), songs:p.songs.filter(function(t){ return typeof t === 'string' && t.trim(); }) };
    }),
    markNames: cleanMarkNames(data.markNames)
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
  if (found.length) parts.push('<li><b>' + found.length + (found.length === 1 ? ' música' : ' músicas') + '</b> deste aparelho ' + (found.length === 1 ? 'recebe' : 'recebem') + ' a letra (com cifras e partes), as observações e as anotações do arquivo. O que elas têm hoje é substituído.</li>');
  if (missing.length) parts.push('<li><b>' + missing.length + (missing.length === 1 ? ' música' : ' músicas') + '</b> ainda não ' + (missing.length === 1 ? 'está' : 'estão') + ' aqui. A letra fica esperando: ao adicionar um áudio com o mesmo nome, ela entra sozinha.</li>');
  if (data.playlists.length) parts.push('<li><b>' + data.playlists.length + (data.playlists.length === 1 ? ' playlist' : ' playlists') + '</b>' + (plSame ? ' (' + plSame + ' com nome igual a uma daqui, que terá a ordem substituída)' : '') + '.</li>');
  var ok = await new Promise(function(res){
    modal('<h2>Importar dados</h2><ul class="imp-sum">' + parts.join('') + '</ul><p class="small">Os áudios não estão no arquivo. Nada é apagado deste aparelho.</p>' +
      '<div class="m-actions"><button class="btn sec" data-m="x">Cancelar</button><button class="btn" data-m="ok">Importar</button></div>', function(){ res(false); });
    $('#sheet').onclick = function(e){ var b = e.target.closest('[data-m]'); if (!b) return; closeModal(); res(b.dataset.m === 'ok'); };
  });
  if (!ok) return;
  if (Object.keys(data.markNames).length) { var mn = markNames(); Object.keys(data.markNames).forEach(function(k){ mn[k] = data.markNames[k]; }); setMarkNames(mn); }
  if (state.sync) finishSync(true);
  if (state.adjust) finishAdjust(true);
  try {
    for (var i = 0; i < found.length; i++) {
      var src = found[i], s = match[normTitle(src.title)];
      s.lyrics = src.lyrics; s.notes = src.notes; s.parts = src.parts;
      if (src.pitches.length) s.pitches = src.pitches; else delete s.pitches;
      if (src.transpose) s.transpose = src.transpose; else delete s.transpose;
      if (!s.duration && src.duration) s.duration = src.duration;
      await save('songs', s);
    }
    for (var j = 0; j < missing.length; j++) {
      var m = missing[j], pid = normTitle(m.title);
      var pend = { id:pid, title:m.title, lyrics:m.lyrics, notes:m.notes, duration:m.duration, parts:m.parts, transpose:m.transpose, pitches:m.pitches };
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
async function applyPending(song, forced){
  var k = normTitle(song.title), changed = false;
  var p = forced || state.pending.find(function(x){ return x.id === k; });
  if (p) k = normTitle(p.title);
  if (p) {
    song.title = p.title; song.lyrics = p.lyrics || []; song.notes = p.notes || ''; song.parts = p.parts || [];
    if (p.pitches && p.pitches.length) song.pitches = p.pitches; else delete song.pitches;
    if (p.transpose) song.transpose = p.transpose; else delete song.transpose;
    if (!song.duration && p.duration) song.duration = p.duration;
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
    if (pl.songIds.indexOf(song.id) < 0) pl.songIds.splice(Math.min(hit.pos - before, pl.songIds.length), 0, song.id);
    pl.pendingTitles = w.filter(function(x){ return x !== hit; });
    if (!pl.pendingTitles.length) delete pl.pendingTitles;
    await save('playlists', pl);
    changed = true;
  }
  return changed;
}
$('#dataFile').addEventListener('change', async function(e){
  var f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    var head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
    if (head[0] === 0x50 && head[1] === 0x4B) { await importPack(f); return; }
  } catch(err) { toast('Não foi possível ler o pacote'); return; }
  if (f.size > 20 * 1048576) { toast('Arquivo grande demais para ser de dados do Ensaio'); return; }
  try { await importData(await f.text()); } catch(err){ toast('Não foi possível ler o arquivo'); }
});

/* ---------- Ações ---------- */
/* Guarda um arquivo de áudio como música nova (o espaço já foi conferido por quem chama) */
async function storeAudioFile(f){
  var id = uid();
  try {
    var buf = await f.arrayBuffer();
    var title = f.name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim() || 'Sem título';
    var song = { id:id, title:title, lyrics:[], duration:null, added:Date.now(), size:buf.byteLength };
    var rec = { id:id, buf:buf, type:f.type || 'audio/mpeg' };
    if (db) await save('audio', rec); else mem.audio.set(id, rec);
    song.duration = await probeDuration(buf, rec.type);
    await save('songs', song);
    state.songs.push(song);
    return song;
  } catch(err) {
    try { await remove('audio', id); } catch(_){}
    toast('Sem espaço para guardar “' + f.name + '”');
    return null;
  }
}
/* Duração de um áudio sem tocar (null se o navegador não souber ler) */
function probeDuration(buf, type){
  return new Promise(function(res){
    var url = URL.createObjectURL(new Blob([buf], { type:type })), a = new Audio(), done = false;
    function end(v){ if (done) return; done = true; URL.revokeObjectURL(url); a.removeAttribute('src'); res(v); }
    a.preload = 'metadata';
    a.onloadedmetadata = function(){ end(isFinite(a.duration) ? a.duration : null); };
    a.onerror = function(){ end(null); };
    setTimeout(function(){ end(null); }, 8000);
    a.src = url;
  });
}
function hasContent(s){ return !!(s.lyrics.length || s.notes || (s.parts && s.parts.length)); }
/* Escolher o áudio de uma letra que está esperando, com qualquer nome de arquivo */
var linkTarget = null;
function chooseAudioFor(pid){
  var p = state.pending.find(function(x){ return x.id === pid; }); if (!p) return;
  if (freeBytes() < 1048576) { toast('O espaço de ' + fmtSize(STORAGE_LIMIT) + ' do Ensaio está cheio. Exclua músicas que saíram do repertório.', 6000); return; }
  linkTarget = p; $('#linkFile').value = ''; $('#linkFile').click();
}
$('#linkFile').addEventListener('change', async function(e){
  var f = e.target.files[0], p = linkTarget; e.target.value = ''; linkTarget = null;
  if (!f || !p || state.pending.indexOf(p) < 0) return;
  if (usedBytes() + f.size > STORAGE_LIMIT) { toast('“' + f.name + '” não coube no limite de ' + fmtSize(STORAGE_LIMIT) + ' (faltam ' + fmtSize(freeBytes()) + ')', 6000); return; }
  toast('Guardando “' + f.name + '”…');
  var song = await storeAudioFile(f); if (!song) return;
  try { await applyPending(song, p); } catch(err){ toast('O áudio foi guardado, mas a letra não pôde ser ligada'); render(); return; }
  render();
  toast('Letra de “' + song.title + '” ligada a “' + f.name + '”', 3500);
});
/* Ligar uma letra que está esperando a uma música que já está no aparelho */
function useImportedLyrics(s){
  if (!state.pending.length) { toast('Não há letras importadas esperando'); return; }
  actionSheet('Usar qual letra em “' + s.title + '”?', state.pending.slice().sort(function(a,b){ return a.title.localeCompare(b.title, 'pt-BR'); }).map(function(p){
    return { label:p.title, fn:async function(){
      if (hasContent(s) && !(await confirmBox('O que “' + s.title + '” tem hoje (letra, observações e partes) será substituído pela letra importada de “' + p.title + '”.', 'Substituir'))) return;
      if (curSong() === s) { if (state.sync) finishSync(true); if (state.adjust) finishAdjust(true); }
      s.lyrics = []; s.notes = ''; s.parts = [];
      try { await applyPending(s, p); } catch(err){ toast('Não foi possível ligar a letra'); return; }
      render(); if (curSong() === s) { renderPlayer(); updateMediaSession(); }
      toast('“' + s.title + '” recebeu a letra importada', 3000);
    } };
  }));
}
/* ---------- Versões por naipe (kits do coral): várias gravações da mesma música ---------- */
/* O áudio principal fica com o id da música; as outras versões têm id próprio no banco 'audio' */
var NAIPE_RANK = ['tutti','todos','coro','completo','original','soprano','mezzo','contralto','tenor','baritono','baixo','piano','acompanhamento','playback','instrumental'];
var NAIPE_NAMES = ['Tutti','Soprano','Mezzo','Contralto','Tenor','Barítono','Baixo','Piano'];
var NAIPE_TOKEN = '(tutti|todos|coro|completo|soprano|mezzo(?:[ -]?soprano)?|contralto|alto|tenor|bar[ií]tono|baixo|bass|piano|acompanhamento|playback|instrumental)(?:[ -]?(\\d))?';
function versionsOf(s){ return s && s.versions && s.versions.length ? s.versions : [{ id:s.id, name:'Original', size:s.size, duration:s.duration }]; }
function hasVersions(s){ return !!(s && s.versions && s.versions.length > 1); }
function vDuration(s, v){ return v.id === s.id ? s.duration : v.duration; }
function curVersion(){ var s = curSong(); if (!s) return null; var vs = versionsOf(s); return vs.find(function(v){ return v.id === state.vid; }) || vs[0]; }
function myNaipe(){ try { return localStorage.getItem('ensaio-naipe') || ''; } catch(e){ return ''; } }
function naipeKey(name){
  var n = normTitle(name).replace(/[\s-]*\d+$/, '');
  if (n === 'alto') n = 'contralto'; if (n === 'bass') n = 'baixo'; if (/^mezzo/.test(n)) n = 'mezzo';
  return n;
}
function naipeRank(name){ var k = NAIPE_RANK.indexOf(naipeKey(name)); return k < 0 ? 99 : k; }
function pickVersion(s){
  var vs = versionsOf(s), my = myNaipe();
  if (my && hasVersions(s)) { var v = vs.find(function(x){ return naipeKey(x.name) === naipeKey(my); }); if (v) return v.id; }
  return vs[0].id;
}
function prettyNaipe(w){
  var n = normTitle(w);
  if (/^mezzo/.test(n)) return 'Mezzo';
  return { tutti:'Tutti', todos:'Todos', coro:'Coro', completo:'Completo', soprano:'Soprano', contralto:'Contralto', alto:'Contralto', tenor:'Tenor', baritono:'Barítono', baixo:'Baixo', bass:'Baixo',
    piano:'Piano', acompanhamento:'Acompanhamento', playback:'Playback', instrumental:'Instrumental' }[n] || w;
}
/* "Ave Maria - Soprano.mp3", "Ave Maria (Tenor 2).mp3", "Ave_Maria_Baixo.mp3", "Contralto - Ave Maria.mp3" */
function splitNaipe(fileName){
  var raw = fileName.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  var m = new RegExp('^(.*?)[\\s\\-–(\\[]+' + NAIPE_TOKEN + '[)\\]]?$', 'i').exec(raw);
  if (m && m[1].replace(/[\s\-–(\[]+$/, '').trim()) return { base:m[1].replace(/[\s\-–(\[]+$/, '').trim(), naipe:prettyNaipe(m[2]) + (m[3] ? ' ' + m[3] : '') };
  m = new RegExp('^(?:[(\\[]' + NAIPE_TOKEN + '[)\\]]\\s*|' + NAIPE_TOKEN + '\\s*[-–]\\s*)(.+)$', 'i').exec(raw);
  if (m && m[5].trim()) { var w = m[1] || m[3], d = m[2] || m[4]; return { base:m[5].trim(), naipe:prettyNaipe(w) + (d ? ' ' + d : '') }; }
  return { base:raw, naipe:null };
}
function uniqueVersionName(s, base, except){
  var names = versionsOf(s).filter(function(v){ return v !== except; }).map(function(v){ return normTitle(v.name); });
  if (names.indexOf(normTitle(base)) < 0) return base;
  for (var n = 2; ; n++) if (names.indexOf(normTitle(base + ' ' + n)) < 0) return base + ' ' + n;
}
function sortVersions(s){
  var vs = versionsOf(s), main = vs[0];
  s.versions = [main].concat(vs.slice(1).sort(function(a, b){ return naipeRank(a.name) - naipeRank(b.name) || a.name.localeCompare(b.name, 'pt-BR'); }));
}
/* Guarda um arquivo como nova versão de uma música que já existe */
async function storeVersionFile(s, f, name){
  var id = uid();
  try {
    var buf = await f.arrayBuffer(), rec = { id:id, buf:buf, type:f.type || 'audio/mpeg' };
    if (db) await save('audio', rec); else mem.audio.set(id, rec);
    var v = { id:id, name:uniqueVersionName(s, name || 'Versão'), size:buf.byteLength, duration:await probeDuration(buf, rec.type) };
    s.versions = versionsOf(s).concat([v]); sortVersions(s);
    await save('songs', s);
    return v;
  } catch(err) {
    try { await remove('audio', id); } catch(_){}
    toast('Sem espaço para guardar “' + f.name + '”');
    return null;
  }
}
function renderVersions(){
  var s = curSong(), box = $('#versions');
  if (!s || !hasVersions(s)) { box.hidden = true; box.innerHTML = ''; return; }
  var cur = curVersion();
  box.hidden = false;
  box.innerHTML = versionsOf(s).map(function(v){
    var on = v.id === cur.id;
    return '<button class="ver-chip' + (on ? ' on' : '') + '" data-vid="' + v.id + '" aria-pressed="' + on + '">' + esc(v.name) + '</button>';
  }).join('') + '<button class="ver-chip edit" data-vedit="1" aria-label="Versões e meu naipe">⋯</button>';
}
async function switchVersion(vid){
  var s = curSong(); if (!s) return;
  var v = versionsOf(s).find(function(x){ return x.id === vid; }); if (!v) return;
  if (vid === state.vid && audio.src) return;
  var a = await loadAudio(vid); if (!a) { toast('O áudio desta versão não foi encontrado'); return; }
  var t = audio.currentTime || 0, playing = !audio.paused;
  state.vid = vid;
  if (curUrl) URL.revokeObjectURL(curUrl);
  curUrl = URL.createObjectURL(new Blob([a.buf], { type:a.type }));
  audio.src = curUrl; applyRate();
  await new Promise(function(res){
    var done = false;
    function ok(){ if (done) return; done = true; audio.removeEventListener('loadedmetadata', ok); res(); }
    audio.addEventListener('loadedmetadata', ok); setTimeout(ok, 3000);
  });
  try { audio.currentTime = Math.max(0, Math.min(t, (audio.duration || t + 1) - 0.2)); } catch(e){}
  if (playing) audio.play().catch(function(){});
  lastActive = -2; lastPart = -2;
  renderVersions(); renderStage(); updateMediaSession(); setPlayIcons();
  var timed = s.lyrics.some(function(l){ return l.t != null; }) || (s.parts && s.parts.length);
  var d = vDuration(s, v), d0 = s.duration;
  if (timed && d && d0 && Math.abs(d - d0) > 2) toast(v.name + ': esta versão tem outra duração, os tempos da letra podem não bater', 4000);
  else toast(v.name, 1200);
}
function cycleVersion(){
  var s = curSong(); if (!hasVersions(s)) return;
  var vs = versionsOf(s), k = vs.indexOf(curVersion());
  switchVersion(vs[(k + 1) % vs.length].id);
}
function chooseVersionName(s, title, except, suggest, done){
  var names = (suggest && NAIPE_NAMES.indexOf(suggest) < 0 ? [suggest] : []).concat(NAIPE_NAMES);
  actionSheet(title, names.map(function(n){ return { label:n + (n === suggest ? '  (do nome do arquivo)' : ''), fn:function(){ done(uniqueVersionName(s, n, except)); } }; }).concat([
    { label:'Outro nome…', fn:async function(){ var n = await askText('Nome da versão', except ? except.name : '', 'Salvar'); if (n && n.trim()) done(uniqueVersionName(s, n.trim().slice(0, 30), except)); } }
  ]));
}
var verTarget = null;
function addVersion(s){
  if (freeBytes() < 1048576) { toast('O espaço de ' + fmtSize(STORAGE_LIMIT) + ' do Ensaio está cheio.', 5000); return; }
  verTarget = s; $('#verFile').value = ''; $('#verFile').click();
}
$('#verFile').addEventListener('change', function(e){
  var f = e.target.files[0], s = verTarget; e.target.value = ''; verTarget = null;
  if (!f || !s || state.songs.indexOf(s) < 0) return;
  if (usedBytes() + f.size > STORAGE_LIMIT) { toast('“' + f.name + '” não coube no limite de ' + fmtSize(STORAGE_LIMIT) + ' (faltam ' + fmtSize(freeBytes()) + ')', 6000); return; }
  chooseVersionName(s, 'Nome desta versão', null, splitNaipe(f.name).naipe, async function(name){
    toast('Guardando “' + f.name + '”…');
    var v = await storeVersionFile(s, f, name); if (!v) return;
    if (curSong() === s) renderVersions();
    render(); toast('Versão “' + v.name + '” adicionada', 2500);
    versionsSheet(s);
  });
});
async function removeVersion(s, v){
  var vs = versionsOf(s); if (vs.length < 2) return;
  if (!(await confirmBox('Apagar a versão “' + v.name + '”? O áudio dela sai do aparelho; a letra, as partes e as anotações continuam.', 'Apagar'))) return;
  var playingThis = curSong() === s && curVersion().id === v.id;
  if (v.id === s.id) {
    /* a principal guarda o áudio com o id da música: a próxima versão passa para o lugar dela */
    var next = vs[1], a = await loadAudio(next.id);
    if (!a) { toast('Não foi possível apagar esta versão'); return; }
    var rec = { id:s.id, buf:a.buf, type:a.type };
    if (db) await save('audio', rec); else mem.audio.set(s.id, rec);
    await remove('audio', next.id); mem.audio.delete(next.id);
    s.size = next.size; s.duration = next.duration;
    s.versions = [{ id:s.id, name:next.name, size:next.size, duration:next.duration }].concat(vs.slice(2));
    if (state.vid === next.id) state.vid = s.id;
  } else {
    await remove('audio', v.id); mem.audio.delete(v.id);
    s.versions = vs.filter(function(x){ return x !== v; });
  }
  await saveSong(s);
  if (playingThis) { state.vid = null; await switchVersion(versionsOf(s)[0].id); }
  else if (curSong() === s) renderVersions();
  render(); toast('Versão apagada'); versionsSheet(s);
}
function versionMenu(s, v){
  var acts = [];
  if (curSong() === s && curVersion().id !== v.id) acts.push({ label:'Tocar esta versão', fn:function(){ switchVersion(v.id); } });
  acts.push({ label:'Renomear', fn:function(){ chooseVersionName(s, 'Renomear “' + v.name + '”', v, null, async function(n){ v.name = n; sortVersions(s); await saveSong(s); if (curSong() === s) { renderVersions(); updateMediaSession(); } versionsSheet(s); }); } });
  acts.push({ label:'Trocar o áudio…', fn:function(){ swapAudio(s, v); } });
  if (versionsOf(s).length > 1) acts.push({ label:'Apagar versão', danger:true, fn:function(){ removeVersion(s, v); } });
  actionSheet(v.name, acts);
}
function versionsSheet(s){
  function body(){
    var vs = versionsOf(s), my = myNaipe(), cur = curSong() === s ? curVersion() : null;
    return '<h2>Versões de “' + esc(s.title) + '”</h2>' +
      '<p>Gravações da mesma música, como os kits de naipe do coral. A letra, as cifras, as partes e as anotações valem para todas.</p>' +
      '<div class="ver-list">' + vs.map(function(v){
        var d = vDuration(s, v), mine = my && hasVersions(s) && naipeKey(v.name) === naipeKey(my);
        return '<div class="ver-row"><div class="vr-t"><b>' + esc(v.name) + (mine ? ' <em class="vr-me">meu naipe</em>' : '') + '</b>' +
          '<span>' + (d ? fmt(d) : '—') + (cur && cur.id === v.id ? ' · tocando' : '') + '</span></div>' +
          '<button class="icon-btn small" data-vmenu="' + v.id + '" aria-label="Opções da versão ' + esc(v.name) + '">' + ICON.more + '</button></div>';
      }).join('') + '</div>' +
      '<button class="btn sec" data-m="add">+ Adicionar versão</button>' +
      '<label class="naipe-l">Meu naipe <select id="naipeSel">' + [''].concat(NAIPE_NAMES.slice(1, 7)).map(function(n){
        return '<option value="' + n + '"' + (n === my ? ' selected' : '') + '>' + (n || 'Nenhum') + '</option>';
      }).join('') + '</select></label>' +
      '<p class="small">Com o naipe escolhido, as músicas com versões já abrem na sua voz. Vale para todas as músicas deste aparelho.</p>' +
      '<div class="m-actions"><span class="grow"></span><button class="btn" data-m="x">Pronto</button></div>';
  }
  modal(body());
  $('#sheet').onchange = function(e){
    if (e.target.id !== 'naipeSel') return;
    try { if (e.target.value) localStorage.setItem('ensaio-naipe', e.target.value); else localStorage.removeItem('ensaio-naipe'); } catch(_){}
    toast(e.target.value ? 'Meu naipe: ' + e.target.value : 'Sem naipe escolhido');
    $('#sheet').innerHTML = body();
  };
  $('#sheet').onclick = function(e){
    var vm = e.target.closest('[data-vmenu]');
    if (vm) { var v = versionsOf(s).find(function(x){ return x.id === vm.dataset.vmenu; }); if (v) versionMenu(s, v); return; }
    var b = e.target.closest('[data-m]'); if (!b) return;
    if (b.dataset.m === 'add') { closeModal(); addVersion(s); return; }
    closeModal();
  };
}
/* Pergunta se os arquivos com naipe no nome devem virar versões */
function askKits(kits){
  return new Promise(function(res){
    modal('<h2>Kits de naipe</h2><p>Estes arquivos parecem versões da mesma música:</p><ul class="kit-list">' + kits.map(function(g){
      return '<li><b>' + esc(g.base) + '</b>: ' + esc(g.items.map(function(x){ return x.sp.naipe; }).join(', ')) + (g.song ? ' <span>(entram na música que já existe)</span>' : '') + '</li>';
    }).join('') + '</ul><p class="small">Agrupadas, ficam como uma música só, com uma letra, e você troca de voz no player sem perder o ponto.</p>' +
      '<div class="m-actions"><button class="btn sec" data-m="sep">Adicionar separadas</button><button class="btn" data-m="ok">Agrupar</button></div>', function(){ res(false); });
    $('#sheet').onclick = function(e){ var b = e.target.closest('[data-m]'); if (!b) return; closeModal(); res(b.dataset.m === 'ok'); };
  });
}

/* ---------- Pacote de ensaio: uma playlist com dados e áudios num arquivo .zip ---------- */
var CRC_T = null;
async function crc32(u8){
  if (!CRC_T) { CRC_T = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
  var crc = 0xFFFFFFFF, CH = 4194304;
  for (var i = 0; i < u8.length; i += CH) {
    var end = Math.min(u8.length, i + CH);
    for (var j = i; j < end; j++) crc = CRC_T[(crc ^ u8[j]) & 0xFF] ^ (crc >>> 8);
    if (end < u8.length) await new Promise(function(r){ setTimeout(r, 0); });
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
/* ZIP sem compressão (áudio já é comprimido), legível por qualquer descompactador */
async function makeZip(entries){
  var enc = new TextEncoder(), parts = [], central = [], offset = 0;
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i], nm = enc.encode(e.name), crc = await crc32(e.data), size = e.data.length;
    var lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, nm, e.data);
    var ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, nm.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, nm);
    offset += 30 + nm.length + size;
  }
  var cdSize = central.reduce(function(n, b){ return n + b.byteLength; }, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob(parts.concat(central, [end.buffer]), { type:'application/zip' });
}
function readZip(buf){
  var dv = new DataView(buf), u8 = new Uint8Array(buf), e = -1, files = {}, dec = new TextDecoder();
  for (var i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('não é zip');
  var n = dv.getUint16(e + 10, true), p = dv.getUint32(e + 16, true);
  for (var k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip inválido');
    var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true),
        xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    var name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    var start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    files[name] = { method:method, data:u8.subarray(start, start + csize) };
    p += 46 + nlen + xlen + clen;
  }
  return files;
}
async function zipData(f){
  if (!f) throw new Error('faltando');
  if (f.method === 0) return f.data;
  if (f.method === 8 && window.DecompressionStream) return new Uint8Array(await new Response(new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  throw new Error('compressão não suportada');
}
function audioExt(type){
  type = String(type || '');
  if (/mpeg|mp3/.test(type)) return 'mp3'; if (/mp4|m4a|aac/.test(type)) return 'm4a'; if (/wav/.test(type)) return 'wav';
  if (/ogg|opus/.test(type)) return 'ogg'; if (/webm/.test(type)) return 'webm'; if (/flac/.test(type)) return 'flac';
  return 'audio';
}
function downloadFile(name, blob){
  var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 60000);
}
async function exportPack(p){
  var songs = p.songIds.map(songById).filter(Boolean);
  if (!songs.length) { toast('A playlist está vazia'); return; }
  toast('Montando o pacote…', 60000);
  var entries = [], meta = [], nAudio = 0;
  try {
    for (var i = 0; i < songs.length; i++) {
      var s = songs[i], o = songExport(s), vs = versionsOf(s);
      delete o.versions; o.audio = [];
      for (var j = 0; j < vs.length; j++) {
        var a = await loadAudio(vs[j].id); if (!a || !a.buf) continue;
        var fn = 'audio/' + (i + 1) + '-' + (j + 1) + '.' + audioExt(a.type);
        entries.push({ name:fn, data:new Uint8Array(a.buf) }); nAudio++;
        o.audio.push({ name: vs.length > 1 ? vs[j].name : 'Original', file:fn, type:a.type || 'audio/mpeg', duration: vDuration(s, vs[j]) || null });
      }
      meta.push(o);
    }
    var data = { app:'ensaio', kind:'pacote', version:1, exportedAt:new Date().toISOString(), markNames:cleanMarkNames(markNames()),
      playlist:{ name:p.name, songs:songs.map(function(x){ return x.title; }) }, songs:meta };
    entries.unshift({ name:'ensaio.json', data:new TextEncoder().encode(JSON.stringify(data, null, 1)) });
    var blob = await makeZip(entries);
  } catch(err) { toast('Não foi possível montar o pacote'); return; }
  hideToast();
  packSheet('Ensaio - ' + safeName(p.name) + '.zip', blob, songs.length, nAudio);
}
function packSheet(name, blob, nSongs, nAudio){
  var file = null, canShare = false;
  try { file = new File([blob], name, { type:'application/zip' }); canShare = !!(navigator.canShare && navigator.canShare({ files:[file] })); } catch(e){}
  modal('<h2>Pacote de ensaio pronto</h2><p class="pk-name">' + esc(name) + ' · ' + fmtSize(blob.size) + '</p>' +
    '<p>' + nSongs + (nSongs === 1 ? ' música' : ' músicas') + ' e ' + nAudio + (nAudio === 1 ? ' gravação' : ' gravações') + ', com a letra sincronizada, as partes, as cifras, o marca-texto, as anotações e as notas iniciais.</p>' +
    '<p>Mande para o coro pelo WhatsApp, e-mail ou Drive. Quem receber abre o Ensaio e toca em <b>Importar dados</b>, no fim da aba Músicas, e escolhe este arquivo.</p>' +
    '<div class="m-actions"><button class="btn ghost" data-m="x">Fechar</button><span class="grow"></span>' +
    '<button class="btn' + (canShare ? ' sec' : '') + '" data-m="dl">Baixar arquivo</button>' + (canShare ? '<button class="btn" data-m="share">Compartilhar</button>' : '') + '</div>');
  $('#sheet').onclick = function(e){
    var b = e.target.closest('[data-m]'); if (!b) return;
    if (b.dataset.m === 'x') { closeModal(); return; }
    if (b.dataset.m === 'share') navigator.share({ files:[file], title:name }).then(function(){ toast('Pacote compartilhado'); })
      .catch(function(err){ if (!err || err.name !== 'AbortError') toast('Não deu para compartilhar daqui. Use Baixar arquivo.'); });
    else { try { downloadFile(name, blob); toast('Pacote baixado'); } catch(err){ toast('Não foi possível baixar o pacote'); } }
  };
}
async function importPack(file){
  toast('Lendo o pacote…', 60000);
  var files, data;
  try {
    files = readZip(await file.arrayBuffer());
    data = JSON.parse(new TextDecoder().decode(await zipData(files['ensaio.json'])));
  } catch(err) { toast('Este arquivo não é um pacote de ensaio do Ensaio'); return; }
  if (!data || data.app !== 'ensaio' || data.kind !== 'pacote' || !Array.isArray(data.songs)) { toast('Este arquivo não é um pacote de ensaio do Ensaio'); return; }
  var songs = data.songs.filter(function(s){ return s && typeof s.title === 'string' && s.title.trim() && Array.isArray(s.audio); }).map(function(s){
    return { title:s.title.trim().slice(0, 120), notes: typeof s.notes === 'string' ? s.notes.slice(0, 1000) : '', lyrics:cleanLyrics(s.lyrics), parts:cleanParts(s.parts),
      transpose:cleanTranspose(s.transpose), pitches:cleanPitches(s.pitches),
      audio: s.audio.filter(function(a){ return a && typeof a.file === 'string' && files[a.file]; }).slice(0, 12).map(function(a){
        return { name: typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 30) : 'Original', file:a.file, type: typeof a.type === 'string' ? a.type : 'audio/mpeg', size:files[a.file].data.length };
      }) };
  }).filter(function(s){ return s.audio.length; });
  if (!songs.length) { toast('O pacote não tem músicas com áudio'); return; }
  var match = matchSongs(songs.map(function(s){ return s.title; }));
  var existing = songs.filter(function(s){ return match[normTitle(s.title)]; });
  var need = songs.reduce(function(n, s){ return n + s.audio.reduce(function(m, a){ return m + a.size; }, 0); }, 0);
  var freed = existing.reduce(function(n, s){ var o = match[normTitle(s.title)]; return n + (o.size || 0) + (o.versions || []).reduce(function(m, v){ return m + (v.id !== o.id ? (v.size || 0) : 0); }, 0); }, 0);
  var nAudio = songs.reduce(function(n, s){ return n + s.audio.length; }, 0);
  var plName = data.playlist && typeof data.playlist.name === 'string' ? data.playlist.name.trim().slice(0, 120) : '';
  var plOld = plName && state.playlists.find(function(x){ return normTitle(x.name) === normTitle(plName); });
  hideToast();
  if (usedBytes() - freed + need > STORAGE_LIMIT) { toast('O pacote tem ' + fmtSize(need) + ' de áudio e não cabe no limite de ' + fmtSize(STORAGE_LIMIT) + ' (faltam ' + fmtSize(freeBytes()) + '). Exclua músicas que saíram do repertório.', 8000); return; }
  var ok = await new Promise(function(res){
    modal('<h2>Pacote de ensaio</h2>' + (plName ? '<p class="pk-name">“' + esc(plName) + '”</p>' : '') + '<ul class="imp-sum">' +
      '<li><b>' + songs.length + (songs.length === 1 ? ' música' : ' músicas') + '</b> com ' + nAudio + (nAudio === 1 ? ' gravação' : ' gravações') + ' (' + fmtSize(need) + '), prontas para estudar: letra, partes, cifras, anotações e notas iniciais.</li>' +
      (existing.length ? '<li><b>' + existing.length + '</b> ' + (existing.length === 1 ? 'já está' : 'já estão') + ' no aparelho: letra, anotações e gravações serão substituídas pelas do pacote.</li>' : '') +
      (plName ? '<li>A playlist <b>' + esc(plName) + '</b> ' + (plOld ? 'será atualizada' : 'será criada') + ' com a ordem do pacote.</li>' : '') +
      '</ul><div class="m-actions"><button class="btn sec" data-m="x">Cancelar</button><button class="btn" data-m="ok">Importar</button></div>', function(){ res(false); });
    $('#sheet').onclick = function(e){ var b = e.target.closest('[data-m]'); if (!b) return; closeModal(); res(b.dataset.m === 'ok'); };
  });
  if (!ok) return;
  if (state.sync) finishSync(true);
  if (state.adjust) finishAdjust(true);
  var ids = [], cur = curSong(), curReplaced = false;
  try {
    for (var i = 0; i < songs.length; i++) {
      var src = songs[i], s = match[normTitle(src.title)];
      toast('Guardando ' + (i + 1) + ' de ' + songs.length + '…', 60000);
      if (s) {
        if (s === cur) { audio.pause(); curReplaced = true; }
        var old = versionsOf(s).map(function(v){ return v.id; });
        for (var k = 0; k < old.length; k++) { await remove('audio', old[k]); mem.audio.delete(old[k]); }
      } else { s = { id:uid(), title:src.title, lyrics:[], added:Date.now() }; state.songs.push(s); }
      s.title = src.title; s.lyrics = src.lyrics; s.notes = src.notes; s.parts = src.parts;
      if (src.transpose) s.transpose = src.transpose; else delete s.transpose;
      if (src.pitches.length) s.pitches = src.pitches; else delete s.pitches;
      var vers = [];
      for (var j = 0; j < src.audio.length; j++) {
        var a = src.audio[j], bytes = await zipData(files[a.file]), id = j === 0 ? s.id : uid();
        var ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), rec = { id:id, buf:ab, type:a.type };
        if (db) await save('audio', rec); else mem.audio.set(id, rec);
        var nm = a.name, base = nm, c = 2; while (vers.some(function(v){ return normTitle(v.name) === normTitle(nm); })) nm = base + ' ' + c++;
        vers.push({ id:id, name:nm, size:ab.byteLength, duration:await probeDuration(ab, a.type) });
      }
      s.size = vers[0].size; s.duration = vers[0].duration;
      if (vers.length > 1) s.versions = vers; else delete s.versions;
      await save('songs', s); ids.push(s.id);
      var pk = normTitle(s.title), pend = state.pending.find(function(x){ return x.id === pk; });
      if (pend) { state.pending = state.pending.filter(function(x){ return x !== pend; }); await remove('pending', pend.id); }
    }
    var pl = null;
    if (plName) {
      pl = plOld || { id:uid(), name:plName, songIds:[] };
      if (!plOld) state.playlists.push(pl);
      pl.songIds = ids; delete pl.pendingTitles;
      await save('playlists', pl);
    }
    var mnIn = cleanMarkNames(data.markNames);
    if (Object.keys(mnIn).length) { var mn = markNames(); Object.keys(mnIn).forEach(function(k){ mn[k] = mnIn[k]; }); setMarkNames(mn); }
  } catch(err) { toast('O pacote não pôde ser importado por completo. Confira o espaço do aparelho.', 6000); render(); return; }
  if (curReplaced) { state.vid = null; await playAt(state.qi, true); }
  if (pl) { state.openPl = pl.id; state.view = 'playlist'; }
  render();
  toast('Pacote importado: ' + songs.length + (songs.length === 1 ? ' música pronta' : ' músicas prontas') + ' para estudar', 4000);
}

/* Trocar o áudio de uma música, mantendo letra, cifras, partes, marcas e playlists */
var swapTarget = null, swapVer = null;
function swapAudio(s, v){ swapTarget = s; swapVer = v || (curSong() === s ? curVersion() : versionsOf(s)[0]); $('#swapFile').value = ''; $('#swapFile').click(); }
function swapAudioMenu(s){
  if (!hasVersions(s)) { swapAudio(s); return; }
  actionSheet('Trocar o áudio de qual versão?', versionsOf(s).map(function(v){ return { label:v.name, fn:function(){ swapAudio(s, v); } }; }));
}
$('#swapFile').addEventListener('change', async function(e){
  var f = e.target.files[0], s = swapTarget, v = swapVer; e.target.value = ''; swapTarget = null; swapVer = null;
  if (!f || !s || state.songs.indexOf(s) < 0) return;
  v = versionsOf(s).find(function(x){ return v && x.id === v.id; }) || versionsOf(s)[0];
  var isMain = v.id === s.id, vsize = isMain ? s.size : v.size;
  if (usedBytes() - (vsize || 0) + f.size > STORAGE_LIMIT) { toast('“' + f.name + '” não cabe no limite de ' + fmtSize(STORAGE_LIMIT) + '. Exclua músicas que saíram do repertório.', 6000); return; }
  toast('Trocando o áudio…');
  var buf, rec, dur;
  try {
    buf = await f.arrayBuffer(); rec = { id:v.id, buf:buf, type:f.type || 'audio/mpeg' };
    dur = await probeDuration(buf, rec.type);
    if (db) await save('audio', rec); else mem.audio.set(v.id, rec);
  } catch(err) { toast('Sem espaço para guardar “' + f.name + '”'); return; }
  var old = vDuration(s, v);
  if (isMain) { s.size = buf.byteLength; s.duration = dur || null; }
  v.size = buf.byteLength; v.duration = dur || null;
  await saveSong(s);
  if (curSong() === s && curVersion().id === v.id) {
    if (state.sync) finishSync(true); if (state.adjust) finishAdjust(true);
    if (curUrl) URL.revokeObjectURL(curUrl);
    curUrl = URL.createObjectURL(new Blob([buf], { type:rec.type }));
    audio.src = curUrl; applyRate();
    state.loopA = state.loopB = null; state.loopPart = null; lastPart = -2; lastActive = -2;
    renderPlayer(); setPlayIcons();
  }
  render();
  var timed = s.lyrics.some(function(l){ return l.t != null; }) || (s.parts && s.parts.length);
  if (timed && old && dur && Math.abs(dur - old) > 2) toast('Áudio trocado. A duração mudou (' + fmt(old) + ' → ' + fmt(dur) + '): confira os tempos em Sincronizar → Ajustar tempos.', 7000);
  else toast('Áudio de “' + s.title + '” trocado. Letra, partes e anotações mantidas.', 3500);
});
async function addFiles(files){
  var added = 0, restored = 0, skipped = [], versAdded = 0;
  /* Kits de naipe: arquivos com o naipe no nome e a mesma música */
  var groups = {}, kits = [];
  files.forEach(function(f){ var sp = splitNaipe(f.name); if (!sp.naipe) return; var k = normTitle(sp.base); (groups[k] = groups[k] || []).push({ f:f, sp:sp }); });
  Object.keys(groups).forEach(function(k){
    var song = state.songs.find(function(s){ return normTitle(s.title) === k; });
    if (groups[k].length >= 2 || song) kits.push({ base:groups[k][0].sp.base, items:groups[k], song:song });
  });
  if (kits.length && await askKits(kits)) {
    var inKit = [];
    for (var g = 0; g < kits.length; g++) {
      var kit = kits[g], song = kit.song;
      kit.items.sort(function(a, b){ return naipeRank(a.sp.naipe) - naipeRank(b.sp.naipe); });
      for (var j = 0; j < kit.items.length; j++) {
        var it = kit.items[j]; inKit.push(it.f);
        if (usedBytes() + it.f.size > STORAGE_LIMIT) { skipped.push(it.f.name); continue; }
        toast('Guardando “' + it.f.name + '”…');
        if (!song) {
          song = await storeAudioFile(it.f); if (!song) continue;
          song.title = kit.base; song.versions = [{ id:song.id, name:it.sp.naipe, size:song.size, duration:song.duration }];
          await save('songs', song); added++;
          try { if (await applyPending(song)) restored++; } catch(e){}
        } else if (await storeVersionFile(song, it.f, it.sp.naipe)) versAdded++;
      }
    }
    files = files.filter(function(f){ return inKit.indexOf(f) < 0; });
  }
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (usedBytes() + f.size > STORAGE_LIMIT) { skipped.push(f.name); continue; }
    toast('Guardando ' + (i+1) + ' de ' + files.length + '…');
    var song = await storeAudioFile(f);
    if (!song) { await new Promise(function(r){ setTimeout(r, 1500); }); continue; }
    added++;
    try { if (await applyPending(song)) restored++; } catch(e){}
  }
  var msg = [];
  if (versAdded) msg.push(versAdded === 1 ? '1 versão adicionada' : versAdded + ' versões adicionadas');
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
    { label:'Adicionar a uma playlist', fn:function(){ addToPlaylistMenu(s); } }
  ].concat(state.pending.length ? [{ label:'Usar letra importada…', fn:function(){ useImportedLyrics(s); } }] : []).concat([
    { label: hasVersions(s) ? 'Versões (' + s.versions.length + ')…' : 'Versões (naipe)…', fn:function(){ versionsSheet(s); } },
    { label:'Trocar o áudio…', fn:function(){ swapAudioMenu(s); } },
    { label:'Renomear', fn:async function(){ var n = await askText('Renomear música', s.title, 'Salvar'); if (n) { s.title = n; await save('songs', s); render(); renderPlayerHead(); updateMediaSession(); } } },
    { label:'Excluir do aparelho', danger:true, fn:async function(){ if (await confirmBox('Excluir “' + s.title + '”? O áudio e a letra serão apagados deste aparelho.', 'Excluir')) deleteSong(id); } }
  ]));
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
  var cur = curSong(), ds = songById(id), delVersions = ds ? versionsOf(ds).map(function(v){ return v.id; }) : [id];
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
  await remove('songs', id);
  for (var k = 0; k < delVersions.length; k++) { await remove('audio', delVersions[k]); mem.audio.delete(delVersions[k]); }
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
    case 'install': doInstall(); break;
    case 'pedal': pedalSheet(); break;
    case 'pendaudio': chooseAudioFor(id); break;
    case 'stage': if (curSong()) enterStage(); else toast('Toque uma música primeiro'); break;
    case 'tutorial': e.preventDefault(); openTutorial(); break;
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
      { label:'Enviar pacote de ensaio (com áudios)…', fn:function(){ exportPack(p); } },
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
      if (lyrLp.suppress) { lyrLp.suppress = false; break; }
      if (stageOn()) { showStageCtl(!$('#player').classList.contains('show-ctl')); break; }
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
   .concat(hasChords(s) ? [
     { label:'Tom: transpor' + (s.transpose ? ' (' + (s.transpose > 0 ? '+' : '−') + Math.abs(s.transpose) + ')' : ''), fn:function(){ transposeSheet(s); } },
     { label: chordsOn() ? 'Esconder cifras' : 'Mostrar cifras', fn:toggleChords }
   ] : [])
   .concat([{ label: hasPitches(s) ? 'Notas iniciais (diapasão)…' : 'Notas iniciais por naipe…', fn:function(){ pitchSheet(s); } }])
   .concat(hasVnotes(s) && myNaipe() ? [{ label: othersHidden() ? 'Mostrar anotações de outros naipes' : 'Esconder anotações de outros naipes', fn:function(){
     try { localStorage.setItem('ensaio-vnotes', othersHidden() ? 'all' : 'mine'); } catch(_){} renderLyrics(); toast(othersHidden() ? 'Só as anotações do seu naipe' : 'Anotações de todos os naipes'); } }] : [])
   .concat([{ label:'Cores do marca-texto', fn:markNamesEditor }, { label:'Exportar letra (.lrc)', fn:function(){ exportLrc(s); } }])
   .concat(state.pending.length ? [{ label:'Usar letra importada…', fn:function(){ useImportedLyrics(s); } }] : [])
   .concat([{ label:'Versões (naipe)…', fn:function(){ versionsSheet(s); } }, { label:'Trocar o áudio…', fn:function(){ swapAudio(s, curVersion()); } }]));
};
$('#pNotes').onclick = function(){ if (curSong()) notesEditor(curSong()); };
$('#mkLegend').onclick = markNamesEditor;
$('#pStage').onclick = enterStage;
$('#pPitch').onclick = $('#stPitch').onclick = function(){ var s = curSong(); if (s) pitchSheet(s); };
$('#versions').addEventListener('click', function(e){
  var b = e.target.closest('.ver-chip'); if (!b) return;
  if (b.dataset.vedit) { var s = curSong(); if (s) versionsSheet(s); return; }
  switchVersion(b.dataset.vid);
});
$('#stExit').onclick = exitStage;
document.querySelectorAll('.st-edge').forEach(function(b){ b.onclick = function(){ stageSong(+b.dataset.st); }; });
['pointerdown','input'].forEach(function(ev){ $('.p-bottom').addEventListener(ev, function(){ if (stageOn() && $('#player').classList.contains('show-ctl')) showStageCtl(true); }, {passive:true}); });
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
$('#bRepeat').onclick = repeatMenu;
$('#bLoop').onclick = function(){
  if (!audio.src) return;
  if (state.loopA == null) { state.loopPart = null; state.loopA = audio.currentTime; toast('Início marcado em ' + fmt(state.loopA) + '. Toque de novo no fim do trecho'); }
  else if (state.loopB == null) {
    if (audio.currentTime <= state.loopA + 0.5) { toast('O fim precisa vir depois do início (' + fmt(state.loopA) + ')'); return; }
    state.loopB = audio.currentTime; audio.currentTime = state.loopA; toast('Repetindo ' + fmt(state.loopA) + ' a ' + fmt(state.loopB));
  } else { state.loopA = state.loopB = null; state.loopPart = null; toast('Repetição desligada'); }
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
/* Segurar (meio segundo, sem arrastar): usado nos versos e nas partes */
function longPress(box, sel, fn){
  var st = { timer:null, start:null, suppress:false };
  box.addEventListener('pointerdown', function(e){
    st.suppress = false;
    var el = e.target.closest(sel); if (!el) return;
    st.start = { x:e.clientX, y:e.clientY };
    clearTimeout(st.timer);
    st.timer = setTimeout(function(){
      st.timer = null; st.suppress = true;
      try { if (navigator.vibrate) navigator.vibrate(15); } catch(_){}
      fn(el);
    }, 550);
  });
  function cancel(e){
    if (!st.timer) return;
    if (e.type === 'pointermove' && st.start && Math.abs(e.clientX - st.start.x) < 10 && Math.abs(e.clientY - st.start.y) < 10) return;
    clearTimeout(st.timer); st.timer = null;
  }
  ['pointerup','pointercancel','pointerleave','pointermove'].forEach(function(ev){ box.addEventListener(ev, cancel, {passive:true}); });
  box.addEventListener('contextmenu', function(e){ if (e.target.closest(sel)) e.preventDefault(); });
  return st;
}
/* Segurar um verso abre a edição do verso (texto, acordes e anotação; o tempo não muda) */
var lyrLp = longPress($('#lyrics'), '.line', function(el){ if (stageOn()) return; var s = curSong(); if (s) lineEditor(s, +el.dataset.i); });
$('#lyrics').addEventListener('click', function(e){ if (stageOn() && !e.target.closest('.line, button')) showStageCtl(!$('#player').classList.contains('show-ctl')); });
/* Partes: tocar pula, segurar abre o menu da parte */
var partLp = longPress($('#parts'), '.part-chip[data-k]', function(el){ partMenu(+el.dataset.k); });
$('#parts').addEventListener('click', function(e){
  if (partLp.suppress) { partLp.suppress = false; return; }
  var b = e.target.closest('.part-chip'); if (!b) return;
  if (b.dataset.add) addPart(); else jumpPart(+b.dataset.k);
});
['pointerdown','touchstart','wheel'].forEach(function(ev){ $('#parts').addEventListener(ev, function(){ partsTouchAt = Date.now(); }, {passive:true}); });

var seek = $('#seek');
seek.addEventListener('input', function(){ seeking = true; $('#tCur').textContent = fmt(seek.value / 1000 * (audio.duration || 0)); });
seek.addEventListener('change', function(){ if (audio.duration) audio.currentTime = seek.value / 1000 * audio.duration; seeking = false; lastActive = -2; userScrollAt = 0; });

/* Eventos do áudio */
audio.addEventListener('play', function(){ setPlayIcons(); requestWake(); });
audio.addEventListener('pause', function(){ setPlayIcons(); if (!stageOn()) releaseWake(); });
audio.addEventListener('timeupdate', checkLoop);
audio.addEventListener('loadedmetadata', function(){
  applyRate(); renderTools();
  var s = curSong();
  if (s && isFinite(audio.duration) && !s.duration) { s.duration = audio.duration; save('songs', s).catch(function(){}); renderView(); }
});
audio.addEventListener('ended', function(){
  if (state.sync) finishSync();
  if (state.adjust) { setPlayIcons(); return; }
  /* Trecho repetindo até o fim da música (ex.: a última parte): volta ao início do trecho */
  if (state.loopA != null && state.loopB != null) { audio.currentTime = state.loopA; lastActive = -2; audio.play().catch(function(){}); return; }
  if (repeatMode === 'one') { restartSong(); audio.play().catch(function(){}); return; }
  if (repeatMode === 'stop') { restartSong(); setPlayIcons(); return; }
  if (state.qi < state.queue.length - 1) playAt(state.qi + 1);
  else if (repeatMode === 'all') playAt(0);
  else { restartSong(); setPlayIcons(); }
});
audio.addEventListener('error', function(){ if (audio.src) toast('Este formato de áudio não toca neste aparelho'); });

/* ---------- Modo palco: tela cheia só com a letra ---------- */
var stageCtlTimer = null;
function stageOn(){ return $('#player').classList.contains('stage'); }
function nextTitle(){
  var j = state.qi + 1;
  if (j >= state.queue.length) j = repeatMode === 'all' && state.queue.length > 1 ? 0 : -1;
  var s = j >= 0 ? songById(state.queue[j]) : null;
  return s ? s.title : null;
}
function renderStage(){
  if (!stageOn()) return;
  var s = curSong(), nx = nextTitle();
  $('#stTitle').textContent = s ? s.title : '';
  $('#stNext').innerHTML = (state.queue.length > 1 ? '<b>' + (state.qi + 1) + ' de ' + state.queue.length + '</b> · ' : '') + (hasVersions(s) ? '<b>' + esc(curVersion().name) + '</b> · ' : '') + (nx ? 'A seguir: ' + esc(nx) : 'Última música');
}
function enterStage(){
  if (!curSong() || stageOn()) return;
  if (!playerOpen) openPlayer();
  if (state.sync) finishSync();
  if (state.adjust) finishAdjust();
  $('#player').classList.add('stage'); $('#stageTop').hidden = false;
  renderStage(); showStageCtl(false);
  try { var el = document.documentElement; if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen({ navigationUI:'hide' }).catch(function(){}); } catch(e){}
  try { history.pushState({ stage:true }, ''); } catch(e){}
  requestWake();
  setTimeout(function(){ lastActive = -2; userScrollAt = 0; updateActive(); }, 80);
  toast('Modo palco: toque na letra para ver os controles. Nas bordas, troca de música.', 3500);
}
function hideStage(){
  $('#player').classList.remove('stage', 'show-ctl'); $('#stageTop').hidden = true;
  clearTimeout(stageCtlTimer);
  try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function(){}); } catch(e){}
  if (audio.paused) releaseWake();
  setTimeout(function(){ lastActive = -2; userScrollAt = 0; updateActive(); }, 80);
}
function exitStage(){
  if (!stageOn()) return;
  hideStage();
  if (history.state && history.state.stage) history.back();
}
function showStageCtl(on){
  var p = $('#player'); clearTimeout(stageCtlTimer);
  p.classList.toggle('show-ctl', !!on);
  if (on) stageCtlTimer = setTimeout(function hide(){
    if (!$('#modal').hidden || seeking) { stageCtlTimer = setTimeout(hide, 2000); return; }
    p.classList.remove('show-ctl');
  }, 5000);
}
/* No palco, trocar de música deixa a próxima pronta, sem tocar: a banda entra junto */
function stageSong(d){
  var j = state.qi + d;
  if (j >= state.queue.length) { if (repeatMode === 'all' && state.queue.length > 1) j = 0; else { toast('Esta é a última música da fila'); return; } }
  if (j < 0) { toast('Esta é a primeira música da fila'); return; }
  playAt(j, true).then(function(){ renderStage(); showStageCtl(true); var s = curSong(); if (s) toast('Pronta: ' + s.title + '. Toque em ▶ para começar', 3000); });
}
window.addEventListener('popstate', function(){ if (stageOn() && !(history.state && history.state.stage)) hideStage(); });
document.addEventListener('fullscreenchange', function(){ if (!document.fullscreenElement && stageOn()) setTimeout(function(){ lastActive = -2; updateActive(); }, 80); });

/* ---------- Pedal e teclado ---------- */
var PEDAL = {
  parts: { label:'Partes', down:'próxima parte', up:'começo da parte (2 toques: parte anterior)' },
  play:  { label:'Tocar', down:'tocar / pausar', up:'volta ao começo da parte' },
  songs: { label:'Músicas', down:'próxima música', up:'música anterior' }
};
function pedalMode(){ try { var m = localStorage.getItem('ensaio-pedal'); return PEDAL[m] ? m : 'parts'; } catch(e){ return 'parts'; } }
function seekBy(d){ if (!audio.src) return; audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + d)); lastActive = -2; userScrollAt = 0; }
var noPartsWarned = false;
function partStart(){
  var s = curSong(), p = partsOf(s); if (!audio.src) return;
  if (!p.length) { seekBy(-5); return; }
  var cur = partAt(s, audio.currentTime);
  if (cur < 0) { audio.currentTime = 0; lastActive = -2; return; }
  if (audio.currentTime - p[cur].t > 2 || cur === 0) jumpPart(cur); else jumpPart(cur - 1);
}
function partStep(d){
  var s = curSong(), p = partsOf(s); if (!s || !audio.src) return;
  if (!p.length) {
    seekBy(d * 5);
    if (!noPartsWarned) { noPartsWarned = true; toast('Esta música não tem partes marcadas: o pedal avança e volta 5 s', 3000); }
    return;
  }
  if (d < 0) { partStart(); return; }
  var cur = partAt(s, audio.currentTime);
  if (cur + 1 < p.length) jumpPart(cur + 1); else toast('Esta é a última parte');
}
function songStep(d){
  if (stageOn()) { stageSong(d); return; }
  var j = state.qi + d;
  if (j >= state.queue.length) { if (repeatMode === 'all' && state.queue.length > 1) j = 0; else { toast('Esta é a última música da fila'); return; } }
  if (j < 0) { toast('Esta é a primeira música da fila'); return; }
  playAt(j);
}
function pedal(d){
  var m = pedalMode();
  if (m === 'play') { if (d > 0) toggle(); else partStart(); }
  else if (m === 'songs') songStep(d);
  else partStep(d);
}
function loopCurrentPart(){
  var s = curSong(), p = partsOf(s), cur = partAt(s, audio.currentTime);
  if (cur < 0) { toast('Marque as partes da música para repetir uma delas'); return; }
  if (state.loopPart === p[cur]) stopLoop(); else loopPart(p[cur]);
}
function pedalSheet(){
  function body(){
    var cur = pedalMode();
    return '<h2>Pedal e teclado</h2><p>Pedais de virar página (Bluetooth) funcionam como teclado. Escolha o que os dois botões do pedal fazem:</p>' +
      '<div class="acts">' + Object.keys(PEDAL).map(function(k){
        var x = PEDAL[k];
        return '<button class="act pedal-opt' + (k === cur ? ' on' : '') + '" data-pm="' + k + '"><b>' + x.label + (k === cur ? '  ✓' : '') + '</b><span>Direito ou de baixo: ' + x.down + '<br>Esquerdo ou de cima: ' + x.up + '</span></button>';
      }).join('') + '</div>' +
      '<h3 class="kb-h">Teclado</h3><dl class="kb">' +
      '<dt>Espaço</dt><dd>tocar / pausar</dd><dt>← →</dt><dd>voltar / avançar 5 s</dd>' +
      '<dt>↑ ↓ · PgUp PgDn</dt><dd>os botões do pedal</dd><dt>Shift + ← →, P N</dt><dd>música anterior / próxima</dd>' +
      '<dt>L</dt><dd>repetir a parte atual (liga e desliga)</dd><dt>F</dt><dd>modo palco</dd><dt>?</dt><dd>esta janela</dd></dl>' +
      '<p class="small">Se o pedal não responder, confira se ele está pareado com o celular e no modo de setas ou de página (veja o manual do pedal).</p>' +
      '<div class="m-actions"><span class="grow"></span><button class="btn" data-m="x">Pronto</button></div>';
  }
  modal(body());
  $('#sheet').onclick = function(e){
    var o = e.target.closest('[data-pm]');
    if (o) { try { localStorage.setItem('ensaio-pedal', o.dataset.pm); } catch(_){} $('#sheet').innerHTML = body(); toast('Pedal: ' + PEDAL[o.dataset.pm].label); return; }
    var b = e.target.closest('[data-m]'); if (b) closeModal();
  };
}
document.addEventListener('keydown', function(e){
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$('#modal').hidden || tutorialOpen()) return;
  var t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  var k = e.key, done = true;
  if (k === '?') { pedalSheet(); e.preventDefault(); return; }
  if (!curSong()) return;
  switch (k) {
    case ' ': case 'k': case 'K': toggle(); break;
    case 'PageDown': pedal(1); break;
    case 'PageUp': pedal(-1); break;
    case 'ArrowDown': if (playerOpen) pedal(1); else done = false; break;
    case 'ArrowUp': if (playerOpen) pedal(-1); else done = false; break;
    case 'ArrowRight': if (e.shiftKey) songStep(1); else seekBy(5); break;
    case 'ArrowLeft': if (e.shiftKey) songStep(-1); else seekBy(-5); break;
    case 'n': case 'N': songStep(1); break;
    case 'p': case 'P': songStep(-1); break;
    case 'l': case 'L': loopCurrentPart(); break;
    case 'f': case 'F': if (stageOn()) exitStage(); else enterStage(); break;
    case 'v': case 'V': if (hasVersions(curSong())) cycleVersion(); else done = false; break;
    default: done = false;
  }
  if (done) e.preventDefault();
});

/* Duração do repertório */
function durText(sec){ var m = Math.round(sec / 60); if (m < 60) return m + ' min'; return Math.floor(m / 60) + ' h ' + (m % 60 < 10 ? '0' : '') + (m % 60) + ' min'; }
function plDuration(p){
  var tot = 0, unknown = 0;
  p.songIds.forEach(function(id){ var s = songById(id); if (s && s.duration) tot += s.duration; else unknown++; });
  return tot ? (unknown ? 'mais de ' : '') + durText(tot) : '';
}

/* ---------- Tutorial (tutorial.html por cima do app, para a música continuar) ---------- */
function tutorialOpen(){ return !$('#tutorial').hidden; }
function openTutorial(){
  var f = $('#tutFrame');
  if (!f.getAttribute('src')) f.setAttribute('src', 'tutorial.html');
  else try { var r = f.contentDocument.documentElement, t = getTheme(); if (t === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', t); } catch(e){}
  $('#tutorial').hidden = false;
  try { history.pushState({ tutorial:true }, ''); } catch(e){}
  try { f.focus(); } catch(e){}
}
function hideTutorial(){ $('#tutorial').hidden = true; }
function closeTutorial(){
  if (!tutorialOpen()) return;
  hideTutorial();
  if (history.state && history.state.tutorial) history.back();
}
window.addEventListener('popstate', function(){ if (tutorialOpen()) hideTutorial(); });
window.addEventListener('message', function(e){ if (e.origin === location.origin && e.data === 'ensaio:fechar-tutorial') closeTutorial(); });
document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && tutorialOpen() && $('#modal').hidden) closeTutorial(); });

/* ---------- App instalável (PWA) ---------- */
var installPrompt = null;
function isInstalled(){
  return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}
function renderInstall(){
  var box = $('#installBox'); if (!box) return;
  if (isInstalled()) { box.innerHTML = '<p class="install-ok">✓ Você já está usando o app instalado.</p>'; return; }
  box.innerHTML = installPrompt ? '<button class="btn" data-act="install">Instalar o app</button>' : '';
}
window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault(); installPrompt = e;   /* guarda para mostrar o botão só na Ajuda, sem barra intrusiva */
  renderInstall();
});
window.addEventListener('appinstalled', function(){ installPrompt = null; renderInstall(); toast('Ensaio instalado na tela de início'); });
async function doInstall(){
  if (!installPrompt) { var d = $('#installHelp'); if (d) d.open = true; return; }
  var p = installPrompt; installPrompt = null;
  try { await p.prompt(); var r = await p.userChoice; if (r && r.outcome !== 'accepted') installPrompt = p; } catch(e){}
  renderInstall();
}

/* Versão nova: o service worker novo espera; o app pergunta antes de trocar (não recarrega no meio de uma música) */
var swWaiting = null, swReloading = false;
function showUpdate(w){
  swWaiting = w;
  $('#updateBar').hidden = false;
}
$('#updateBtn').onclick = function(){
  if (!swWaiting) return;
  $('#updateBar').hidden = true;
  swWaiting.postMessage('skipWaiting');
};
$('#updateLater').onclick = function(){ $('#updateBar').hidden = true; };
function registerSW(){
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js').then(function(reg){
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', function(){
      var w = reg.installing; if (!w) return;
      w.addEventListener('statechange', function(){
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
      });
    });
    /* Procura versão nova ao voltar para o app */
    document.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'visible') reg.update().catch(function(){}); });
  }).catch(function(){});
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    if (swReloading || !swWaiting) return;   /* primeira instalação: não recarrega */
    swReloading = true; location.reload();
  });
}

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
  registerSW();
  requestAnimationFrame(tick);
  try { if (window.claude && typeof window.claude.use === 'function') downloadsNs = await window.claude.use('downloads'); } catch(e){ downloadsNs = null; }
})();
})();
