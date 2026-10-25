/* Reproductor de música de "Una Aventura Congelada".
 *
 * Un solo archivo para todo el sitio:
 *  - Mantiene un <audio> y la lista de canciones (/audio/playlist.json, la genera
 *    scripts/importar_musica.js).
 *  - Muestra una barra flotante abajo mientras haya una canción en curso. Guarda la canción y el
 *    segundo en localStorage; al cambiar de página la retoma donde quedó. Si el navegador no
 *    permite arrancar solo (por ejemplo iPhone), la barra aparece en pausa en el mismo punto.
 *  - Expone window.B612Player para que una página (fotos-videos.html) dibuje la lista completa.
 *
 * Mientras nadie haya puesto play no se muestra nada ni se descarga ningún audio.
 */
(function () {
  'use strict';
  if (window.B612Player) return;

  var KEY = 'b612.player.v1';
  var LISTA = '/audio/playlist.json';
  var CARPETA = '/audio/';
  var FRESCO_MS = 15000; // si la página anterior se cerró hace menos de esto, se reanuda sola

  var audio = new Audio();
  audio.preload = 'none';

  var tracks = [];
  var cur = -1;
  var cargando = null;
  var ui = null;
  var arrastrando = false;
  var ultimoGuardado = 0;
  var oyentes = [];
  var canal = null;
  var idPestana = Math.random().toString(36).slice(2);

  /* ---------- estado guardado ---------- */
  function leerEstado() {
    try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; }
  }
  function guardar(forzar) {
    var ahora = Date.now();
    if (!forzar && ahora - ultimoGuardado < 1000) return;
    ultimoGuardado = ahora;
    try {
      if (cur < 0) { localStorage.removeItem(KEY); return; }
      localStorage.setItem(KEY, JSON.stringify({
        a: tracks[cur].archivo,
        t: Math.floor(audio.currentTime || 0),
        playing: !audio.paused && !audio.ended,
        ts: ahora
      }));
    } catch (e) { /* modo privado o cuota: se sigue sin guardar */ }
  }

  /* ---------- lista ---------- */
  function cargar() {
    if (cargando) return cargando;
    cargando = fetch(LISTA, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { tracks = (j && j.canciones) || []; return tracks; })
      .catch(function (e) { cargando = null; throw e; });
    return cargando;
  }

  function avisar() {
    var det = { index: cur, playing: !audio.paused && !audio.ended };
    oyentes.forEach(function (f) { try { f(det); } catch (e) {} });
    document.dispatchEvent(new CustomEvent('b612player', { detail: det }));
  }

  /* ---------- reproducción ---------- */
  function ponerPista(i, desde) {
    cur = i;
    var p = tracks[i];
    audio.src = CARPETA + encodeURIComponent(p.archivo);
    audio.preload = 'metadata';
    if (desde > 0) { try { audio.currentTime = desde; } catch (e) {} }
    construirUI();
    pintarPista();
    mediaSession();
    avisar();
  }

  function reproducir(i) {
    return cargar().then(function () {
      if (i == null) i = cur >= 0 ? cur : 0;
      if (!tracks[i]) return;
      if (i !== cur) ponerPista(i, 0);
      construirUI();
      return audio.play().catch(function () { pintarEstado(); });
    });
  }

  function alternar(i) {
    if (i != null && i !== cur) return reproducir(i);
    if (cur < 0) return reproducir(0);
    if (audio.paused || audio.ended) return reproducir(cur);
    audio.pause();
    return Promise.resolve();
  }

  function siguiente() {
    if (cur < 0) return;
    if (cur + 1 < tracks.length) reproducir(cur + 1);
  }
  function anterior() {
    if (cur < 0) return;
    if (audio.currentTime > 3 || cur === 0) { audio.currentTime = 0; return; }
    reproducir(cur - 1);
  }

  function cerrar() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    cur = -1;
    guardar(true);
    if (ui) { ui.raiz.remove(); ui = null; }
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    avisar();
  }

  audio.addEventListener('play', function () {
    if (canal) canal.postMessage({ de: idPestana });
    pintarEstado(); guardar(true); avisar();
  });
  audio.addEventListener('pause', function () { pintarEstado(); guardar(true); avisar(); });
  audio.addEventListener('ended', function () {
    if (cur + 1 < tracks.length) { reproducir(cur + 1); return; }
    audio.currentTime = 0; pintarEstado(); guardar(true); avisar();
  });
  audio.addEventListener('timeupdate', function () { pintarTiempo(); guardar(false); });
  audio.addEventListener('loadedmetadata', pintarTiempo);
  audio.addEventListener('durationchange', pintarTiempo);
  audio.addEventListener('error', function () {
    if (ui) ui.artista.textContent = 'No se pudo cargar esta canción';
  });
  audio.addEventListener('volumechange', function () { if (ui) ui.vol.value = audio.volume; });
  window.addEventListener('pagehide', function () { guardar(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') guardar(true);
  });

  // Si suena en otra pestaña, esta se pausa.
  if ('BroadcastChannel' in window) {
    canal = new BroadcastChannel('b612-player');
    canal.onmessage = function (e) {
      if (e.data && e.data.de !== idPestana && !audio.paused) audio.pause();
    };
  }

  /* ---------- pantalla bloqueada / auriculares ---------- */
  function mediaSession() {
    if (!('mediaSession' in navigator) || cur < 0) return;
    var p = tracks[cur];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: p.titulo,
        artist: p.cantante || 'Una Aventura Congelada',
        album: 'Una Aventura Congelada',
        artwork: [{ src: '/images/logo-obra.webp', sizes: '512x512', type: 'image/webp' }]
      });
      navigator.mediaSession.setActionHandler('play', function () { reproducir(cur); });
      navigator.mediaSession.setActionHandler('pause', function () { audio.pause(); });
      navigator.mediaSession.setActionHandler('previoustrack', anterior);
      navigator.mediaSession.setActionHandler('nexttrack', siguiente);
      navigator.mediaSession.setActionHandler('seekto', function (d) { audio.currentTime = d.seekTime; });
    } catch (e) {}
  }

  /* ---------- barra flotante ---------- */
  var CSS =
    '.b612mp{position:fixed;left:50%;bottom:calc(12px + env(safe-area-inset-bottom));transform:translateX(-50%);' +
    'width:min(540px,calc(100% - 24px));z-index:9;display:flex;align-items:center;gap:6px;padding:14px 10px 8px;' +
    'background:rgba(16,24,39,.94);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
    'border:1px solid #2d6f9e;border-radius:14px;box-shadow:0 6px 26px rgba(0,0,0,.55),0 0 14px rgba(143,214,239,.18);' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e8ecf4;box-sizing:border-box}' +
    '.b612mp *{box-sizing:border-box}' +
    'body:has(#sticky-tickets.visible) .b612mp{bottom:calc(72px + env(safe-area-inset-bottom))}' +
    'body:has(.buy-bar.visible) .b612mp{bottom:calc(128px + env(safe-area-inset-bottom))}' +
    '.b612mp button{background:none;border:0;color:#eaf6ff;cursor:pointer;padding:0;width:34px;height:34px;display:flex;' +
    'align-items:center;justify-content:center;border-radius:50%;flex-shrink:0;-webkit-tap-highlight-color:transparent}' +
    '.b612mp button:hover,.b612mp button:focus-visible{background:rgba(143,214,239,.16)}' +
    '.b612mp button svg{width:18px;height:18px;fill:currentColor}' +
    '.b612mp .b612mp-play{width:38px;height:38px;background:linear-gradient(135deg,#123456,#2d6f9e);border:1px solid #8fd6ef}' +
    '.b612mp .b612mp-play svg{width:20px;height:20px}' +
    '.b612mp-info{flex:1 1 auto;min-width:0;padding:0 4px}' +
    '.b612mp-title{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.b612mp-artist{font-size:11.5px;color:#9aa4b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.b612mp-time{font-size:11.5px;color:#9aa4b8;font-variant-numeric:tabular-nums;white-space:nowrap;flex-shrink:0}' +
    '.b612mp-vol{width:70px;flex-shrink:0;accent-color:#8fd6ef}' +
    '.b612mp-seek{position:absolute;left:10px;right:10px;top:0;width:calc(100% - 20px);height:14px;margin:0;' +
    'background:transparent;-webkit-appearance:none;appearance:none;cursor:pointer}' +
    '.b612mp-seek::-webkit-slider-runnable-track{height:3px;border-radius:2px;' +
    'background:linear-gradient(90deg,#8fd6ef var(--p,0%),#2a3350 var(--p,0%))}' +
    '.b612mp-seek::-moz-range-track{height:3px;border-radius:2px;background:#2a3350}' +
    '.b612mp-seek::-moz-range-progress{height:3px;border-radius:2px;background:#8fd6ef}' +
    '.b612mp-seek::-webkit-slider-thumb{-webkit-appearance:none;width:11px;height:11px;border-radius:50%;background:#eaf6ff;margin-top:-4px}' +
    '.b612mp-seek::-moz-range-thumb{width:11px;height:11px;border:0;border-radius:50%;background:#eaf6ff}' +
    '@media (max-width:640px){.b612mp-vol{display:none}}' +
    '@media (max-width:420px){.b612mp-time{display:none}.b612mp .b612mp-prev{display:none}}';

  var ICON = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"/></svg>'
  };

  function boton(clase, etiqueta, icono, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = clase;
    b.setAttribute('aria-label', etiqueta);
    b.innerHTML = icono;
    b.addEventListener('click', fn);
    return b;
  }

  function construirUI() {
    if (ui || !document.body) return;
    var estilo = document.createElement('style');
    estilo.textContent = CSS;
    var raiz = document.createElement('div');
    raiz.className = 'b612mp';
    raiz.setAttribute('role', 'region');
    raiz.setAttribute('aria-label', 'Reproductor de música de la obra');

    var seek = document.createElement('input');
    seek.type = 'range'; seek.className = 'b612mp-seek'; seek.min = 0; seek.max = 1000; seek.value = 0; seek.step = 1;
    seek.setAttribute('aria-label', 'Posición de la canción');
    seek.addEventListener('pointerdown', function () { arrastrando = true; });
    seek.addEventListener('pointerup', function () { arrastrando = false; });
    seek.addEventListener('input', function () {
      var d = duracionActual();
      if (d) audio.currentTime = (seek.value / 1000) * d;
      seek.style.setProperty('--p', (seek.value / 10) + '%');
    });

    var prev = boton('b612mp-prev', 'Canción anterior', ICON.prev, anterior);
    var play = boton('b612mp-play', 'Reproducir', ICON.play, function () { alternar(); });
    var next = boton('b612mp-next', 'Canción siguiente', ICON.next, siguiente);
    var info = document.createElement('div'); info.className = 'b612mp-info';
    var titulo = document.createElement('div'); titulo.className = 'b612mp-title';
    var artista = document.createElement('div'); artista.className = 'b612mp-artist';
    info.appendChild(titulo); info.appendChild(artista);
    var tiempo = document.createElement('span'); tiempo.className = 'b612mp-time';
    var vol = document.createElement('input');
    vol.type = 'range'; vol.className = 'b612mp-vol'; vol.min = 0; vol.max = 1; vol.step = 0.05; vol.value = audio.volume;
    vol.setAttribute('aria-label', 'Volumen');
    vol.addEventListener('input', function () {
      audio.volume = parseFloat(vol.value);
      try { localStorage.setItem(KEY + '.vol', String(audio.volume)); } catch (e) {}
    });
    var cerrarB = boton('b612mp-close', 'Cerrar reproductor', ICON.close, cerrar);

    [seek, prev, play, next, info, tiempo, vol, cerrarB].forEach(function (n) { raiz.appendChild(n); });
    document.head.appendChild(estilo);
    document.body.appendChild(raiz);
    ui = { raiz: raiz, seek: seek, play: play, titulo: titulo, artista: artista, tiempo: tiempo, vol: vol, estilo: estilo };

    // Deja libre el final de la página para que la barra no tape el último contenido. No se toca
    // en la portada (index.html), que usa pantallas completas con scroll-snap.
    var snap = getComputedStyle(document.documentElement).scrollSnapType;
    if (!snap || snap === 'none') {
      var actual = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
      if (actual < 90) document.body.style.paddingBottom = '90px';
    }
  }

  function duracionActual() {
    if (isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return cur >= 0 && tracks[cur].duracion ? tracks[cur].duracion : 0;
  }
  function mmss(s) {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function pintarPista() {
    if (!ui || cur < 0) return;
    var p = tracks[cur];
    ui.titulo.textContent = (p.n != null ? p.n + '. ' : '') + p.titulo;
    ui.artista.textContent = p.cantante || 'Una Aventura Congelada';
    pintarEstado();
    pintarTiempo();
  }
  function pintarEstado() {
    if (!ui) return;
    var suena = !audio.paused && !audio.ended;
    ui.play.innerHTML = suena ? ICON.pause : ICON.play;
    ui.play.setAttribute('aria-label', suena ? 'Pausar' : 'Reproducir');
  }
  function pintarTiempo() {
    if (!ui) return;
    var d = duracionActual();
    ui.tiempo.textContent = mmss(audio.currentTime) + ' / ' + mmss(d);
    if (!arrastrando && d) {
      var v = Math.min(1000, (audio.currentTime / d) * 1000);
      ui.seek.value = v;
      ui.seek.style.setProperty('--p', (v / 10) + '%');
    }
  }

  /* ---------- arranque: retomar donde quedó ---------- */
  function retomar() {
    var st = leerEstado();
    try {
      var v = parseFloat(localStorage.getItem(KEY + '.vol'));
      if (isFinite(v) && v >= 0 && v <= 1) audio.volume = v;
    } catch (e) {}
    if (!st || !st.a) return;
    cargar().then(function () {
      var i = tracks.findIndex(function (t) { return t.archivo === st.a; });
      if (i < 0) return;
      ponerPista(i, st.t || 0);
      if (st.playing && Date.now() - st.ts < FRESCO_MS) {
        audio.play().catch(function () { pintarEstado(); }); // sin permiso: queda en pausa, un toque basta
      }
    }).catch(function () {});
  }

  window.B612Player = {
    load: cargar,
    tracks: function () { return tracks; },
    index: function () { return cur; },
    isPlaying: function () { return !audio.paused && !audio.ended; },
    time: function () { return { t: audio.currentTime || 0, d: duracionActual() }; },
    seek: function (s) {
      if (cur < 0) return;
      try { audio.currentTime = Math.max(0, s); } catch (e) {}
      pintarTiempo(); guardar(true);
    },
    // Deja lista la canción i en el segundo t, sin reproducir (los navegadores no dejan arrancar solos)
    cue: function (i, t) {
      return cargar().then(function () { if (tracks[i]) ponerPista(i, t || 0); });
    },
    play: reproducir,
    toggle: alternar,
    next: siguiente,
    prev: anterior,
    close: cerrar,
    on: function (fn) { oyentes.push(fn); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', retomar);
  else retomar();
})();
