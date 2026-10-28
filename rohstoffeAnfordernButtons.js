/*
 * Rohstoffe anfordern by Maltox – Buttons im Hauptgebäude und Adelshof (Version 1.9)
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
  function dez(x) { return (Math.round(x * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 }); }
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
    var cached = load(KEY + '_coin2', null);
    if (cached && cached.t && Date.now() - cached.t < 7 * 864e5) { coinPromise = $.Deferred().resolve(cached).promise(); return coinPromise; }
    coinPromise = $.get('/interface.php?func=get_config').then(function (xml) {
      var $x = $(xml), c = { cost: $.extend({}, COIN_FALLBACK), isCoin: true, t: Date.now() };
      RES.forEach(function (r) { var v = num($x.find('snob coin_' + r).text()); if (v > 0) c.cost[r] = v; });
      var gold = $x.find('snob gold').text();
      if (gold !== '') c.isCoin = gold === '1';
      c.speed = parseFloat($x.find('config > speed').first().text()) || 1;
      save(KEY + '_coin2', c);
      return c;
    }, function () { return $.Deferred().resolve({ cost: $.extend({}, COIN_FALLBACK), isCoin: true, speed: 1 }).promise(); });
    return coinPromise;
  }

  // ---------- Gebäudeinfos (Basiskosten + Faktoren) für mehrere Stufen ----------
  var binfoPromise = null;
  function getBuildingInfo() {
    if (binfoPromise) return binfoPromise;
    var cached = load(KEY + '_binfo', null);
    if (cached && cached.t && Date.now() - cached.t < 7 * 864e5) { binfoPromise = $.Deferred().resolve(cached.b).promise(); return binfoPromise; }
    binfoPromise = $.get('/interface.php?func=get_building_info').then(function (xml) {
      var b = {};
      $(xml).find('config').children().each(function () {
        var $e = $(this), o = { max: num($e.children('max_level').text()) };
        RES.forEach(function (r) {
          o[r] = parseFloat($e.children(r).text()) || 0;
          o[r + 'F'] = parseFloat($e.children(r + '_factor').text()) || 1;
        });
        b[this.nodeName] = o;
      });
      save(KEY + '_binfo', { t: Date.now(), b: b });
      return b;
    }, function () { return $.Deferred().resolve(null).promise(); });
    return binfoPromise;
  }
  function levelCost(bi, L) {
    var c = {};
    RES.forEach(function (r) { c[r] = Math.round(bi[r] * Math.pow(bi[r + 'F'], L - 1)); });
    return c;
  }
  // Kosten eines Gebäude-Postens von Stufe "from" bis "to" (erste Stufe = Kosten aus dem Spiel)
  function itemCost(it, binfo) {
    var c = $.extend({}, it.baseCost), bi = binfo && binfo[it.bid];
    if (bi) for (var L = it.from + 1; L <= it.to; L++) {
      var lc = levelCost(bi, L);
      RES.forEach(function (r) { c[r] += lc[r]; });
    }
    return c;
  }

  // =====================================================================
  // Buttons einfügen
  // =====================================================================
  function buildingCost(id, $row) {
    var bm = w.BuildingMain && w.BuildingMain.buildings;
    var b = bm && bm[id];
    var name = '', level = 0, c = null;
    if (b && b.wood != null && b.stone != null && b.iron != null) {
      c = { wood: num(b.wood), stone: num(b.stone), iron: num(b.iron) };
      name = b.name || '';
      level = num(b.level_next);
    }
    if (!c) {
      var $all = $row.find('[data-cost]');
      if ($all.length < 3) return null;
      c = {};
      RES.forEach(function (r, i) {
        var $c = $row.find('.cost_' + r + '[data-cost]');
        if (!$c.length) $c = $all.eq(i);
        var a = $c.attr('data-cost');
        c[r] = a != null && a !== '' ? num(a) : num($c.text());
      });
    }
    if (!total(c)) return null;
    if (!name) name = $.trim($row.find('td').first().find('a').filter(function () { return $.trim($(this).text()) !== ''; }).first().text()) || id;
    if (!level) {
      var mb = $row.children('td').last().prev().text().match(/Stufe\s*(\d+)/) || $row.find('a.btn, .btn-build').text().match(/Stufe\s*(\d+)/);
      if (mb) level = num(mb[1]);
      else { var ml = $row.children('td').first().text().match(/Stufe\s*(\d+)/); if (ml) level = num(ml[1]) + 1; }
    }
    return { label: name + (level ? ' Stufe ' + level : ''), name: name, bid: id, from: level, to: level, baseCost: c, cost: $.extend({}, c) };
  }

  // ---------- Styles (einmalig) ----------
  function css() {
    if (document.getElementById('ra_css')) return;
    var st = document.createElement('style');
    st.id = 'ra_css';
    st.textContent = [
      '#buildings .ra-col{text-align:center;white-space:nowrap;width:1%;padding:0 6px}',
      '#buildings .ra-req{padding:3px 9px}',
      '#buildings .ra-na{color:#9c8a62;font-size:11px;cursor:default}',
      '#buildings .ra-plus{display:inline-block;width:15px;height:15px;line-height:14px;margin-left:3px;border-radius:50%;',
      ' background:#7d510f;color:#fff!important;font-weight:bold;font-size:13px;text-align:center;text-decoration:none!important;vertical-align:1px}',
      '#buildings .ra-plus:hover{background:#a06a1a}',
      '.ra-link{display:inline-flex;align-items:center;gap:5px;font-weight:bold;cursor:pointer}',
      '.ra-link img{width:16px;height:16px}',
      '#ra_snobbar{margin:8px 0 12px;border:1px solid #7d510f;border-radius:4px;background:#f4e4bc;overflow:hidden;max-width:640px}',
      '#ra_snobbar .ra-sb-head{display:flex;justify-content:space-between;align-items:center;padding:5px 10px;background:linear-gradient(#e8d29d,#cfb070);font-weight:bold;color:#3b2604}',
      '#ra_snobbar .ra-sb-head img{width:16px;height:16px;vertical-align:-3px;margin-right:4px}',
      '#ra_snobbar .ra-free{font-weight:normal;font-size:11px}',
      '#ra_snobbar .ra-sb-body{display:flex;gap:10px;padding:10px;flex-wrap:wrap}',
      '#ra_snobbar .ra-sc{flex:1 1 260px;background:#fff5da;border:1px solid #c1a264;border-radius:4px;padding:8px 10px;display:flex;flex-direction:column;gap:8px}',
      '#ra_snobbar .ra-sc-t{display:flex;align-items:center;gap:6px;font-size:13px}',
      '#ra_snobbar .ra-sc-t img{width:18px;height:18px}',
      '#ra_snobbar .ra-badge{margin-left:auto;font-size:10px;padding:1px 6px;border-radius:8px;background:#ead19b;color:#5b3d07}',
      '#ra_snobbar .ra-badge.ok{background:#d9ecc4;color:#2e5d12}',
      '#ra_snobbar .ra-sc-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '#ra_snobbar .ra-step{display:inline-flex;border:1px solid #c1a264;border-radius:3px;overflow:hidden;background:#fff}',
      '#ra_snobbar .ra-step a{width:22px;text-align:center;line-height:22px;background:#e8d29d;color:#3b2604;font-weight:bold;text-decoration:none}',
      '#ra_snobbar .ra-step a:hover{background:#dcc07f}',
      '#ra_snobbar .ra-step input{width:44px;border:0;text-align:center;font-weight:bold;-moz-appearance:textfield}',
      '#ra_snobbar .ra-step input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}',
      '#ra_snobbar .ra-sc-cost{display:flex;gap:8px;color:#5b4520;font-size:11px;white-space:nowrap}',
      '#ra_snobbar .ra-sc-foot{text-align:right}',
      '#ra_snobbar .ra-sb-note{padding:0 10px 8px;color:#7a6540;font-size:10px}',
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
      '#ra .ra-chip input[type=number]{width:42px;padding:0 2px;text-align:center}',
      '#ra .ra-info{margin:0 10px 8px;padding:5px 8px;background:#f4e4bc;border-left:3px solid #7d510f;font-size:11px}',
      '#ra details{padding:0 10px 8px}',
      '#ra summary{cursor:pointer;color:#603000}',
      '#ra .ra-grid{display:grid;grid-template-columns:auto repeat(3,auto);gap:4px 10px;align-items:center;margin-top:6px}',
      '#ra input[type=number]{width:72px;padding:1px 3px}',
      '#ra .ra-list{max-height:260px;overflow:auto}',
      '#ra .ra-row{display:grid;grid-template-columns:20px 1fr 190px 50px 92px;gap:6px;align-items:center;padding:4px 8px;border-top:1px solid #ead9ab}',
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
      '#ra .ra-why{font-size:10px;line-height:1.2;display:inline-block;max-width:92px}',
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

  // Status eines Gebäudes: was fehlt im Dorf, passt es in den Speicher?
  function buildState(cost) {
    var cap = num(gd.village.storage_max), miss = zero(), tooBig = false;
    RES.forEach(function (r) {
      miss[r] = Math.max(0, cost[r] - num(gd.village[r]));
      if (cost[r] > cap) tooBig = true;
    });
    return { miss: miss, tooBig: tooBig, enough: total(miss) === 0 };
  }

  function injectHQ() {
    css();
    var $tbl = $('#buildings');
    if (!$tbl.length) return;
    $tbl.find('tr').each(function () {
      var $r = $(this);
      if ($r.children('.ra-col').length) return;
      var $cells = $r.children('th, td');
      if (!$cells.length) return;
      // Kopfzeile
      if ($r.children('th').length && !$r.children('td').length) {
        $r.append('<th class="ra-col">Anfordern <a href="#" class="ra-plus" title="Freie Menge anfordern">+</a></th>');
        return;
      }
      // Volle Breite (colspan über alles) → nur verbreitern
      if ($cells.length === 1 && num($cells.attr('colspan')) > 1) {
        $cells.attr('colspan', num($cells.attr('colspan')) + 1);
        return;
      }
      var $td = $('<td class="ra-col"></td>');
      $r.append($td);
      if (!/^main_buildrow_/.test(this.id || '')) return;
      var id = this.id.replace('main_buildrow_', '');
      var c = buildingCost(id, $r);
      if (!c) return;
      var bs = buildState(c.cost);
      if (bs.tooBig) {
        $td.html('<span class="ra-na" title="Der Speicher ist zu klein für diese Stufe">zu klein</span>');
        return;
      }
      if (bs.enough) {
        $td.html('<span class="ra-na" title="Genug Rohstoffe im Dorf">✓</span>');
        return;
      }
      var tip = 'Fehlt: ' + RES.filter(function (r) { return bs.miss[r] > 0; }).map(function (r) { return fmt(bs.miss[r]) + ' ' + RES_DE[r]; }).join(', ');
      var $b = $('<a href="#" class="btn ra-req" title="' + esc(tip) + '">Anfordern</a>');
      $b.on('click', function (ev) {
        ev.preventDefault();
        var cc = buildingCost(id, $r);
        if (cc) openRequest([cc]);
      });
      $td.append($b);
    });
    $(document).off('click.raplus').on('click.raplus', '#buildings .ra-plus', function (ev) { ev.preventDefault(); openRequest([]); });
  }

  // Fehlende Münzen für das nächste AG aus dem Adelshof lesen (bestmöglich, Text des Spiels)
  function detectCoins() {
    var $c = $('#content_value').length ? $('#content_value') : $('body');
    var lines = [];
    $c.find('tr, li, td, th, p, div, span, b').each(function () {
      if ($(this).closest('#ra_snobbar').length) return;
      var t = $.trim($(this).clone().children('script').remove().end().text()).replace(/\s+/g, ' ');
      if (t.length < 160 && /münz/i.test(t)) lines.push(t);
    });
    // nur eindeutige, kurze Zeilen mit genau einer Münz-Angabe – kürzeste zuerst
    lines = lines.filter(function (v, i, a) { return a.indexOf(v) === i && (v.match(/münz/gi) || []).length === 1; })
      .sort(function (a, b) { return a.length - b.length; });
    dbg('Adelshof – Zeilen mit „Münz“:', lines);
    var need = null, req = null, have = null, i, m, txt = lines.join(' | ');
    // 1) direkter Satz: "… noch X (Gold)Münzen …" / "X weitere Münzen …"
    m = txt.match(/(?:noch|weitere|fehl\w*|benötig\w*\s+noch)\D{0,25}?(\d[\d.]*)\s*(?:weitere\s*)?(?:gold)?münz/i) ||
        txt.match(/(\d[\d.]*)\s*(?:weitere\s*)?(?:gold)?münz\w*\s*(?:fehl|werden noch)/i);
    if (m) need = num(m[1]);
    // 2) Tabelle: "benötigt/nötig … Münzen" und "vorhanden/gespeichert/gelagert … Münzen"
    if (need == null) {
      for (i = 0; i < lines.length; i++) {
        var n = lines[i].match(/(\d[\d.]*)/g);
        if (!n || n.length > 2) continue;
        var v = num(n[n.length - 1]);
        if (/benötig|nötig|erforderlich|nächste/i.test(lines[i]) && req == null) req = v;
        else if (/vorhanden|gespeichert|gelagert|besitz|geprägt/i.test(lines[i]) && have == null) have = v;
      }
      if (req != null) need = Math.max(0, req - (have || 0));
    }
    dbg('Adelshof – erkannt:', { need: need, req: req, have: have });
    return need;
  }

  function injectSnob() {
    css();
    if ($('#ra_snobbar').length) return;
    getCoin().always(function (c) {
      if ($('#ra_snobbar').length) return;
      c = c || { cost: COIN_FALLBACK, isCoin: true };
      var need = c.isCoin ? detectCoins() : null;
      var base = w.image_base || '/graphic/';
      function card(k, title, img, val, hint) {
        return '<div class="ra-sc" data-k="' + k + '">' +
          '<div class="ra-sc-t">' + img + '<b>' + title + '</b>' + (hint || '') + '</div>' +
          '<div class="ra-sc-row"><span class="ra-step"><a href="#" class="ra-dec">−</a><input type="number" min="1" value="' + val + '"><a href="#" class="ra-inc">+</a></span>' +
          '<span class="ra-sc-cost"></span></div>' +
          '<div class="ra-sc-foot"><a href="#" class="btn ra-go">Rohstoffe anfordern</a></div></div>';
      }
      var coinHint = need == null ? '' : need > 0
        ? '<span class="ra-badge">' + need + ' fehlen fürs nächste AG</span>'
        : '<span class="ra-badge ok">genug fürs nächste AG</span>';
      var html = '<div id="ra_snobbar">' +
        '<div class="ra-sb-head"><span>' + marketImg() + ' Rohstoffe anfordern</span><a href="#" class="ra-free">+ freie Menge</a></div>' +
        '<div class="ra-sb-body">' +
          (c.isCoin ? card('coin', 'Münzen', '', need != null && need > 0 ? need : 1, coinHint) : '') +
          card('snob', 'Adelsgeschlechter', '<img src="' + base + 'unit/unit_snob.png" alt="" onerror="this.remove()">', 1, '') +
        '</div>' +
        '<div class="ra-sb-note">Bei mehr als in den Speicher passt, wird gleichmäßig geliefert – passend zur automatischen Prägung.</div>' +
      '</div>';
      var $t = $('#content_value').length ? $('#content_value') : $('#contentContainer');
      $t.prepend(html);
      var unitOf = { coin: c.cost, snob: SNOB_COST };
      function refresh($card) {
        var k = $card.data('k'), n = Math.max(1, num($card.find('input').val())), tot = mul(unitOf[k], n);
        $card.find('.ra-sc-cost').html(RES.map(function (r) { return '<span>' + icon(r) + fmt(tot[r]) + '</span>'; }).join(''));
      }
      var $bar = $('#ra_snobbar');
      $bar.find('.ra-sc').each(function () { refresh($(this)); });
      $bar.on('input change', 'input', function () { refresh($(this).closest('.ra-sc')); });
      $bar.on('click', '.ra-dec, .ra-inc', function (ev) {
        ev.preventDefault();
        var $i = $(this).siblings('input'), v = Math.max(1, num($i.val()) + ($(this).hasClass('ra-inc') ? 1 : -1));
        $i.val(v); refresh($(this).closest('.ra-sc'));
      });
      $bar.on('click', '.ra-go', function (ev) {
        ev.preventDefault();
        var $card = $(this).closest('.ra-sc'), k = $card.data('k'), n = Math.max(1, num($card.find('input').val()));
        openRequest([setItem(k, unitOf[k], n)]);
      });
      $bar.on('click', '.ra-free', function (ev) { ev.preventDefault(); openRequest([]); });
    });
  }
  function mul(c, n) { return { wood: c.wood * n, stone: c.stone * n, iron: c.iron * n }; }
  var KIND = { coin: ['Münze', 'Münzen'], snob: ['AG', 'AGs'] };
  function setItem(kind, unit, n) {
    return { kind: kind, unit: $.extend({}, unit), n: n, label: n + ' ' + KIND[kind][n > 1 ? 1 : 0], cost: mul(unit, n) };
  }

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

  // Seite Marktplatz → Anfordern: "Eingehende Rohstoffe" und Laufzeit je Dorf
  function loadCallPage() {
    return $.get(gd.link_base_pure + 'market&mode=call').then(function (html) {
      var $d = dom(html), out = { inc: null, travel: {} };
      var $head = $d.find('th, td, h3, h4').filter(function () { return /Eingehende Rohstoffe/i.test($.trim($(this).text())) && $(this).children().length === 0; }).first();
      if ($head.length) {
        var $t = $head.closest('table'), inc = {}, found = 0;
        RES.forEach(function (r, i) {
          var $c = $t.find('td').filter(function () { return $(this).find('.' + r).length > 0; }).first();
          if (!$c.length) $c = $t.find('td').eq(i);
          if ($c.length) found++;
          inc[r] = num($c.text());
        });
        if (found) out.inc = inc;
      }
      $d.find('tr').each(function () {
        var $c = $(this).children('td');
        if ($c.length < 2) return;
        var mc = $c.eq(0).text().match(/(\d{1,3})\|(\d{1,3})/), mt = $c.eq(1).text().match(/(\d+):(\d{2}):(\d{2})/);
        if (mc && mt) out.travel[num(mc[1]) + '|' + num(mc[2])] = num(mt[1]) * 3600 + num(mt[2]) * 60 + num(mt[3]);
      });
      dbg('Anfordern-Seite:', out);
      return out;
    }, function () { return $.Deferred().resolve({ inc: null, travel: {} }).promise(); });
  }

  function serverNow() {
    try { if (w.Timing && w.Timing.getCurrentServerTime) return w.Timing.getCurrentServerTime(); } catch (e) { /* egal */ }
    return Date.now();
  }
  function dur(sec) { var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); if (m === 60) { h++; m = 0; } return h + ':' + (m < 10 ? '0' : '') + m + ' h'; }
  function arrival(sec) {
    var now = new Date(serverNow()), t = new Date(now.getTime() + sec * 1000);
    var hm = t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return (t.getDate() !== now.getDate() ? 'morgen ' : '') + hm;
  }

  // =====================================================================
  // Berechnung
  // =====================================================================
  // Paket-Modus: nur Münzen bzw. nur AGs → gleichmäßige Lieferung in ganzen Paketen
  function setInfo(st) {
    if (!st.items.length) return null;
    var k = st.items[0].kind, n = 0;
    if (!k) return null;
    for (var i = 0; i < st.items.length; i++) { if (st.items[i].kind !== k) return null; n += st.items[i].n; }
    return { kind: k, unit: st.items[0].unit, n: n };
  }

  function computeNeed(st) {
    var sum = zero();
    st.items.forEach(function (it) { RES.forEach(function (r) { sum[r] += it.cost[r]; }); });
    var cap = num(gd.village.storage_max), need = {}, warn = [];
    var si = setInfo(st);
    if (si) {
      // Gesamtmenge darf größer als der Speicher sein – die automatische Prägung arbeitet zwischen den Ankünften weg.
      // Vorhandenes und Eingehendes wird immer mitgezählt, weil die Prägung es ohnehin verbraucht.
      var u = si.unit, have = {}, stock = {}, inc = {}, sets = 0;
      RES.forEach(function (r) {
        stock[r] = num(gd.village[r]);
        inc[r] = st.incoming[r] || 0;
        have[r] = stock[r] + inc[r];
        need[r] = Math.max(0, sum[r] + cfg.reserve - have[r]);
        if (u[r]) sets = Math.max(sets, need[r] / u[r]);
        if (need[r] > 0 && have[r] >= cap) warn.push(RES_DE[r] + ': Speicher ist schon voll – erst prägen bzw. rekrutieren.');
      });
      if (RES.every(function (r) { return !u[r] || cfg.reserve >= u[r]; }))
        warn.push('Die Reserve (' + fmt(cfg.reserve) + ') ist so groß wie ein ganzes Stück – die automatische Prägung würde sie mit verbrauchen. Reserve kleiner einstellen.');
      return { mode: 'sets', kind: si.kind, unit: u, n: si.n, have: have, stock: stock, inc: inc, cap: cap, sets: Math.ceil(sets * 100) / 100, sum: sum, need: need, warn: warn };
    }
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
    return { mode: 'normal', sum: sum, need: need, warn: warn };
  }

  function distribute(need, sources) {
    var rest = { wood: need.wood, stone: need.stone, iron: need.iron }, plan = [], why = {};
    sources.forEach(function (s) {
      if (total(rest) <= 0) { why[s.id] = 'nicht nötig'; return; }
      if (s.merchants <= 0) { why[s.id] = 'keine Händler frei'; return; }
      var take = {};
      RES.forEach(function (r) { take[r] = Math.min(rest[r], Math.max(0, s.res[r] - cfg.reserve)); });
      var sum = total(take), capacity = s.merchants * cfg.merchantCap;
      if (sum > capacity) {
        var f = capacity / sum;
        RES.forEach(function (r) { take[r] = Math.floor(take[r] * f); });
        sum = total(take);
      }
      if (sum <= 0) { why[s.id] = lowWhy(s, RES.filter(function (r) { return rest[r] > 0; })); return; }
      RES.forEach(function (r) { rest[r] -= take[r]; });
      plan.push({ id: s.id, name: s.name, coord: s.coord, dist: s.dist, travel: s.travel, res: take, merchants: Math.ceil(sum / cfg.merchantCap), sent: false });
    });
    return { plan: plan, rest: rest, why: why };
  }

  function lowWhy(s, rs) {
    var low = rs.filter(function (r) { return s.res[r] <= cfg.reserve; });
    return low.length ? 'zu wenig ' + low.map(function (r) { return RES_DE[r]; }).join('/') + ' (Reserve)' : 'nicht nötig';
  }

  // Münzen/AGs – zwei Regeln:
  // 1. Ganze Münzen: es wird nur so viel angefordert, wie zusammen mit Lager und Unterwegs genau k ganze Münzen
  //    ergibt. Reicht ein Rohstoff nicht (meist Eisen), werden die anderen nicht "auf Vorrat" geschickt.
  // 2. Laufende Lieferungen ("unterwegs") sind in der Ankunftszeit unbekannt. Sie zählen deshalb für den Platz
  //    im Speicher so, als wären sie schon da, für die Prägung aber erst am Ende. So läuft der Speicher bei jeder
  //    Ankunftsreihenfolge nicht über, auch wenn man nachfordert, während noch etwas unterwegs ist.
  // Lieferungen, die fast gleichzeitig ankommen (< 90 s), zählen als eine Ankunft.
  var SAME_ARRIVAL = 90;
  // Für k ganze Münzen/AGs verteilen: knappster Rohstoff zuerst (er bekommt die Händler zuerst),
  // innerhalb eines Rohstoffs die schnellsten Dörfer zuerst. Danach Zeitleiste prüfen.
  function allocSets(n, sources, k) {
    var u = n.unit, D = {}, A = zero(), capLeft = {}, take = {}, why = {};
    RES.forEach(function (r) { D[r] = Math.max(0, k * u[r] + cfg.reserve - n.stock[r] - n.inc[r]); });
    sources.forEach(function (s) {
      capLeft[s.id] = s.merchants * cfg.merchantCap; take[s.id] = zero();
      RES.forEach(function (r) { A[r] += Math.min(Math.max(0, s.res[r] - cfg.reserve), capLeft[s.id]); });
    });
    var order = RES.filter(function (r) { return D[r] > 0; });
    var res = maxFlowAlloc(sources, D, capLeft);
    sources.forEach(function (s, j) { RES.forEach(function (r) { take[s.id][r] = res.f[j][r]; }); });
    var neck = null, hi = 0;
    RES.forEach(function (r) { var q = res.miss[r] / (u[r] || 1); if (res.miss[r] > 0 && q > hi) { hi = q; neck = r; } });
    var plan = [], got = zero();
    sources.forEach(function (s) {
      var t = take[s.id], sum = total(t);
      if (sum <= 0) {
        if (!order.length) why[s.id] = 'nicht nötig';
        else if (s.merchants <= 0) why[s.id] = 'keine Händler frei';
        else if (order.every(function (r) { return s.res[r] <= cfg.reserve; })) why[s.id] = lowWhy(s, order);
        else why[s.id] = 'nicht nötig';
        return;
      }
      RES.forEach(function (r) { got[r] += t[r]; });
      plan.push({ id: s.id, name: s.name, coord: s.coord, dist: s.dist, travel: s.travel, res: t,
        equiv: sum / total(u), merchants: Math.ceil(sum / cfg.merchantCap), sent: false });
    });
    if (neck) return { ok: false, neck: neck, plan: plan, got: got, why: why };
    // Zeitleiste: Unterwegs zählt für den Platz sofort, für die Prägung erst am Ende
    var S = $.extend({}, n.stock), I = n.inc, cap = n.cap, minted = 0, i = 0, room = false;
    function mint() {
      var m = k - minted;
      RES.forEach(function (r) { if (u[r]) m = Math.min(m, Math.floor(Math.max(0, S[r] - cfg.reserve) / u[r])); });
      if (m > 0) { RES.forEach(function (r) { S[r] -= u[r] * m; }); minted += m; }
    }
    mint();
    while (i < plan.length) {
      var t0 = plan[i].travel || 0, add = zero();
      while (i < plan.length && (plan[i].travel || 0) - t0 < SAME_ARRIVAL) { RES.forEach(function (r) { add[r] += plan[i].res[r]; }); i++; }
      RES.forEach(function (r) { if (S[r] + I[r] + add[r] > cap) room = true; S[r] += add[r]; });
      if (room) break;
      mint();
    }
    if (room) return { ok: false, room: true, plan: plan, got: got, why: why };
    RES.forEach(function (r) { S[r] += I[r]; });
    mint();
    return { ok: minted >= k, plan: plan, got: got, why: why };
  }

  // Exakte Verteilung als Max-Flow. BFS besucht Dörfer in Laufzeit-Reihenfolge -> schnelle Dörfer zuerst.
  function maxFlowAlloc(sources, D, capLeft) {
    var nV = sources.length, SRC = 0, SNK = nV + 4, N = nV + 5, cap = [], adj = [];
    for (var a = 0; a < N; a++) { cap.push(new Array(N).fill(0)); adj.push([]); }
    function edge(x, y, c) { if (!cap[x][y] && !cap[y][x]) { adj[x].push(y); adj[y].push(x); } cap[x][y] += c; }
    sources.forEach(function (s, j) {
      edge(SRC, 1 + j, capLeft[s.id]);
      RES.forEach(function (r, ri) { edge(1 + j, nV + 1 + ri, Math.max(0, s.res[r] - cfg.reserve)); });
    });
    RES.forEach(function (r, ri) { edge(nV + 1 + ri, SNK, D[r]); });
    var flow = []; for (a = 0; a < N; a++) flow.push(new Array(N).fill(0));
    for (var guard = 0; guard < 200000; guard++) {
      var prev = new Array(N).fill(-1), q = [SRC]; prev[SRC] = SRC;
      while (q.length && prev[SNK] < 0) {
        var x = q.shift();
        adj[x].forEach(function (y) { if (prev[y] < 0 && cap[x][y] - flow[x][y] > 0) { prev[y] = x; q.push(y); } });
      }
      if (prev[SNK] < 0) break;
      var bott = Infinity, v;
      for (v = SNK; v !== SRC; v = prev[v]) bott = Math.min(bott, cap[prev[v]][v] - flow[prev[v]][v]);
      for (v = SNK; v !== SRC; v = prev[v]) { flow[prev[v]][v] += bott; flow[v][prev[v]] -= bott; }
    }
    var f = sources.map(function (s, j) { var o = {}; RES.forEach(function (r, ri) { o[r] = Math.max(0, flow[1 + j][nV + 1 + ri]); }); return o; });
    var miss = {}; RES.forEach(function (r, ri) { miss[r] = D[r] - flow[nV + 1 + ri][SNK]; });
    return { f: f, miss: miss };
  }

  function distributeSets(n, sources) {
    var u = n.unit, N = Math.ceil(n.n), best = null, first = null;
    for (var k = N; k >= 1; k--) {
      var r = allocSets(n, sources, k);
      if (!first) first = r;
      if (r.ok) { best = r; best.k = k; break; }
    }
    if (!best) { best = { plan: [], got: zero(), why: first ? first.why : {}, k: 0 }; }
    var restSets = Math.max(0, N - best.k), rest = {};
    RES.forEach(function (r) { rest[r] = Math.max(0, N * u[r] + cfg.reserve - n.have[r] - best.got[r]); });
    return { plan: best.plan, rest: rest, restSets: restSets, why: best.why, k: best.k, N: N,
      neck: first && first.neck, roomLimited: !!(first && first.room), got: best.got };
  }

  function ratio(u, f) { var o = {}; RES.forEach(function (r) { o[r] = Math.floor(u[r] * f); }); return o; }
  function makePlan(n, sources) { return n.mode === 'sets' ? distributeSets(n, sources) : distribute(n.need, sources); }
  function hasNeed(n) { return n.mode === 'sets' ? n.sets > 0 : total(n.need) > 0; }

  // Schnellste Dörfer mit freien Händlern wählen, bis der Bedarf gedeckt ist
  function autoSelect(st) {
    var n = computeNeed(st), chosen = [];
    if (!hasNeed(n)) return chosen;
    for (var i = 0; i < st.sources.length; i++) {
      if (total(makePlan(n, st.sources.filter(function (s) { return chosen.indexOf(s.id) >= 0; })).rest) <= 0) break;
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
    var st = { items: items.slice(), incoming: zero(), incomingAuto: false, sources: [], sel: [], plan: null, locked: false, busy: false, binfo: null };
    w.Dialog.show('rohAnf', '<div id="ra"><p class="ra-muted" style="padding:14px">Lade Dörfer, Laufzeiten und eingehende Rohstoffe …</p></div>');
    $.when(loadSources(), loadCallPage(), getBuildingInfo(), getCoin()).done(function (sources, call, binfo, conf) {
      st.binfo = binfo;
      var speed = (conf && conf.speed) || 1;
      st.sources = (sources || []).map(function (s) {
        var t = call && call.travel[s.coord];
        s.travel = t != null ? t : Math.round(s.dist * 360 / speed);
        s.travelEst = t == null;
        return s;
      }).sort(function (a, b) { return a.travel - b.travel; });
      if (call && call.inc) { st.incoming = call.inc; st.incomingAuto = true; }
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
        '<div id="ra_info"></div>' +
        '<div id="ra_add" style="display:none;padding:0 10px 8px">' +
          icon('wood') + '<input id="ra_mw" ' + inp + '> ' + icon('stone') + '<input id="ra_ms" ' + inp + '> ' +
          icon('iron') + '<input id="ra_mi" ' + inp + '> <a href="#" class="btn" id="ra_addM">Hinzufügen</a></div>' +
        '<details id="ra_det"><summary>Berechnung</summary><div class="ra-grid" id="ra_calc"></div></details>' +
        '<div id="ra_warn"></div>' +
      '</div>' +

      '<div class="ra-card"><div class="ra-head">Lieferdörfer<span><a id="ra_auto">Automatisch</a><a id="ra_none">Keine</a></span></div>' +
        '<div class="ra-list" id="ra_list"></div>' +
        '<details><summary>Einstellungen</summary><div style="margin-top:6px">' +
          'Reserve je Rohstoff <span class="ra-muted">(Liefer- und Zieldorf)</span> <input id="ra_reserve" ' + inp + ' value="' + cfg.reserve + '"> &nbsp; ' +
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
      st.plan = hasNeed(n) && srcs.length ? makePlan(n, srcs) : null;
    }
    st.mode = n.mode;
    var shown = n.mode === 'sets' && st.plan ? st.plan.got : n.need;
    $('#ra_sum').html(RES.map(function (r) { return '<span>' + icon(r) + fmt(shown[r]) + '</span>'; }).join('') +
      (n.mode === 'sets' && st.plan ? '<span class="ra-muted" style="font-size:12px;font-weight:normal;align-self:center">→ ' + st.plan.k + ' von ' + st.plan.N + ' ' + KIND[n.kind][1] + '</span>' : ''));
    var incTot = n.mode === 'sets' ? total(n.inc) : 0;
    $('#ra_info').html(n.mode === 'sets' && n.sets > 0
      ? '<div class="ra-info"><b>Ganze ' + KIND[n.kind][1] + ':</b> Es wird nur so viel angefordert, wie zusammen mit Lager und Unterwegs genau ganze ' + KIND[n.kind][1] +
        ' ergibt – es bleibt nichts im Verhältnis übrig. Nach dem Prägen bleibt im Dorf die <b>Reserve von ' + fmt(cfg.reserve) + '</b> je Rohstoff, wie bei den Lieferdörfern. ' +
        'Die automatische Prägung zwischen den Ankünften ist eingerechnet, der Speicher (' + fmt(n.cap) + ') läuft bei keiner Ankunft über.' +
        '<br><b>Unterwegs zum Dorf:</b> ' + (incTot > 0 ? RES.map(function (r) { return icon(r) + fmt(n.inc[r]); }).join(' ') + ' – wird eingerechnet, egal wann es ankommt.'
          : (st.incomingAuto ? 'nichts.' : '<span style="color:#a01800">nicht erkannt – falls noch etwas unterwegs ist, unter „Berechnung“ eintragen.</span>')) + '</div>'
      : '');
    $('#ra_chips').html(st.items.length
      ? st.items.map(function (it, i) {
          var bi = it.bid && st.binfo && st.binfo[it.bid];
          if (it.kind) return '<span class="ra-chip"><input type="number" class="ra_n" data-i="' + i + '" min="1" value="' + it.n + '"' + (st.locked ? ' disabled' : '') + '> ' +
            KIND[it.kind][it.n > 1 ? 1 : 0] + (st.locked ? '' : '<a class="ra_rm" data-i="' + i + '" title="Entfernen">×</a>') + '</span>';
          var lab = bi && it.from
            ? esc(it.name) + ' Stufe ' + it.from + ' <span class="ra-muted">bis</span> <input type="number" class="ra_to" data-i="' + i + '" min="' + it.from + '" max="' + (bi.max || 99) + '" value="' + it.to + '"' + (st.locked ? ' disabled' : '') + '>'
            : esc(it.label);
          return '<span class="ra-chip">' + lab + (st.locked ? '' : '<a class="ra_rm" data-i="' + i + '" title="Entfernen">×</a>') + '</span>';
        }).join('')
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
    if (st.plan && n.mode === 'sets' && st.plan.restSets > 0) {
      warn.push('Planbar sind ' + st.plan.k + ' von ' + st.plan.N + ' ' + KIND[n.kind][1] + '. Engpass: ' +
        (st.plan.roomLimited ? 'Speicherplatz pro Ankunft – den Rest anfordern, wenn geprägt wurde.'
         : st.plan.neck ? RES_DE[st.plan.neck] + ' bzw. Händler in den angehakten Dörfern – Dörfer mit mehr ' + RES_DE[st.plan.neck] + ' oder freien Händlern anhaken oder Reserve senken.'
         : 'Händler in den angehakten Dörfern – weitere Dörfer anhaken.'));
    } else if (st.plan && total(st.plan.rest) > 0) {
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
      else if (on) act = '<span class="ra-muted ra-why">' + esc((st.plan && st.plan.why && st.plan.why[s.id]) || 'nicht nötig') + '</span>';
      return '<div class="' + cls + '">' +
        '<input type="checkbox" class="ra_src" value="' + s.id + '"' + (on ? ' checked' : '') + (st.locked ? ' disabled' : '') + '>' +
        '<div class="ra-name" title="' + esc(s.name) + ' – ' + s.dist.toFixed(1) + ' Felder' + (s.travelEst ? ', Laufzeit geschätzt' : '') + '">' + esc(s.name) +
          ' <span class="ra-muted">' + (s.travelEst ? '≈' : '') + dur(s.travel) + (on ? ' · an ' + arrival(s.travel) : '') +
'</span></div>' +
        (pl ? resLine(pl.p.res, 'plan') : resLine(s.res, 'stock')) +
        '<div class="ra-mer" title="' + (pl ? 'benötigte Händler (von ' + s.merchants + ' freien)' + (pl.p.equiv ? ' – entspricht ' + dez(pl.p.equiv) + ' ' + KIND[st.items[0].kind][1] : '') : 'freie Händler') + '">' + (pl ? pl.p.merchants + ' H.' : s.merchants + ' frei') + '</div>' +
        '<div class="ra-act">' + act + '</div></div>';
    }).join('') : '<p class="ra-muted" style="padding:8px">Keine weiteren Dörfer gefunden.</p>');
    renderFoot(st);
  }

  function renderFoot(st) {
    var $f = $('#ra_foot');
    if (!st.plan || !st.plan.plan.length) { $f.html('<span class="ra-muted">' + (st.items.length ? 'Lieferdörfer auswählen.' : '') + '</span>'); return; }
    var all = st.plan.plan.length, done = st.plan.plan.filter(function (p) { return p.sent; }).length;
    var last = Math.max.apply(null, st.plan.plan.map(function (p) { return p.travel || 0; }));
    $f.html('<span class="ra-muted">' + (st.locked ? 'Plan gesperrt – für einen neuen Plan Fenster neu öffnen. ' : 'Ein Klick = eine Anforderung. ') + done + ' von ' + all + ' angefordert' +
      (total(st.plan.rest) <= 0 ? ' · alles da um ca. <b>' + arrival(last) + '</b>' : '') + '</span>' +
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
    $d.on('change.ra', '.ra_n', guard(function () {
      var it = st.items[num($(this).data('i'))];
      if (!it || !it.kind) return;
      var nn = Math.max(1, num(this.value));
      st.items[num($(this).data('i'))] = setItem(it.kind, it.unit, nn);
      st.sel = autoSelect(st); update(st);
    }));
    $d.on('change.ra', '.ra_to', guard(function () {
      var it = st.items[num($(this).data('i'))], bi = it && st.binfo && st.binfo[it.bid];
      if (!it || !bi) return;
      it.to = Math.min(Math.max(num(this.value), it.from), bi.max || 99);
      it.cost = itemCost(it, st.binfo);
      st.sel = autoSelect(st); update(st);
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
