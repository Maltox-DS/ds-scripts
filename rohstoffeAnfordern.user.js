// ==UserScript==
// @name         Rohstoffe anfordern by Maltox
// @namespace    https://github.com/Maltox-DS/ds-scripts
// @version      2.0.0
// @description  Lädt "Rohstoffe anfordern" immer aktuell von GitHub (Buttons im Hauptgebäude und Adelshof).
// @author       Maltox
// @match        https://*.die-staemme.de/game.php*
// @grant        none
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/Maltox-DS/ds-scripts/main/rohstoffeAnfordern.user.js
// @updateURL    https://raw.githubusercontent.com/Maltox-DS/ds-scripts/main/rohstoffeAnfordern.user.js
// ==/UserScript==

/*
 * Nur ein Loader: der eigentliche Code liegt in rohstoffeAnfordernButtons.js im Repo
 * und wird bei jedem Aufruf von Hauptgebäude oder Adelshof über jsDelivr geladen.
 * Zum Testen eines bestimmten Stands @main durch einen Commit-Hash ersetzen.
 */
(function () {
  'use strict';
  var REF = 'main';
  var gd = window.game_data;
  var screen = gd && gd.screen ? gd.screen : (location.search.match(/[?&]screen=([^&]+)/) || [])[1];
  if (screen !== 'main' && screen !== 'snob') return;
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/gh/Maltox-DS/ds-scripts@' + REF + '/rohstoffeAnfordernButtons.js';
  s.async = true;
  document.head.appendChild(s);
})();
