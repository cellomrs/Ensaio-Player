/* Service worker do Ensaio: guarda o app no aparelho para abrir sem internet.
 *
 * AO PUBLICAR QUALQUER MUDANÇA em index.html, css, js ou img, aumente VERSION.
 * É isso que faz o celular baixar a versão nova e mostrar o aviso "Nova versão disponível".
 *
 * As músicas, letras e playlists NÃO passam por aqui: ficam no IndexedDB e não são afetadas
 * pela troca de versão.
 */
var VERSION = 'ensaio-v2';
var FONTS = 'ensaio-fontes';

var SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'manifest.webmanifest',
  'img/logo-96.png',
  'img/favicon-32.png',
  'img/apple-touch-icon.png',
  'img/icon-192.png',
  'img/icon-512.png',
  'img/icon-maskable-192.png',
  'img/icon-maskable-512.png'
];

self.addEventListener('install', function(e){
  /* cache: 'reload' evita pegar arquivos velhos do cache HTTP do navegador */
  e.waitUntil(caches.open(VERSION).then(function(c){
    return c.addAll(SHELL.map(function(u){ return new Request(u, { cache: 'reload' }); }));
  }));
  /* Não assume o controle sozinho: o app pergunta antes, para não recarregar no meio de uma música */
});

self.addEventListener('message', function(e){
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== VERSION && k !== FONTS; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  /* Fontes do Google: usa a cópia guardada e atualiza em segundo plano */
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(function(c){
      return c.match(req).then(function(hit){
        var net = fetch(req).then(function(res){ if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; })
          .catch(function(){ return hit; });
        return hit || net;
      });
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;

  /* Abrir o app (navegação): sempre a página guardada, com ou sem internet */
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html', { ignoreSearch: true }).then(function(hit){
      return hit || fetch(req);
    }).catch(function(){ return fetch(req); }));
    return;
  }

  /* Demais arquivos do app: cópia guardada primeiro; se não tiver, busca na rede */
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function(hit){
    return hit || fetch(req);
  }));
});
