// ==UserScript==
// @name         Rohstoffe anfordern by Maltox
// @namespace    https://github.com/Maltox-DS/ds-scripts
// @version      1.0.0
// @description  Buttons im Hauptgebäude und Adelshof: Bedarf berechnen, Lieferdörfer wählen, per Klick anfordern (eine Anforderung pro Klick).
// @author       Maltox
// @match        https://*.die-staemme.de/game.php*
// @grant        none
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/Maltox-DS/ds-scripts/main/rohstoffeAnfordern.user.js
// @updateURL    https://raw.githubusercontent.com/Maltox-DS/ds-scripts/main/rohstoffeAnfordern.user.js
// ==/UserScript==

/*
 * Nicht von InnoGames freigegeben – Nutzung auf eigenes Risiko.
 * Das Skript fügt nur Buttons ein. Jede Anforderung wird per eigenem Klick verschickt
 * (eine Anforderung = ein Lieferdorf = ein Klick), nichts läuft automatisch.
 */
(function () {
  'use strict';

  var DEBUG = false; // auf true setzen für Diagnose-Ausgaben in der Konsole (F12)

  var w = window;
  if (!w.game_data || !w.jQuery) return;
  var $ = w.jQuery;
  var gd = w.game_data;
  var screen = gd.screen;
  if (screen !== 'main' && screen !== 'snob') return;

  var RES = ['wood', 'stone', 'iron'];
  var RES_DE = { wood: 'Holz', stone: 'Lehm', iron: 'Eisen' };
  var KEY = 'rohAnf_' + gd.world + '_' + gd.player.id;
  var SNOB_COST = { wood: 40000, stone: 50000, iron: 50000 };
  var COIN_FALLBACK = { wood: 28000, stone: 30000, iron: 25000 };

  // ---------- Hilfsfunktionen ----------
  function dbg() { if (DEBUG) try { console.log.apply(console, ['[RohAnf]'].concat([].slice.call(arguments))); } catch (e) { /* egal */ } }
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* egal */ } }
  function num(t) { var n = parseInt(String(t == null ? '' : t).replace(/[^\d]/g, ''), 10); return isNaN(n) ? 0 : n; }
  function fmt(n) { return Number(n || 0).toLocaleString('de-DE'); }
  function icon(r) { return '<span class="icon header ' + r + '"></span>'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function zero() { return { wood: 0, stone: 0, iron: 0 }; }
  function total(o) { return o.wood + o.stone + o.iron; }
  function resCells(o, bold) {
    return RES.map(function (r) {
      var v = fmt(o[r]);
      return '<td style="white-space:nowrap">' + icon(r) + (bold ? '<b>' + v + '</b>' : v) + '</td>';
    }).join('');
  }
  function msg(type, text) { if (w.UI && w.UI[type]) w.UI[type](text); }
  // HTML einer Spielseite sicher parsen (ohne Skripte auszuführen)
  function dom(html) { return $('<div>').append($.parseHTML(String(html))); }

  var cfg = $.extend({ reserve: 5000, merchantCap: 1000, deductStock: true }, load(KEY + '_cfg', {}));
  function saveCfg() { save(KEY + '_cfg', cfg); }

  // ---------- Weltkonfiguration (Münzkosten) ----------
  var coinPromise = null;
  function getCoin() {
    if (coinPromise) return coinPromise;
    var cached = load(KEY + '_coin', null);
    if (cached && cached.t && Date.now() - cached.t < 7 * 864e5) { coinPromise = $.Deferred().resolve(cached).promise(); return coinPromise; }
    coinPromise = $.get('/interface.php?func=get_config').then(function (xml) {
      var $x = $(xml), c = { cost: $.extend({}, COIN_FALLBACK), isCoin: true, t: Date.now() };
      RES.forEach(function (r) { var v = num($x.find('snob coin_' + r).text()); if (v > 0) c.cost[r] = v; });
      var gold = $x.find('snob gold').text();
      if (gold !== '') c.isCoin = gold === '1';
      save(KEY + '_coin', c);
      return c;
    }, function () { return $.Deferred().resolve({ cost: $.extend({}, COIN_FALLBACK), isCoin: true }).promise(); });
    return coinPromise;
  }

  // =====================================================================
  // Buttons einfügen
  // =====================================================================
  function buildingCost(id, $row) {
    var bm = w.BuildingMain && w.BuildingMain.buildings;
    var b = bm && bm[id];
    if (b && b.wood != null && b.stone != null && b.iron != null) {
      var c = { wood: num(b.wood), stone: num(b.stone), iron: num(b.iron) };
      if (!total(c)) return null;
      return { label: (b.name || id) + (b.level_next != null ? ' (Stufe ' + b.level_next + ')' : ''), cost: c };
    }
    var $all = $row.find('[data-cost]');
    if ($all.length < 3) return null;
    var cost = {};
    RES.forEach(function (r, i) {
      var $c = $row.find('.cost_' + r + '[data-cost]');
      if (!$c.length) $c = $all.eq(i);
      var a = $c.attr('data-cost');
      cost[r] = a != null && a !== '' ? num(a) : num($c.text());
    });
    if (!total(cost)) return null;
    var name = $.trim($row.find('td').first().find('a').filter(function () { return $.trim($(this).text()) !== ''; }).first().text()) || id;
    return { label: name, cost: cost };
  }

  function injectHQ() {
    $('#buildings tr[id^="main_buildrow_"]').each(function () {
      var $r = $(this);
      if ($r.find('.ra-btn').length) return;
      var id = this.id.replace('main_buildrow_', '');
      if (!buildingCost(id, $r)) return;
      var $b = $('<a href="#" class="btn ra-btn" style="margin-left:4px;padding:2px 6px" title="Rohstoffe für diese Stufe aus anderen Dörfern anfordern">Anfordern</a>');
      $b.on('click', function (ev) {
        ev.preventDefault();
        var c = buildingCost(id, $r);
        if (c) openRequest([c]);
      });
      $r.children('td').last().append($b);
    });
    if (!$('#ra_bar').length && $('#buildings').length) {
      var $bar = $('<div id="ra_bar" style="margin:4px 0"><a href="#" class="btn" id="ra_free">Rohstoffe anfordern (freie Menge)</a></div>');
      $('#buildings').before($bar);
      $bar.on('click', '#ra_free', function (ev) { ev.preventDefault(); openRequest([]); });
    }
  }

  function injectSnob() {
    if ($('#ra_bar').length) return;
    getCoin().always(function (c) {
      if ($('#ra_bar').length) return;
      c = c || { cost: COIN_FALLBACK, isCoin: true };
      var inp = 'type="number" min="1" value="1" style="width:45px"';
      var html = '<table id="ra_bar" class="vis" style="margin:6px 0"><tr><th colspan="3">Rohstoffe anfordern</th></tr><tr>' +
        (c.isCoin ? '<td><input id="ra_coinN" ' + inp + '> Münze(n) <a href="#" class="btn" id="ra_coin">Anfordern</a></td>' : '') +
        '<td><input id="ra_snobN" ' + inp + '> AG <a href="#" class="btn" id="ra_snob">Anfordern</a></td>' +
        '<td><a href="#" class="btn" id="ra_free">Freie Menge</a></td></tr></table>';
      var $t = $('#content_value').length ? $('#content_value') : $('#contentContainer');
      $t.prepend(html);
      $('#ra_bar').on('click', 'a.btn', function (ev) {
        ev.preventDefault();
        var id = this.id, n;
        if (id === 'ra_coin') { n = Math.max(1, num($('#ra_coinN').val())); openRequest([{ label: n + '× Münze', cost: mul(c.cost, n) }]); }
        else if (id === 'ra_snob') { n = Math.max(1, num($('#ra_snobN').val())); openRequest([{ label: n + '× AG (Einheitenkosten)', cost: mul(SNOB_COST, n) }]); }
        else openRequest([]);
      });
    });
  }
  function mul(c, n) { return { wood: c.wood * n, stone: c.stone * n, iron: c.iron * n }; }

  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  if (screen === 'main') {
    injectHQ();
    var target = document.getElementById('buildings') || document.getElementById('content_value');
    if (target && w.MutationObserver) new MutationObserver(debounce(injectHQ, 250)).observe(target, { childList: true, subtree: true });
  } else {
    injectSnob();
  }

  // =====================================================================
  // Daten laden
  // =====================================================================
  function loadSources() {
    return $.get(gd.link_base_pure + 'overview_villages&mode=prod&group=0&page=-1').then(function (html) {
      var out = [];
      var me = { x: num(gd.village.x), y: num(gd.village.y) };
      dom(html).find('#production_table tr').each(function () {
        var $r = $(this);
        var $vn = $r.find('span.quickedit-vn').first();
        if (!$vn.length) return;
        var id = String($vn.attr('data-id') || '');
        if (!id || id === String(gd.village.id)) return;
        var txt = $.trim($vn.text());
        var coords = txt.match(/\d{1,3}\|\d{1,3}/g);
        if (!coords) return;
        var c = coords[coords.length - 1].split('|');
        var x = num(c[0]), y = num(c[1]);
        var res = {};
        RES.forEach(function (r) {
          var $s = $r.find('span.res.' + r).first();
          if (!$s.length) $s = $r.find('span.' + r + ':not(.icon)').first();
          res[r] = num($s.text());
        });
        var $mc = $r.find('a[href*="screen=market"]').filter(function () { return /\d+\s*\/\s*\d+/.test($(this).text()); }).first();
        var mt = $mc.length ? $mc.text() : $r.children().eq(5).text();
        var mm = mt.match(/(\d+)\s*\/\s*(\d+)/);
        out.push({
          id: id,
          name: ($.trim($r.find('.quickedit-label').first().text()) || txt).replace(/\s*\(\d{1,3}\|\d{1,3}\)\s*K\d+\s*$/, ''),
          coord: x + '|' + y,
          dist: Math.hypot(x - me.x, y - me.y),
          res: res,
          merchants: mm ? num(mm[1]) : 0,
          merchantsTotal: mm ? num(mm[2]) : 0
        });
      });
      out.sort(function (a, b) { return a.dist - b.dist; });
      dbg('Lieferdörfer:', out);
      return out;
    });
  }

  // "Eingehende Rohstoffe" von der Seite Marktplatz → Anfordern
  function loadIncoming() {
    return $.get(gd.link_base_pure + 'market&mode=call').then(function (html) {
      var $d = dom(html);
      var $head = $d.find('th, td, h3, h4').filter(function () { return /Eingehende Rohstoffe/i.test($.trim($(this).text())) && $(this).children().length === 0; }).first();
      if (!$head.length) { dbg('Eingehende Rohstoffe: Block nicht gefunden'); return null; }
      var $t = $head.closest('table');
      var inc = {}, found = 0;
      RES.forEach(function (r, i) {
        var $c = $t.find('td').filter(function () { return $(this).find('.' + r).length > 0; }).first();
        if (!$c.length) $c = $t.find('td').eq(i);
        if ($c.length) found++;
        inc[r] = num($c.text());
      });
      dbg('Eingehende Rohstoffe:', inc);
      return found ? inc : null;
    }, function () { return $.Deferred().resolve(null).promise(); });
  }

  // =====================================================================
  // Berechnung
  // =====================================================================
  function computeNeed(st) {
    var sum = zero();
    st.items.forEach(function (it) { RES.forEach(function (r) { sum[r] += it.cost[r]; }); });
    var cap = num(gd.village.storage_max), need = {}, warn = [];
    RES.forEach(function (r) {
      var stock = num(gd.village[r]);
      need[r] = Math.max(0, sum[r] - (cfg.deductStock ? stock : 0) - st.incoming[r]);
      var free = Math.max(0, cap - stock - st.incoming[r]);
      if (need[r] > free) {
        warn.push(RES_DE[r] + ': Speicher (' + fmt(cap) + ') reicht nicht – auf ' + fmt(free) + ' gekürzt.');
        need[r] = free;
      }
      if (sum[r] > cap) warn.push(RES_DE[r] + ': Der Bedarf (' + fmt(sum[r]) + ') ist größer als dein Speicher.');
    });
    return { sum: sum, need: need, warn: warn };
  }

  function distribute(need, sources) {
    var rest = { wood: need.wood, stone: need.stone, iron: need.iron }, plan = [];
    sources.forEach(function (s) {
      if (total(rest) <= 0) return;
      var take = {};
      RES.forEach(function (r) { take[r] = Math.min(rest[r], Math.max(0, s.res[r] - cfg.reserve)); });
      var sum = total(take), capacity = s.merchants * cfg.merchantCap;
      if (sum > capacity) {
        var f = capacity / sum;
        RES.forEach(function (r) { take[r] = Math.floor(take[r] * f); });
        sum = total(take);
      }
      if (sum <= 0) return;
      RES.forEach(function (r) { rest[r] -= take[r]; });
      plan.push({ id: s.id, name: s.name, coord: s.coord, dist: s.dist, res: take, merchants: Math.ceil(sum / cfg.merchantCap), sent: false });
    });
    return { plan: plan, rest: rest };
  }

  // Nächste Dörfer mit freien Händlern wählen, bis der Bedarf gedeckt ist
  function autoSelect(st) {
    var need = computeNeed(st).need, chosen = [];
    for (var i = 0; i < st.sources.length; i++) {
      if (total(distribute(need, st.sources.filter(function (s) { return chosen.indexOf(s.id) >= 0; })).rest) <= 0) break;
      var s = st.sources[i];
      if (s.merchants > 0 && RES.some(function (r) { return s.res[r] > cfg.reserve; })) chosen.push(s.id);
    }
    return chosen;
  }

  // =====================================================================
  // Fenster
  // =====================================================================
  function openRequest(items) {
    var st = { items: items.slice(), incoming: zero(), incomingAuto: false, sources: [], sel: [], plan: null, locked: false, busy: false };
    w.Dialog.show('rohAnf', '<div style="padding:10px">Lade Dörfer und eingehende Rohstoffe …</div>');
    $.when(loadSources(), loadIncoming()).done(function (sources, inc) {
      st.sources = sources || [];
      if (inc) { st.incoming = inc; st.incomingAuto = true; }
      st.sel = autoSelect(st);
      render(st);
    }).fail(function () {
      w.Dialog.show('rohAnf', '<div style="padding:10px;color:#b00000">Konnte die Produktionsübersicht nicht laden (Premium aktiv?).</div>');
    });
  }

  function render(st) {
    var inp = 'type="number" min="0" style="width:75px"';
    var html = '<div id="ra" style="max-width:860px;font-size:12px">' +
      '<h3 style="margin:4px 0">Rohstoffe anfordern → ' + esc(gd.village.display_name || gd.village.name) + '</h3>' +
      '<div id="ra_need"></div>' +
      '<table class="vis" style="width:100%;margin-top:6px"><tr><th>Freie Menge hinzufügen</th></tr><tr><td>' +
        icon('wood') + '<input id="ra_mw" ' + inp + '> ' + icon('stone') + '<input id="ra_ms" ' + inp + '> ' + icon('iron') + '<input id="ra_mi" ' + inp + '> ' +
        '<a href="#" class="btn" id="ra_addM">+ hinzufügen</a></td></tr></table>' +
      '<table class="vis" style="width:100%;margin-top:6px"><tr><th>Lieferdörfer</th></tr><tr><td>' +
        'Reserve je Rohstoff: <input id="ra_reserve" ' + inp + ' value="' + cfg.reserve + '"> &nbsp; ' +
        'Kapazität je Händler: <input id="ra_mcap" ' + inp + ' value="' + cfg.merchantCap + '"> &nbsp; ' +
        '<a href="#" class="btn" id="ra_auto">Automatisch wählen</a> <a href="#" class="btn" id="ra_none">Keine</a>' +
      '</td></tr></table>' +
      '<div style="max-height:220px;overflow:auto"><table class="vis" style="width:100%" id="ra_src"><tr><th></th><th>Dorf</th><th>Entf.</th><th>Holz</th><th>Lehm</th><th>Eisen</th><th>Händler</th></tr>' +
      st.sources.map(function (s) {
        return '<tr><td><input type="checkbox" class="ra_src" value="' + s.id + '"' + (st.sel.indexOf(s.id) >= 0 ? ' checked' : '') + '></td>' +
          '<td>' + esc(s.name) + ' (' + s.coord + ')</td><td>' + s.dist.toFixed(1) + '</td>' + resCells(s.res) +
          '<td>' + s.merchants + '/' + s.merchantsTotal + '</td></tr>';
      }).join('') +
      '</table></div>' +
      '<div id="ra_plan"></div></div>';
    w.Dialog.show('rohAnf', html);
    bind(st);
    update(st);
  }

  function update(st) {
    if (st.locked) { renderPlan(st); return; }
    var n = computeNeed(st);
    var inp = 'type="number" min="0" style="width:75px"';
    $('#ra_need').html(
      '<table class="vis" style="width:100%"><tr><th>Bedarf</th><th>Holz</th><th>Lehm</th><th>Eisen</th><th></th></tr>' +
      (st.items.map(function (it, i) {
        return '<tr><td>' + esc(it.label) + '</td>' + resCells(it.cost) + '<td><a href="#" class="ra_rm" data-i="' + i + '">✕</a></td></tr>';
      }).join('') || '<tr><td colspan="5"><i>Noch kein Bedarf – unten eine freie Menge hinzufügen.</i></td></tr>') +
      '<tr><td><label><input type="checkbox" id="ra_deduct"' + (cfg.deductStock ? ' checked' : '') + '> Vorhandene Rohstoffe abziehen</label></td>' +
        resCells({ wood: gd.village.wood, stone: gd.village.stone, iron: gd.village.iron }) + '<td></td></tr>' +
      '<tr><td>Eingehend abziehen' + (st.incomingAuto ? ' <small>(automatisch erkannt)</small>' : ' <small>(nicht erkannt – von Hand)</small>') + '</td>' +
        RES.map(function (r) { return '<td>' + icon(r) + '<input class="ra_inc" data-r="' + r + '" ' + inp + ' value="' + st.incoming[r] + '"></td>'; }).join('') + '<td></td></tr>' +
      '<tr><th>Anzufordern</th>' + resCells(n.need, true) + '<td></td></tr></table>' +
      (n.warn.length ? '<p style="color:#b00000;margin:4px 0">' + n.warn.map(esc).join('<br>') + '</p>' : '')
    );
    var srcs = st.sources.filter(function (s) { return st.sel.indexOf(s.id) >= 0; });
    st.plan = total(n.need) > 0 && srcs.length ? distribute(n.need, srcs) : null;
    renderPlan(st);
  }

  function renderPlan(st) {
    var $p = $('#ra_plan');
    if (!st.plan) {
      $p.html(st.items.length ? '<p style="margin:6px 0"><i>' + (st.sel.length ? 'Nichts anzufordern.' : 'Wähle mindestens ein Lieferdorf.') + '</i></p>' : '');
      return;
    }
    var d = st.plan, open = d.plan.filter(function (p) { return !p.sent; }).length, done = d.plan.length - open;
    $p.html(
      '<table class="vis" style="width:100%;margin-top:6px"><tr><th>Verteilung</th><th>Holz</th><th>Lehm</th><th>Eisen</th><th>Händler</th><th></th></tr>' +
      d.plan.map(function (p, i) {
        return '<tr' + (p.sent ? ' style="opacity:.6"' : '') + '><td>' + esc(p.name) + ' (' + p.coord + ', ' + p.dist.toFixed(1) + ' F.)</td>' +
          resCells(p.res) + '<td>' + p.merchants + '</td><td>' +
          (p.sent ? '<b style="color:#2e9e2e">✓ angefordert</b>' : '<a href="#" class="btn ra_send" data-i="' + i + '">Anfordern</a>') + '</td></tr>';
      }).join('') +
      (total(d.rest) > 0 ? '<tr><td style="color:#b00000">Fehlt noch</td>' + resCells(d.rest, true) + '<td colspan="2"></td></tr>' : '') +
      '</table>' +
      '<p style="margin:6px 0">' +
      (open ? '<a href="#" class="btn btn-confirm-yes" id="ra_next">Nächstes anfordern (' + (done + 1) + '/' + d.plan.length + ')</a> ' +
              '<small>Ein Klick = eine Anforderung aus einem Dorf.</small>'
            : '<b style="color:#2e9e2e">Alles angefordert.</b>') +
      (st.locked ? '<br><small>Plan ist gesperrt, weil schon angefordert wurde. Für einen neuen Plan das Fenster schließen und neu öffnen.</small>' : '') +
      '</p>'
    );
  }

  function send(st, i) {
    if (st.busy || !st.plan) return;
    var p = st.plan.plan[i];
    if (!p || p.sent) return;
    st.busy = true;
    st.locked = true;
    $('#ra input, #ra .ra_rm, #ra #ra_addM, #ra #ra_auto, #ra #ra_none').prop('disabled', true).css('pointer-events', 'none').css('opacity', .6);
    var resource = {};
    resource[p.id] = { wood: p.res.wood, stone: p.res.stone, iron: p.res.iron };
    dbg('Anforderung:', p.name, resource);
    w.TribalWars.post('market', { ajaxaction: 'call', village: gd.village.id },
      { 'select-village': p.id, target_id: 0, resource: resource },
      function () {
        p.sent = true;
        st.busy = false;
        msg('SuccessMessage', 'Angefordert aus ' + p.name + ': ' + fmt(p.res.wood) + ' / ' + fmt(p.res.stone) + ' / ' + fmt(p.res.iron));
        renderPlan(st);
      },
      function () { st.busy = false; renderPlan(st); }
    );
  }

  function bind(st) {
    var $d = $(document);
    $d.off('.ra');
    function lockedGuard(fn) { return function (ev) { if (ev && ev.preventDefault && this.tagName === 'A') ev.preventDefault(); if (st.locked) return; fn.call(this, ev); }; }
    $d.on('click.ra', '#ra_addM', lockedGuard(function () {
      var c = { wood: num($('#ra_mw').val()), stone: num($('#ra_ms').val()), iron: num($('#ra_mi').val()) };
      if (total(c) > 0) { st.items.push({ label: 'Freie Menge', cost: c }); st.sel = autoSelect(st); syncChecks(st); update(st); }
    }));
    $d.on('click.ra', '.ra_rm', lockedGuard(function () { st.items.splice(num($(this).data('i')), 1); update(st); }));
    $d.on('change.ra', '#ra_deduct', lockedGuard(function () { cfg.deductStock = this.checked; saveCfg(); update(st); }));
    $d.on('change.ra', '.ra_inc', lockedGuard(function () { st.incoming[$(this).data('r')] = num(this.value); update(st); }));
    $d.on('change.ra', '#ra_reserve, #ra_mcap', lockedGuard(function () {
      cfg.reserve = num($('#ra_reserve').val());
      cfg.merchantCap = Math.max(1, num($('#ra_mcap').val()) || 1000);
      saveCfg(); update(st);
    }));
    $d.on('change.ra', '.ra_src', lockedGuard(function () {
      st.sel = $('.ra_src:checked').map(function () { return this.value; }).get();
      update(st);
    }));
    $d.on('click.ra', '#ra_auto', lockedGuard(function () { st.sel = autoSelect(st); syncChecks(st); update(st); }));
    $d.on('click.ra', '#ra_none', lockedGuard(function () { st.sel = []; syncChecks(st); update(st); }));
    $d.on('click.ra', '.ra_send', function (ev) { ev.preventDefault(); send(st, num($(this).data('i'))); });
    $d.on('click.ra', '#ra_next', function (ev) {
      ev.preventDefault();
      if (!st.plan) return;
      for (var i = 0; i < st.plan.plan.length; i++) if (!st.plan.plan[i].sent) { send(st, i); return; }
    });
  }
  function syncChecks(st) { $('.ra_src').each(function () { this.checked = st.sel.indexOf(this.value) >= 0; }); }
})();
