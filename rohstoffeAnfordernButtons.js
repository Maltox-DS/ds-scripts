/*
 * Rohstoffe anfordern by Maltox – Buttons im Hauptgebäude und Adelshof (Version 1.1)
 * Wird vom Tampermonkey-Loader rohstoffeAnfordern.user.js geladen:
 *   https://cdn.jsdelivr.net/gh/Maltox-DS/ds-scripts@main/rohstoffeAnfordernButtons.js
 */

/*
 * Nicht von InnoGames freigegeben – Nutzung auf eigenes Risiko.
 * Das Skript fügt nur Buttons ein. Jede Anforderung wird per eigenem Klick verschickt
 * (eine Anforderung = ein Lieferdorf = ein Klick), nichts läuft automatisch.
 */
(function () {
  'use strict';

  var DEBUG = false; // auf true setzen für Diagnose-Ausgaben in der Konsole (F12)

  var w = window;
  if (!w.game_data || !w.jQuery || w.__rohAnfLoaded) return;
  w.__rohAnfLoaded = true;
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

  // ---------- Styles (einmalig) ----------
  function css() {
    if (document.getElementById('ra_css')) return;
    var st = document.createElement('style');
    st.id = 'ra_css';
    st.textContent = [
      '.ra-mini{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin-left:4px;vertical-align:middle;',
      ' border:1px solid #7d510f;border-radius:3px;background:linear-gradient(#f7e6bb,#e0c587);cursor:pointer;text-decoration:none!important}',
      '.ra-mini:hover{background:linear-gradient(#fff3d1,#ecd29a)}',
      '.ra-mini img{width:16px;height:16px}',
      '.ra-link{display:inline-flex;align-items:center;gap:5px;font-weight:bold;cursor:pointer}',
      '.ra-link img{width:16px;height:16px}',
      '#ra_snobbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:6px 0;padding:6px 10px;',
      ' background:#f4e4bc;border:1px solid #c1a264;border-radius:3px}',
      '#ra_snobbar b{color:#603000}',
      '#ra_snobbar .ra-g{display:inline-flex;align-items:center;gap:5px}',
      '#ra_snobbar input{width:42px;text-align:center}',
      '#ra{width:620px;max-width:92vw;font-size:12px;color:#2b1c05}',
      '#ra .ra-top{display:flex;justify-content:space-between;align-items:baseline;margin:0 0 6px}',
      '#ra .ra-top h3{margin:0;font-size:15px}',
      '#ra .ra-muted{color:#7a6540;font-size:11px}',
      '#ra .ra-card{background:#fff5da;border:1px solid #c1a264;border-radius:4px;margin:0 0 8px;overflow:hidden}',
      '#ra .ra-head{display:flex;justify-content:space-between;align-items:center;padding:4px 8px;',
      ' background:linear-gradient(#e8d29d,#cfb070);font-weight:bold;color:#3b2604}',
      '#ra .ra-head a{font-weight:normal;margin-left:10px;cursor:pointer}',
      '#ra .ra-sum{display:flex;gap:22px;padding:8px 10px 4px;font-size:16px;font-weight:bold}',
      '#ra .ra-sum span.icon{vertical-align:-3px;margin-right:4px}',
      '#ra .ra-chips{display:flex;flex-wrap:wrap;gap:5px;padding:2px 10px 8px}',
      '#ra .ra-chip{display:inline-flex;align-items:center;gap:6px;padding:1px 4px 1px 8px;border:1px solid #c1a264;border-radius:10px;background:#f4e4bc}',
      '#ra .ra-chip a{color:#8b1a00;font-weight:bold;cursor:pointer;padding:0 3px;text-decoration:none}',
      '#ra details{padding:0 10px 8px}',
      '#ra summary{cursor:pointer;color:#603000}',
      '#ra .ra-grid{display:grid;grid-template-columns:auto repeat(3,auto);gap:4px 10px;align-items:center;margin-top:6px}',
      '#ra input[type=number]{width:72px;padding:1px 3px}',
      '#ra .ra-list{max-height:260px;overflow:auto}',
      '#ra .ra-row{display:grid;grid-template-columns:20px 1fr 190px 46px 92px;gap:6px;align-items:center;padding:4px 8px;border-top:1px solid #ead9ab}',
      '#ra .ra-row:first-child{border-top:0}',
      '#ra .ra-row.on{background:#eef5dc}',
      '#ra .ra-row.sent{background:#e2f0d0;opacity:.75}',
      '#ra .ra-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#ra .ra-res{display:flex;gap:8px;white-space:nowrap}',
      '#ra .ra-res span.icon{transform:scale(.85);margin-right:1px}',
      '#ra .ra-res.stock{color:#8a7a58}',
      '#ra .ra-res.plan{font-weight:bold}',
      '#ra .ra-mer{text-align:right;color:#5b4520}',
      '#ra .ra-act{text-align:right}',
      '#ra .ra-ok{color:#2e7d1a;font-weight:bold}',
      '#ra .ra-warn{color:#a01800;padding:4px 10px 8px}',
      '#ra .ra-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:4px 0 0}',
      '#ra .ra-foot .btn{font-size:13px;padding:5px 14px}'
    ].join('\n');
    document.head.appendChild(st);
  }
  function marketImg() {
    var base = w.image_base || '/graphic/';
    return '<img src="' + base + 'buildings/market.png" alt="" onerror="this.replaceWith(document.createTextNode(\'⇄\'))">';
  }

  function injectHQ() {
    css();
    $('#buildings tr[id^="main_buildrow_"]').each(function () {
      var $r = $(this);
      if ($r.find('.ra-mini').length) return;
      var id = this.id.replace('main_buildrow_', '');
      if (!buildingCost(id, $r)) return;
      var $b = $('<a href="#" class="ra-mini" title="Rohstoffe für diese Stufe aus anderen Dörfern anfordern">' + marketImg() + '</a>');
      $b.on('click', function (ev) {
        ev.preventDefault();
        var c = buildingCost(id, $r);
        if (c) openRequest([c]);
      });
      $r.children('td').last().append($b);
    });
    if (!$('#ra_bar').length && $('#buildings').length) {
      var $bar = $('<div id="ra_bar" style="margin:4px 0 6px;text-align:right"><a class="ra-link" id="ra_free">' + marketImg() + 'Rohstoffe anfordern</a></div>');
      $('#buildings').before($bar);
      $bar.on('click', '#ra_free', function (ev) { ev.preventDefault(); openRequest([]); });
    }
  }

  function injectSnob() {
    css();
    if ($('#ra_snobbar').length) return;
    getCoin().always(function (c) {
      if ($('#ra_snobbar').length) return;
      c = c || { cost: COIN_FALLBACK, isCoin: true };
      var inp = 'type="number" min="1" value="1"';
      var html = '<div id="ra_snobbar"><b>' + marketImg() + ' Rohstoffe anfordern</b>' +
        (c.isCoin ? '<span class="ra-g"><input id="ra_coinN" ' + inp + '> Münzen <a href="#" class="btn" data-k="coin">Anfordern</a></span>' : '') +
        '<span class="ra-g"><input id="ra_snobN" ' + inp + '> AG <a href="#" class="btn" data-k="snob">Anfordern</a></span>' +
        '<span class="ra-g"><a href="#" class="btn" data-k="free">Freie Menge</a></span></div>';
      var $t = $('#content_value').length ? $('#content_value') : $('#contentContainer');
      $t.prepend(html);
      $('#ra_snobbar').on('click', 'a.btn', function (ev) {
        ev.preventDefault();
        var k = $(this).data('k'), n;
        if (k === 'coin') { n = Math.max(1, num($('#ra_coinN').val())); openRequest([{ label: n + (n > 1 ? ' Münzen' : ' Münze'), cost: mul(c.cost, n) }]); }
        else if (k === 'snob') { n = Math.max(1, num($('#ra_snobN').val())); openRequest([{ label: n + (n > 1 ? ' AGs' : ' AG'), cost: mul(SNOB_COST, n) }]); }
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
    css();
    var st = { items: items.slice(), incoming: zero(), incomingAuto: false, sources: [], sel: [], plan: null, locked: false, busy: false };
    w.Dialog.show('rohAnf', '<div id="ra"><p class="ra-muted" style="padding:14px">Lade Dörfer und eingehende Rohstoffe …</p></div>');
    $.when(loadSources(), loadIncoming()).done(function (sources, inc) {
      st.sources = sources || [];
      if (inc) { st.incoming = inc; st.incomingAuto = true; }
      st.sel = autoSelect(st);
      render(st);
    }).fail(function () {
      w.Dialog.show('rohAnf', '<div id="ra"><p class="ra-warn">Konnte die Produktionsübersicht nicht laden (Premium aktiv?).</p></div>');
    });
  }

  function resLine(o, cls) {
    return '<div class="ra-res ' + (cls || '') + '">' + RES.map(function (r) { return '<span>' + icon(r) + fmt(o[r]) + '</span>'; }).join('') + '</div>';
  }

  function render(st) {
    var inp = 'type="number" min="0"';
    var html = '<div id="ra">' +
      '<div class="ra-top"><h3>Rohstoffe anfordern</h3><span class="ra-muted">nach ' + esc(gd.village.display_name || gd.village.name) + '</span></div>' +

      '<div class="ra-card"><div class="ra-head">Anzufordern<a id="ra_addToggle">+ Menge</a></div>' +
        '<div class="ra-sum" id="ra_sum"></div>' +
        '<div class="ra-chips" id="ra_chips"></div>' +
        '<div id="ra_add" style="display:none;padding:0 10px 8px">' +
          icon('wood') + '<input id="ra_mw" ' + inp + '> ' + icon('stone') + '<input id="ra_ms" ' + inp + '> ' +
          icon('iron') + '<input id="ra_mi" ' + inp + '> <a href="#" class="btn" id="ra_addM">Hinzufügen</a></div>' +
        '<details id="ra_det"><summary>Berechnung</summary><div class="ra-grid" id="ra_calc"></div></details>' +
        '<div id="ra_warn"></div>' +
      '</div>' +

      '<div class="ra-card"><div class="ra-head">Lieferdörfer<span><a id="ra_auto">Automatisch</a><a id="ra_none">Keine</a></span></div>' +
        '<div class="ra-list" id="ra_list"></div>' +
        '<details><summary>Einstellungen</summary><div style="margin-top:6px">' +
          'Reserve je Rohstoff <input id="ra_reserve" ' + inp + ' value="' + cfg.reserve + '"> &nbsp; ' +
          'Kapazität je Händler <input id="ra_mcap" ' + inp + ' value="' + cfg.merchantCap + '"></div></details>' +
      '</div>' +

      '<div class="ra-foot" id="ra_foot"></div>' +
    '</div>';
    w.Dialog.show('rohAnf', html);
    bind(st);
    update(st);
  }

  function update(st) {
    var n = computeNeed(st);
    if (!st.locked) {
      var srcs = st.sources.filter(function (s) { return st.sel.indexOf(s.id) >= 0; });
      st.plan = total(n.need) > 0 && srcs.length ? distribute(n.need, srcs) : null;
    }
    $('#ra_sum').html(RES.map(function (r) { return '<span>' + icon(r) + fmt(n.need[r]) + '</span>'; }).join(''));
    $('#ra_chips').html(st.items.length
      ? st.items.map(function (it, i) { return '<span class="ra-chip">' + esc(it.label) + (st.locked ? '' : '<a class="ra_rm" data-i="' + i + '" title="Entfernen">×</a>') + '</span>'; }).join('')
      : '<span class="ra-muted">Noch nichts ausgewählt – über „+ Menge“ eine Menge eintragen.</span>');
    var inp = 'type="number" min="0"' + (st.locked ? ' disabled' : '');
    $('#ra_calc').html(
      '<span>Bedarf</span>' + RES.map(function (r) { return '<span>' + icon(r) + fmt(n.sum[r]) + '</span>'; }).join('') +
      '<label><input type="checkbox" id="ra_deduct"' + (cfg.deductStock ? ' checked' : '') + (st.locked ? ' disabled' : '') + '> − im Dorf</label>' +
        RES.map(function (r) { return '<span>' + icon(r) + fmt(gd.village[r]) + '</span>'; }).join('') +
      '<span>− eingehend' + (st.incomingAuto ? '' : ' <span class="ra-muted">(von Hand)</span>') + '</span>' +
        RES.map(function (r) { return '<span><input class="ra_inc" data-r="' + r + '" ' + inp + ' value="' + st.incoming[r] + '"></span>'; }).join('')
    );
    var warn = n.warn.slice();
    if (st.plan && total(st.plan.rest) > 0) {
      warn.push('Nicht gedeckt: ' + RES.filter(function (r) { return st.plan.rest[r] > 0; }).map(function (r) { return fmt(st.plan.rest[r]) + ' ' + RES_DE[r]; }).join(', ') + ' – weitere Dörfer anhaken oder Reserve senken.');
    }
    $('#ra_warn').html(warn.length ? '<div class="ra-warn">' + warn.map(esc).join('<br>') + '</div>' : '');
    renderList(st);
  }

  function planFor(st, id) {
    if (!st.plan) return null;
    for (var i = 0; i < st.plan.plan.length; i++) if (st.plan.plan[i].id === id) return { p: st.plan.plan[i], i: i };
    return null;
  }

  function renderList(st) {
    $('#ra_list').html(st.sources.length ? st.sources.map(function (s) {
      var on = st.sel.indexOf(s.id) >= 0, pl = planFor(st, s.id);
      var cls = 'ra-row' + (on ? ' on' : '') + (pl && pl.p.sent ? ' sent' : '');
      var act = '';
      if (pl) act = pl.p.sent ? '<span class="ra-ok">✓ angefordert</span>' : '<a href="#" class="btn ra_send" data-i="' + pl.i + '">Anfordern</a>';
      else if (on) act = '<span class="ra-muted">nicht nötig</span>';
      return '<div class="' + cls + '">' +
        '<input type="checkbox" class="ra_src" value="' + s.id + '"' + (on ? ' checked' : '') + (st.locked ? ' disabled' : '') + '>' +
        '<div class="ra-name" title="' + esc(s.name) + '">' + esc(s.name) + ' <span class="ra-muted">' + s.dist.toFixed(1) + ' F.</span></div>' +
        (pl ? resLine(pl.p.res, 'plan') : resLine(s.res, 'stock')) +
        '<div class="ra-mer" title="' + (pl ? 'benötigte Händler (von ' + s.merchants + ' freien)' : 'freie Händler') + '">' + (pl ? pl.p.merchants + ' H.' : s.merchants + ' frei') + '</div>' +
        '<div class="ra-act">' + act + '</div></div>';
    }).join('') : '<p class="ra-muted" style="padding:8px">Keine weiteren Dörfer gefunden.</p>');
    renderFoot(st);
  }

  function renderFoot(st) {
    var $f = $('#ra_foot');
    if (!st.plan || !st.plan.plan.length) { $f.html('<span class="ra-muted">' + (st.items.length ? 'Lieferdörfer auswählen.' : '') + '</span>'); return; }
    var all = st.plan.plan.length, done = st.plan.plan.filter(function (p) { return p.sent; }).length;
    $f.html('<span class="ra-muted">' + (st.locked ? 'Plan gesperrt – für einen neuen Plan Fenster neu öffnen. ' : 'Ein Klick = eine Anforderung. ') + done + ' von ' + all + ' angefordert</span>' +
      (done < all ? '<a href="#" class="btn btn-confirm-yes" id="ra_next">Nächstes anfordern</a>' : '<span class="ra-ok">Alles angefordert ✓</span>'));
  }

  function send(st, i) {
    if (st.busy || !st.plan) return;
    var p = st.plan.plan[i];
    if (!p || p.sent) return;
    st.busy = true;
    st.locked = true;
    var resource = {};
    resource[p.id] = { wood: p.res.wood, stone: p.res.stone, iron: p.res.iron };
    dbg('Anforderung:', p.name, resource);
    w.TribalWars.post('market', { ajaxaction: 'call', village: gd.village.id },
      { 'select-village': p.id, target_id: 0, resource: resource },
      function () {
        p.sent = true;
        st.busy = false;
        msg('SuccessMessage', 'Angefordert aus ' + p.name + ': ' + fmt(p.res.wood) + ' / ' + fmt(p.res.stone) + ' / ' + fmt(p.res.iron));
        update(st);
      },
      function () { st.busy = false; update(st); }
    );
  }

  function bind(st) {
    var $d = $(document);
    $d.off('.ra');
    function guard(fn) { return function (ev) { if (ev && this.tagName === 'A') ev.preventDefault(); if (st.locked) return; fn.call(this, ev); }; }
    $d.on('click.ra', '#ra_addToggle', guard(function () { $('#ra_add').toggle(); $('#ra_mw').trigger('focus'); }));
    $d.on('click.ra', '#ra_addM', guard(function () {
      var c = { wood: num($('#ra_mw').val()), stone: num($('#ra_ms').val()), iron: num($('#ra_mi').val()) };
      if (total(c) > 0) {
        st.items.push({ label: fmt(c.wood) + ' / ' + fmt(c.stone) + ' / ' + fmt(c.iron), cost: c });
        $('#ra_add').hide().find('input').val('');
        st.sel = autoSelect(st); update(st);
      }
    }));
    $d.on('click.ra', '.ra_rm', guard(function () { st.items.splice(num($(this).data('i')), 1); st.sel = autoSelect(st); update(st); }));
    $d.on('change.ra', '#ra_deduct', guard(function () { cfg.deductStock = this.checked; saveCfg(); st.sel = autoSelect(st); update(st); }));
    $d.on('change.ra', '.ra_inc', guard(function () { st.incoming[$(this).data('r')] = num(this.value); st.sel = autoSelect(st); update(st); }));
    $d.on('change.ra', '#ra_reserve, #ra_mcap', guard(function () {
      cfg.reserve = num($('#ra_reserve').val());
      cfg.merchantCap = Math.max(1, num($('#ra_mcap').val()) || 1000);
      saveCfg(); update(st);
    }));
    $d.on('change.ra', '.ra_src', guard(function () {
      var id = this.value;
      if (this.checked) { if (st.sel.indexOf(id) < 0) st.sel.push(id); }
      else st.sel = st.sel.filter(function (x) { return x !== id; });
      st.sel.sort(function (a, b) { return srcIndex(st, a) - srcIndex(st, b); });
      update(st);
    }));
    $d.on('click.ra', '#ra_auto', guard(function () { st.sel = autoSelect(st); update(st); }));
    $d.on('click.ra', '#ra_none', guard(function () { st.sel = []; update(st); }));
    $d.on('click.ra', '.ra_send', function (ev) { ev.preventDefault(); send(st, num($(this).data('i'))); });
    $d.on('click.ra', '#ra_next', function (ev) {
      ev.preventDefault();
      if (!st.plan) return;
      for (var i = 0; i < st.plan.plan.length; i++) if (!st.plan.plan[i].sent) { send(st, i); return; }
    });
  }
  function srcIndex(st, id) { for (var i = 0; i < st.sources.length; i++) if (st.sources[i].id === id) return i; return 1e9; }
})();
