/*
 * Rohstoffe anfordern by Maltox – TESTVERSION mit Diagnose-Ausgaben in der Konsole (F12)
 * Laden: javascript:$.getScript('https://cdn.jsdelivr.net/gh/Maltox-DS/ds-scripts@main/rohstoffeAnfordernTest.js');void 0;
 * Version: 0.2 (Entwurf – NICHT genehmigt, nur zum Testen)
 *
 * Ablauf:
 *   1. Im Hauptgebäude starten: Bedarf zusammenstellen (Gebäude, Münzen, AG, freie Menge),
 *      Lieferdörfer anhaken, Verteilung prüfen, "Im Marktplatz eintragen" klicken.
 *   2. Auf der Marktplatz-Seite "Anfordern" das Skript erneut starten:
 *      Es trägt die Mengen in die Felder ein. Den Button "Anfordern" klickst du selbst.
 *
 * Regeln: Das Skript sendet selbst nichts ab, klickt keine Buttons und lädt nichts von
 * fremden Servern. Es liest nur Spielseiten deines eigenen Accounts und füllt Formularfelder.
 */
(function () {
  'use strict';

  if (typeof game_data === 'undefined') { alert('Bitte im Spiel ausführen.'); return; }

  function dbg() { try { console.log.apply(console, ['[RohAnf TEST]'].concat([].slice.call(arguments))); } catch (e) { /* egal */ } }
  if (window.UI && UI.InfoMessage) UI.InfoMessage('Rohstoffe anfordern – TESTVERSION (Diagnose in der Konsole, F12)');

  var RES = ['wood', 'stone', 'iron'];
  var RES_DE = { wood: 'Holz', stone: 'Lehm', iron: 'Eisen' };
  var KEY = 'rohAnf_' + game_data.world + '_' + game_data.player.id;
  var CFG_KEY = KEY + '_cfg';
  var PLAN_KEY = KEY + '_plan';

  // AG-Einheitenkosten (Standard). Münzkosten werden aus der Weltkonfiguration gelesen.
  var SNOB_COST = { wood: 40000, stone: 50000, iron: 50000 };
  var COIN_FALLBACK = { wood: 28000, stone: 30000, iron: 25000 };

  // ---------- Hilfsfunktionen ----------
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function del(k) { try { localStorage.removeItem(k); } catch (e) { /* egal */ } }
  function num(t) { var n = parseInt(String(t == null ? '' : t).replace(/[^\d]/g, ''), 10); return isNaN(n) ? 0 : n; }
  function fmt(n) { return Number(n || 0).toLocaleString('de-DE'); }
  function icon(r) { return '<span class="icon header ' + r + '"></span>'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function resCells(o, bold) {
    return RES.map(function (r) {
      var v = fmt(o[r]);
      return '<td style="white-space:nowrap">' + icon(r) + (bold ? '<b>' + v + '</b>' : v) + '</td>';
    }).join('');
  }
  function msg(type, text) {
    if (window.UI && UI[type]) UI[type](text); else alert(text);
  }

  var cfg = $.extend({ reserve: 5000, merchantCap: 1000, deductStock: true, sel: [] }, load(CFG_KEY, {}));

  // ---------- Router ----------
  var params = new URLSearchParams(location.search);
  var screen = game_data.screen || params.get('screen');
  var mode = game_data.mode || params.get('mode');

  if (screen === 'main') {
    initHQ();
  } else if (screen === 'market' && mode === 'call') {
    fillMarket();
  } else {
    msg('InfoMessage', 'Rohstoffe anfordern: bitte im Hauptgebäude starten – ich wechsle dorthin.');
    location.href = game_data.link_base_pure + 'main';
  }

  // =====================================================================
  // Teil 1: Hauptgebäude – Bedarf, Lieferdörfer, Verteilung
  // =====================================================================
  function initHQ() {
    var premium = game_data.features && game_data.features.Premium && game_data.features.Premium.active;
    if (premium === false) {
      msg('ErrorMessage', 'Die Anfordern-Seite im Marktplatz benötigt einen Premium-Account.');
      return;
    }

    var state = {
      buildings: readBuildings(),
      coin: $.extend({}, COIN_FALLBACK),
      isCoinWorld: true,
      items: [],
      underway: { wood: 0, stone: 0, iron: 0 },
      sources: []
    };

    var cfgReq = $.get('/interface.php?func=get_config').then(function (xml) {
      var $x = $(xml);
      RES.forEach(function (r) {
        var v = num($x.find('snob coin_' + r).text());
        if (v > 0) state.coin[r] = v;
      });
      var gold = $x.find('snob gold').text();
      if (gold !== '') state.isCoinWorld = gold === '1';
    }, function () { /* Fallback-Werte bleiben */ });

    var srcReq = $.get(game_data.link_base_pure + 'overview_villages&mode=prod&group=0&page=-1')
      .then(function (html) { state.sources = parseSources(html); });

    $.when(cfgReq, srcReq).always(function () {
      dbg('Gebäude gelesen:', state.buildings);
      dbg('Lieferdörfer gelesen:', state.sources);
      dbg('Münzkosten:', state.coin, 'Münzwelt:', state.isCoinWorld);
      if (!state.sources.length) {
        msg('ErrorMessage', 'Konnte die Produktionsübersicht nicht lesen (Premium aktiv? Mehrere Dörfer vorhanden?).');
      }
      render(state);
    });
  }

  function readBuildings() {
    var list = [];
    var bm = window.BuildingMain && BuildingMain.buildings;
    if (bm) {
      $.each(bm, function (id, b) {
        if (!b || b.wood == null || b.stone == null || b.iron == null) return;
        if (b.max_level != null && b.level_next != null && num(b.level_next) > num(b.max_level)) return;
        list.push({
          id: id,
          name: b.name || id,
          level: b.level_next != null ? 'Stufe ' + b.level_next : '',
          cost: { wood: num(b.wood), stone: num(b.stone), iron: num(b.iron) }
        });
      });
    }
    if (!list.length) {
      // Fallback: Tabelle im Hauptgebäude auslesen (data-cost-Attribute, ohne Tausenderpunkte)
      $('#buildings tr[id^="main_buildrow_"]').each(function () {
        var $r = $(this);
        var id = this.id.replace('main_buildrow_', '');
        var $all = $r.find('[data-cost]');
        if ($all.length < 3) return;
        var cost = {};
        RES.forEach(function (r, i) {
          var $c = $r.find('.cost_' + r + '[data-cost]');
          if (!$c.length) $c = $all.eq(i);
          var a = $c.attr('data-cost');
          cost[r] = a != null && a !== '' ? num(a) : num($c.text());
        });
        var name = $.trim($r.find('td').first().find('a').filter(function () { return $.trim($(this).text()) !== ''; }).first().text()) || id;
        list.push({ id: id, name: name, level: '', cost: cost });
      });
    }
    return list;
  }

  function parseSources(html) {
    var out = [];
    var me = { x: num(game_data.village.x), y: num(game_data.village.y) };
    $(html).find('#production_table tr').each(function () {
      var $r = $(this);
      var $vn = $r.find('span.quickedit-vn').first();
      if (!$vn.length) return;
      var id = String($vn.attr('data-id') || '');
      if (!id || id === String(game_data.village.id)) return;

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
    return out;
  }

  // ---------- Berechnung ----------
  function computeNeed(state) {
    var sum = { wood: 0, stone: 0, iron: 0 };
    state.items.forEach(function (it) { RES.forEach(function (r) { sum[r] += it.cost[r]; }); });

    var cap = num(game_data.village.storage_max);
    var need = {}, warn = [];
    RES.forEach(function (r) {
      var have = cfg.deductStock ? num(game_data.village[r]) : 0;
      need[r] = Math.max(0, sum[r] - have - state.underway[r]);
      var after = num(game_data.village[r]) + state.underway[r] + need[r];
      if (after > cap) {
        var reduced = Math.max(0, cap - num(game_data.village[r]) - state.underway[r]);
        warn.push(RES_DE[r] + ': Speicher (' + fmt(cap) + ') reicht nicht – auf ' + fmt(reduced) + ' gekürzt.');
        need[r] = reduced;
      }
      if (sum[r] > cap) warn.push(RES_DE[r] + ': Der Bedarf (' + fmt(sum[r]) + ') ist größer als dein Speicher.');
    });
    return { sum: sum, need: need, warn: warn };
  }

  function distribute(need, sources, reserve, mCap) {
    var rest = { wood: need.wood, stone: need.stone, iron: need.iron };
    var plan = [];
    sources.forEach(function (s) {
      if (rest.wood + rest.stone + rest.iron <= 0) return;
      var take = {};
      RES.forEach(function (r) { take[r] = Math.min(rest[r], Math.max(0, s.res[r] - reserve)); });
      var sum = take.wood + take.stone + take.iron;
      var capacity = s.merchants * mCap;
      if (sum > capacity) {
        var f = capacity / sum;
        RES.forEach(function (r) { take[r] = Math.floor(take[r] * f); });
        sum = take.wood + take.stone + take.iron;
      }
      if (sum <= 0) return;
      RES.forEach(function (r) { rest[r] -= take[r]; });
      plan.push({ id: s.id, name: s.name, coord: s.coord, dist: s.dist, res: take, merchants: Math.ceil(sum / mCap) });
    });
    return { plan: plan, rest: rest };
  }

  // ---------- Oberfläche ----------
  function render(state) {
    var b = state.buildings;
    var bOpts = b.map(function (x, i) {
      return '<option value="' + i + '">' + esc(x.name) + (x.level ? ' (' + esc(x.level) + ')' : '') +
        ' – ' + fmt(x.cost.wood) + ' / ' + fmt(x.cost.stone) + ' / ' + fmt(x.cost.iron) + '</option>';
    }).join('');

    var inp = 'style="width:80px" type="number" min="0"';
    var html = '' +
      '<div id="ra" style="max-width:900px;font-size:12px">' +
      '<h3 style="margin:4px 0">Rohstoffe anfordern → ' + esc(game_data.village.display_name || game_data.village.name) + '</h3>' +
      '<p style="margin:2px 0 8px;color:#603000">Das Skript trägt nur Werte ein. Abschicken tust du selbst im Marktplatz.</p>' +

      '<table class="vis" style="width:100%"><tr><th colspan="2">1. Bedarf hinzufügen</th></tr>' +
      '<tr><td>Gebäude (nächste Stufe)</td><td>' +
        (b.length ? '<select id="ra_b" style="max-width:520px">' + bOpts + '</select> <input type="button" class="btn" id="ra_addB" value="+ hinzufügen">'
                  : '<i>Keine Ausbaukosten gefunden.</i>') + '</td></tr>' +
      (state.isCoinWorld ?
      '<tr><td>Münzen prägen</td><td><input id="ra_coinN" ' + inp + ' value="1" style="width:50px"> × ' +
        fmt(state.coin.wood) + ' / ' + fmt(state.coin.stone) + ' / ' + fmt(state.coin.iron) +
        ' <input type="button" class="btn" id="ra_addC" value="+ hinzufügen"></td></tr>' : '') +
      '<tr><td>AG rekrutieren (nur Einheitenkosten)</td><td><input id="ra_snobN" ' + inp + ' value="1" style="width:50px"> × ' +
        fmt(SNOB_COST.wood) + ' / ' + fmt(SNOB_COST.stone) + ' / ' + fmt(SNOB_COST.iron) +
        ' <input type="button" class="btn" id="ra_addS" value="+ hinzufügen"></td></tr>' +
      '<tr><td>Freie Menge</td><td>' + icon('wood') + '<input id="ra_mw" ' + inp + '> ' + icon('stone') + '<input id="ra_ms" ' + inp + '> ' +
        icon('iron') + '<input id="ra_mi" ' + inp + '> <input type="button" class="btn" id="ra_addM" value="+ hinzufügen"></td></tr>' +
      '</table>' +

      '<div id="ra_needBox"></div>' +

      '<table class="vis" style="width:100%;margin-top:8px"><tr><th>2. Lieferdörfer</th></tr><tr><td>' +
        'Reserve je Rohstoff im Lieferdorf: <input id="ra_reserve" ' + inp + ' value="' + cfg.reserve + '"> &nbsp; ' +
        'Kapazität je Händler: <input id="ra_mcap" ' + inp + ' value="' + cfg.merchantCap + '"> &nbsp; ' +
        '<input type="button" class="btn" id="ra_selNone" value="Keine"> ' +
        '<input type="button" class="btn" id="ra_selNear" value="Nächste 5">' +
      '</td></tr></table>' +
      '<div style="max-height:240px;overflow:auto"><table class="vis" style="width:100%"><tr><th></th><th>Dorf</th><th>Entf.</th>' +
        '<th>Holz</th><th>Lehm</th><th>Eisen</th><th>Händler</th></tr>' +
      state.sources.map(function (s) {
        var on = cfg.sel.indexOf(s.id) >= 0 ? ' checked' : '';
        return '<tr><td><input type="checkbox" class="ra_src" value="' + s.id + '"' + on + '></td>' +
          '<td>' + esc(s.name) + ' (' + s.coord + ')</td><td>' + s.dist.toFixed(1) + '</td>' +
          resCells(s.res) + '<td>' + s.merchants + '/' + s.merchantsTotal + '</td></tr>';
      }).join('') +
      '</table></div>' +

      '<div id="ra_planBox"></div>' +
      '</div>';

    Dialog.show('rohAnf', html);
    bind(state);
    update(state);
  }

  function update(state) {
    var n = computeNeed(state);

    var items = state.items.map(function (it, i) {
      return '<tr><td>' + esc(it.label) + '</td>' + resCells(it.cost) +
        '<td><input type="button" class="btn ra_rm" data-i="' + i + '" value="✕"></td></tr>';
    }).join('');

    var inp = 'style="width:80px" type="number" min="0"';
    $('#ra_needBox').html(
      '<table class="vis" style="width:100%;margin-top:8px"><tr><th>Bedarf</th><th>Holz</th><th>Lehm</th><th>Eisen</th><th></th></tr>' +
      (items || '<tr><td colspan="5"><i>Noch nichts hinzugefügt.</i></td></tr>') +
      '<tr><td>Summe</td>' + resCells(n.sum) + '<td></td></tr>' +
      '<tr><td><label><input type="checkbox" id="ra_deduct"' + (cfg.deductStock ? ' checked' : '') + '> Vorhandene Rohstoffe abziehen</label></td>' +
        resCells({ wood: game_data.village.wood, stone: game_data.village.stone, iron: game_data.village.iron }) + '<td></td></tr>' +
      '<tr><td>Bereits unterwegs (abziehen)</td>' + RES.map(function (r) {
        return '<td>' + icon(r) + '<input class="ra_uw" data-r="' + r + '" ' + inp + ' value="' + (state.underway[r] || '') + '"></td>';
      }).join('') + '<td></td></tr>' +
      '<tr><th>Anzufordern</th>' + resCells(n.need, true) + '<td></td></tr>' +
      '</table>' +
      (n.warn.length ? '<p style="color:#b00000;margin:4px 0">' + n.warn.map(esc).join('<br>') + '</p>' : '')
    );

    var sel = $('.ra_src:checked').map(function () { return this.value; }).get();
    var srcs = state.sources.filter(function (s) { return sel.indexOf(s.id) >= 0; });
    var total = n.need.wood + n.need.stone + n.need.iron;

    if (total <= 0) { $('#ra_planBox').html(''); state.plan = null; return; }
    if (!srcs.length) {
      $('#ra_planBox').html('<p style="margin:6px 0"><i>Wähle mindestens ein Lieferdorf.</i></p>');
      state.plan = null; return;
    }

    var d = distribute(n.need, srcs, cfg.reserve, cfg.merchantCap);
    state.plan = { need: n.need, plan: d.plan };
    var rest = d.rest.wood + d.rest.stone + d.rest.iron;

    $('#ra_planBox').html(
      '<table class="vis" style="width:100%;margin-top:8px"><tr><th>3. Verteilung</th><th>Holz</th><th>Lehm</th><th>Eisen</th><th>Händler</th></tr>' +
      d.plan.map(function (p) {
        return '<tr><td>' + esc(p.name) + ' (' + p.coord + ', ' + p.dist.toFixed(1) + ' F.)</td>' + resCells(p.res) + '<td>' + p.merchants + '</td></tr>';
      }).join('') +
      (rest > 0 ? '<tr><td style="color:#b00000">Fehlt noch (Reserve/Händler/Bestand reichen nicht)</td>' + resCells(d.rest, true) + '<td></td></tr>' : '') +
      '</table>' +
      '<p style="margin:6px 0"><input type="button" class="btn btn-confirm-yes" id="ra_go" value="Im Marktplatz eintragen →"' +
        (d.plan.length ? '' : ' disabled') + '> ' +
      '<small>Danach das Skript auf der Anfordern-Seite erneut starten.</small></p>'
    );
  }

  function bind(state) {
    var $d = $(document);
    $d.off('.ra');
    function addItem(label, cost, n) {
      n = Math.max(1, n || 1);
      state.items.push({ label: (n > 1 ? n + '× ' : '') + label, cost: { wood: cost.wood * n, stone: cost.stone * n, iron: cost.iron * n } });
      update(state);
    }
    $d.on('click.ra', '#ra_addB', function () {
      var x = state.buildings[num($('#ra_b').val())];
      if (x) addItem(x.name + (x.level ? ' (' + x.level + ')' : ''), x.cost, 1);
    });
    $d.on('click.ra', '#ra_addC', function () { addItem('Münze(n)', state.coin, num($('#ra_coinN').val())); });
    $d.on('click.ra', '#ra_addS', function () { addItem('AG', SNOB_COST, num($('#ra_snobN').val())); });
    $d.on('click.ra', '#ra_addM', function () {
      var c = { wood: num($('#ra_mw').val()), stone: num($('#ra_ms').val()), iron: num($('#ra_mi').val()) };
      if (c.wood + c.stone + c.iron > 0) addItem('Freie Menge', c, 1);
    });
    $d.on('click.ra', '.ra_rm', function () { state.items.splice(num($(this).data('i')), 1); update(state); });
    $d.on('change.ra', '#ra_deduct', function () { cfg.deductStock = this.checked; save(CFG_KEY, cfg); update(state); });
    $d.on('change.ra', '.ra_uw', function () { state.underway[$(this).data('r')] = num(this.value); update(state); });
    $d.on('change.ra', '#ra_reserve, #ra_mcap', function () {
      cfg.reserve = num($('#ra_reserve').val());
      cfg.merchantCap = Math.max(1, num($('#ra_mcap').val()) || 1000);
      save(CFG_KEY, cfg); update(state);
    });
    $d.on('change.ra', '.ra_src', function () {
      cfg.sel = $('.ra_src:checked').map(function () { return this.value; }).get();
      save(CFG_KEY, cfg); update(state);
    });
    $d.on('click.ra', '#ra_selNone', function () { $('.ra_src').prop('checked', false).first().trigger('change'); });
    $d.on('click.ra', '#ra_selNear', function () {
      $('.ra_src').prop('checked', false).slice(0, 5).prop('checked', true);
      $('.ra_src').first().trigger('change');
    });
    $d.on('click.ra', '#ra_go', function () {
      if (!state.plan || !state.plan.plan.length) return;
      var ok = save(PLAN_KEY, {
        target: String(game_data.village.id),
        created: Date.now(),
        filled: false,
        need: state.plan.need,
        plan: state.plan.plan
      });
      if (!ok) { msg('ErrorMessage', 'Plan konnte nicht gespeichert werden (Browser-Speicher blockiert?).'); return; }
      location.href = game_data.link_base_pure + 'market&mode=call';
    });
  }

  // =====================================================================
  // Teil 2: Marktplatz "Anfordern" – Werte eintragen (kein Absenden!)
  // =====================================================================
  function fillMarket() {
    var p = load(PLAN_KEY, null);
    if (!p || p.target !== String(game_data.village.id)) {
      msg('ErrorMessage', 'Kein offener Plan für dieses Dorf. Starte das Skript zuerst im Hauptgebäude.');
      return;
    }
    if (p.filled && !confirm('Dieser Plan wurde schon einmal eingetragen. Wurde die Anforderung bereits abgeschickt? ' +
        'Nur fortfahren, wenn NICHT. Erneut eintragen?')) {
      showBox(p, [], true);
      return;
    }
    if (Date.now() - p.created > 30 * 60 * 1000 &&
        !confirm('Der Plan ist älter als 30 Minuten – die Bestände können sich geändert haben. Trotzdem eintragen?')) {
      return;
    }

    // Vorher alle Anforderungsfelder leeren, damit nichts Altes mitgeschickt wird
    $('input[name^="resource["]').val('').trigger('input').trigger('change');

    // 1. Felder je Lieferdorf finden
    var missing = [];
    var targets = [];
    p.plan.forEach(function (e) {
      var $row = $();
      var inputs = {};
      RES.forEach(function (r, idx) {
        var $i = $('input[name="resource[' + e.id + '][' + r + ']"]');
        if (!$i.length) {
          // Fallback: Zeile über Koordinaten finden
          if (!$row.length) {
            $row = $('tr').filter(function () { return $(this).find('input').length && $(this).text().indexOf(e.coord) >= 0; }).first();
          }
          $i = $row.find('input[name*="' + r + '"]');
          if (!$i.length) $i = $row.find('input[type="text"], input[type="number"]').eq(idx);
        }
        if ($i.length) {
          inputs[r] = $i.first();
          if (!$row.length) $row = $i.first().closest('tr');
        }
      });
      if (inputs.wood || inputs.stone || inputs.iron) targets.push({ e: e, $row: $row, inputs: inputs });
      else missing.push(e.name + ' (' + e.coord + ')');
    });

    dbg('Plan:', p);
    dbg('Gefundene Zeilen:', targets.map(function (t) { return { dorf: t.e.name, felder: Object.keys(t.inputs).map(function (r) { return t.inputs[r].attr('name'); }), checkbox: t.$row.find('input[type="checkbox"]').attr('name') }; }));
    dbg('Nicht gefunden:', missing);

    // 2. ZUERST anhaken – das Spiel füllt dabei die Felder mit seiner Vorlage (z. B. "Maximum")
    targets.forEach(function (t) {
      var $cb = t.$row.find('input[type="checkbox"]');
      if ($cb.length && !$cb.prop('checked')) $cb.prop('checked', true).trigger('change');
    });

    // 3. DANACH die eigenen Werte eintragen (überschreibt die Vorlage)
    function writeValues(withEvents) {
      targets.forEach(function (t) {
        RES.forEach(function (r) {
          var $i = t.inputs[r];
          if (!$i) return;
          $i.val(t.e.res[r] > 0 ? t.e.res[r] : 0);
          if (withEvents) $i.trigger('input').trigger('keyup').trigger('change');
          $i.css('background', '#c8f7c5');
        });
        t.$row.css('outline', '2px solid #2e9e2e');
      });
    }
    function snapshot() {
      return targets.map(function (t) {
        var o = { dorf: t.e.name, soll: t.e.res };
        o.ist = {}; RES.forEach(function (r) { o.ist[r] = t.inputs[r] ? t.inputs[r].val() : '–'; });
        return o;
      });
    }
    function wrongValues() {
      var bad = [];
      targets.forEach(function (t) {
        RES.forEach(function (r) {
          var $i = t.inputs[r];
          if ($i && num($i.val()) !== (t.e.res[r] || 0)) bad.push(t.e.name);
        });
      });
      return bad.filter(function (v, i, a) { return a.indexOf(v) === i; });
    }

    dbg('Werte nach Anhaken (Spielvorlage):', snapshot());
    writeValues(true);
    dbg('Werte direkt nach Eintragen:', snapshot());
    // Kontrolle: falls das Spiel nach einem Event nochmal überschreibt, Werte ohne Events erneut setzen
    setTimeout(function () {
      dbg('Werte nach 400 ms:', snapshot(), 'abweichend:', wrongValues());
      if (wrongValues().length) writeValues(false);
      var bad = wrongValues();
      p.filled = true;
      save(PLAN_KEY, p);
      showBox(p, missing.concat(bad.map(function (n) { return n + ' – Wert abweichend, bitte von Hand prüfen'; })), false);
      if (bad.length) msg('ErrorMessage', 'Einige Werte weichen ab – bitte vor dem Anfordern prüfen.');
      else msg('SuccessMessage', 'Werte eingetragen – bitte prüfen und selbst auf „Anfordern“ klicken.');
    }, 400);
  }

  function showBox(p, missing, onlyShow) {
    $('#ra_box').remove();
    var html = '<div id="ra_box" class="vis" style="margin:6px 0;padding:6px;border:1px solid #7d510f;background:#f4e4bc">' +
      '<b>Rohstoffe anfordern – Plan</b> ' +
      '<input type="button" class="btn" id="ra_discard" value="Plan verwerfen"><br>' +
      '<table class="vis" style="margin-top:4px"><tr><th>Lieferdorf</th><th>Holz</th><th>Lehm</th><th>Eisen</th></tr>' +
      p.plan.map(function (e) { return '<tr><td>' + esc(e.name) + ' (' + e.coord + ')</td>' + resCells(e.res) + '</tr>'; }).join('') +
      '</table>' +
      (missing.length ? '<p style="color:#b00000;margin:4px 0">Bitte prüfen (nicht gefunden oder abweichend):' + missing.map(esc).join(', ') + '</p>' : '') +
      (onlyShow ? '' : '<p style="margin:4px 0">Prüfe die grün markierten Felder und klicke dann selbst auf <b>Anfordern</b>.</p>') +
      '</div>';
    var $target = $('#content_value').length ? $('#content_value') : $('#contentContainer');
    $target.prepend(html);
    $(document).off('click.raBox').on('click.raBox', '#ra_discard', function () {
      del(PLAN_KEY);
      $('#ra_box').remove();
      msg('SuccessMessage', 'Plan verworfen.');
    });
  }
})();
