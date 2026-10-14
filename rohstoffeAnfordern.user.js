// ==UserScript==
// @name         Rohstoffe anfordern by Maltox
// @namespace    https://github.com/Maltox-DS/ds-scripts
// @version      2.2.0
// @description  Lädt "Rohstoffe anfordern" immer aktuell von GitHub (Buttons im Hauptgebäude und Adelshof).
// @author       Maltox
// @match        https://*.die-staemme.de/game.php*
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/Maltox-DS/ds-scripts/main/rohstoffeAnfordern.user.js
// @updateURL    https://raw.githubusercontent.com/Maltox-DS/ds-scripts/main/rohstoffeAnfordern.user.js
// ==/UserScript==

/*
 * Nur ein Loader: der eigentliche Code liegt in rohstoffeAnfordernButtons.js im Repo.
 * jsDelivr merkt sich bis zu 12 h, welcher Commit "main" ist – deshalb fragt der Loader
 * den aktuellen Commit bei GitHub ab (höchstens alle 5 Minuten) und lädt genau diesen Stand.
 * Zum Testen eines bestimmten Stands REF auf einen Commit-Hash setzen.
 */
(function () {
  'use strict';
  var REF = ''; // leer = immer der neueste Commit auf main
  var REPO = 'Maltox-DS/ds-scripts';
  var FILE = 'rohstoffeAnfordernButtons.js';
  var KEY = 'rohAnf_sha';

  var screen = (location.search.match(/[?&]screen=([^&#]+)/) || [])[1];
  if (screen !== 'main' && screen !== 'snob') return;

  function inject(ref) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/gh/' + REPO + '@' + ref + '/' + FILE;
    s.async = true;
    document.head.appendChild(s);
  }
  if (REF) { inject(REF); return; }

  var cached = null;
  try { cached = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* egal */ }
  if (cached && cached.sha && Date.now() - cached.t < 5 * 60 * 1000) { inject(cached.sha); return; }
  function fallback() { inject(cached && cached.sha ? cached.sha : 'main'); }

  GM_xmlhttpRequest({
    method: 'GET',
    url: 'https://api.github.com/repos/' + REPO + '/commits/main',
    headers: { Accept: 'application/vnd.github.sha' },
    timeout: 4000,
    onload: function (r) {
      var sha = r.status === 200 ? String(r.responseText).trim() : '';
      if (!/^[0-9a-f]{40}$/.test(sha)) { fallback(); return; }
      try { localStorage.setItem(KEY, JSON.stringify({ sha: sha, t: Date.now() })); } catch (e) { /* egal */ }
      inject(sha);
    },
    onerror: fallback,
    ontimeout: fallback
  });
})();
