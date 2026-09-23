/* Mass Scavenge Extended by Maltox
   Erweiterung für "Mass scavenging" von Shinko to Kuma (Max, Profile, Dorfgruppe, Vorschau, Alle Profile, neues Fenster)
   Laden per Schnellleiste:  javascript:$.getScript('https://cdn.jsdelivr.net/gh/Maltox-DS/ds-scripts@main/massScavengeExtended.js');void 0; */
var premiumBtnEnabled = false;

(function () {
    var SCRIPT_URL = 'https://shinko-to-kuma.com/scripts/massScavenge.js';
    var MAX_KEY = 'maxSend';
    var PROFILE_KEY = 'msProfiles';
    /* Alle Einstellungen des Originals + Max, die pro Profil gespeichert werden */
    var runInfo = {};
    function onlyCurrent() { return lsGet('msOnlyCurrent') === '1'; }
    /* Rückkehrzeit (Unix-Sekunden) des spätesten laufenden Raubzugs im Dorf, sonst null */
    function freeStages(data) {
        var o = data && data.options, n = 0;
        if (!o) return null;
        Object.keys(o).forEach(function (k) { if (o[k] && !o[k].is_locked && !o[k].scavenging_squad) n++; });
        return n;
    }
    function runningUntil(data) {
        var o = data && data.options, until = null;
        if (!o) return null;
        Object.keys(o).forEach(function (k) {
            if (!o[k] || o[k].is_locked) return; /* nur freigeschaltete Stufen prüfen */
            var sq = o[k].scavenging_squad;
            if (sq) { var t = +(sq.return_time || sq.finish_time || 0); until = Math.max(until || 0, t); }
        });
        return until;
    }
    var batching = false, batchGroup = null, vilMap = {}, sendList = [];
    var SETTING_KEYS = ['troopTypeEnabled', 'keepHome', 'categoryEnabled', 'prioritiseHighCat',
                        'timeElement', 'sendOrder', 'runTimes', MAX_KEY];

    /* ---------- Hilfsfunktionen ---------- */
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
    function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

    /* ---------- Profile ---------- */
    function loadProfiles() {
        var p;
        try { p = JSON.parse(lsGet(PROFILE_KEY)); } catch (e) { p = null; }
        if (!p || !p.list || !Object.keys(p.list).length) {
            p = { active: 'Standard', list: { 'Standard': { group: '0', settings: snapshot() } } };
            saveProfiles(p);
        }
        if (!p.list[p.active]) p.active = Object.keys(p.list)[0];
        return p;
    }
    function saveProfiles(p) { lsSet(PROFILE_KEY, JSON.stringify(p)); }
    function snapshot() {
        var s = {};
        SETTING_KEYS.forEach(function (k) { var v = lsGet(k); if (v != null) s[k] = v; });
        return s;
    }
    function applySettings(s) {
        SETTING_KEYS.forEach(function (k) { if (s && s[k] != null) lsSet(k, s[k]); else if (k === MAX_KEY) lsDel(k); });
    }
    function storeActive() {
        if (batching) return;
        var p = loadProfiles();
        p.list[p.active].settings = snapshot();
        saveProfiles(p);
    }
    /* '0'/leer = Standardgruppe -> die spielinterne Gruppe "alle" */
    function resolveGroup(g) { return (!g || g === '0') ? (lsGet('msDefaultGroup') || '0') : String(g); }
    function activeGroup() { if (batching) return batchGroup; var p = loadProfiles(); return resolveGroup(p.list[p.active].group); }

    /* ---------- Dorfgruppe: an alle Massen-Raubzug-Abfragen anhängen ---------- */
    if (!window.__msGroupHook) {
        window.__msGroupHook = true;
        $.ajaxPrefilter(function (opt) {
            if (opt.url && /mode=scavenge_mass/.test(opt.url) && !/[?&]group=/.test(opt.url)) {
                opt.url += '&group=' + encodeURIComponent(activeGroup());
            }
        });
    }

    var groupCache = null;
    var groupWaiters = null; /* läuft die Abfrage schon, warten weitere Aufrufer auf dasselbe Ergebnis */
    function loadGroups(cb) {
        if (groupCache) return cb(groupCache);
        if (groupWaiters) { groupWaiters.push(cb); return; }
        groupWaiters = [cb];
        function finish(r) { var w = groupWaiters || []; groupWaiters = null; w.forEach(function (f) { f(r); }); }
        $.get(game_data.link_base_pure + 'groups&mode=overview&ajax=load_group_menu')
            .done(function (d) {
                try {
                    if (typeof d === 'string') d = JSON.parse(d);
                    groupCache = [];
                    var def = null;
                    (d.result || []).forEach(function (g) {
                        if (g.group_id == null || g.type === 'separator') return;
                        groupCache.push({ id: String(g.group_id), name: g.name });
                        if (!def && (g.type === 'all' || String(g.name).trim().toLowerCase() === 'alle')) def = String(g.group_id);
                    });
                    if (!groupCache.length) groupCache = null;
                    else lsSet('msDefaultGroup', def || groupCache[0].id);
                } catch (e) { groupCache = null; }
                finish(groupCache);
            })
            .fail(function () { finish(null); });
    }

    /* ---------- Max pro Einheit ---------- */
    function loadMax() { try { return JSON.parse(lsGet(MAX_KEY)) || {}; } catch (e) { return {}; } }
    function getKeep(unit) {
        var k = (typeof keepHome !== 'undefined' && keepHome) ? keepHome : null;
        if (!k) { try { k = JSON.parse(lsGet('keepHome')) || {}; } catch (e) { k = {}; } }
        return parseInt(k[unit], 10) || 0;
    }

    /* ---------- Hooks ins Original (nach jedem Laden neu setzen) ---------- */
    function installHooks() {
        if (typeof window.calculateHaulCategories !== 'function' || typeof window.readyToSend !== 'function') {
            UI.ErrorMessage('Erweiterung: Original geändert, deaktiviert.');
            return false;
        }
        var origCalc = window.calculateHaulCategories;
        window.calculateHaulCategories = function (data) {
            var max = loadMax();
            if (data && data.unit_counts_home) {
                var capped = Object.assign({}, data.unit_counts_home);
                Object.keys(max).forEach(function (unit) {
                    var m = parseInt(max[unit], 10);
                    if (m > 0 && capped[unit] != null) capped[unit] = Math.min(capped[unit], getKeep(unit) + m);
                });
                data = Object.assign({}, data, { unit_counts_home: capped });
            }
            /* Checkbox "nur aktuelles Dorf" */
            if (onlyCurrent() && data && String(data.village_id) !== String(game_data.village && game_data.village.id)) return;
            /* Laufender Raubzug im Dorf: neue Züge dürfen nicht länger laufen als der späteste laufende */
            var run = runningUntil(data);
            if (run === null || freeStages(data) === 0) return origCalc.call(this, data); /* kein Lauf oder keine freie Stufe: nichts zu kürzen */
            var remain = run - nowMs() / 1000, vid = data.village_id;
            var minDur = ((typeof duration_initial_seconds !== 'undefined' ? duration_initial_seconds : 0) + 60) *
                         (typeof duration_factor !== 'undefined' && duration_factor ? duration_factor : 1);
            if (!(remain > minDur) || typeof time === 'undefined' || !time) { runInfo[vid] = { skip: true, until: run }; return; }
            var hrs = remain / 3600, oldOff = time.off, oldDef = time.def;
            runInfo[vid] = { until: run, capped: (hrs < oldOff || hrs < oldDef) };
            time.off = Math.min(oldOff, hrs); time.def = Math.min(oldDef, hrs);
            try { return origCalc.call(this, data); } finally { time.off = oldOff; time.def = oldDef; }
        };
        /* Nach "Laufzeiten berechnen" speichert das Original seine Einstellungen -> ins aktive Profil übernehmen */
        var origReady = window.readyToSend;
        window.readyToSend = function () {
            if (!batching) runInfo = {};
            /* Das Original entfernt beim Berechnen sein Einstellungsfenster (getData). Damit "Berechnen"
               mehrfach funktioniert, wird es kurz umbenannt und danach zurückbenannt. Altes Launch-Fenster weg. */
            $('#massScavengeFinal').remove();
            var so = document.getElementById('massScavengeSophie');
            if (so) so.id = 'msSophieKeep';
            var r;
            try { r = origReady.apply(this, arguments); }
            finally { var k = document.getElementById('msSophieKeep'); if (k) k.id = 'massScavengeSophie'; }
            storeActive();
            return r;
        };
        return true;
    }

    function startOriginal() {
        $.getScript(SCRIPT_URL, function () {
            if (installHooks()) addUi();
        });
    }

    /* ---------- Oberfläche ---------- */
    var MAX_TIP = 'Maximal pro Dorf losschicken (leer/0 = kein Limit)';
    function bindMax(inp, unit) {
        $(inp).on('input change', function () {
            var m = loadMax(), v = parseInt($(this).val(), 10);
            if (v > 0) m[unit] = v; else delete m[unit];
            lsSet(MAX_KEY, JSON.stringify(m));
            storeActive();
        });
    }
    /* Max-Zeilen als Kopie der Backup-Zeilen einfügen, damit sie genauso aussehen */
    function addMaxInputs() {
        var max = loadMax();
        $('input[id$="Backup"]').each(function () {
            var unit = this.id.replace(/Backup$/, '');
            if (document.getElementById(unit + 'Max')) return;
            var inRow = $(this).closest('tr'), lblRow = inRow.prev('tr');
            if (inRow.length && lblRow.length && /Backup/.test(lblRow.text()) && !inRow.attr('data-ms-max')) {
                inRow.attr('data-ms-max', '1');
                var newLbl = lblRow.clone(), newIn = inRow.clone();
                newLbl.find('*').addBack().contents().each(function () {
                    if (this.nodeType === 3 && /Backup/.test(this.nodeValue)) this.nodeValue = this.nodeValue.replace('Backup', 'Max');
                });
                newLbl.attr('title', MAX_TIP);
                newIn.removeAttr('data-ms-max').find('input').each(function () {
                    var u = this.id.replace(/Backup$/, '');
                    ['onchange', 'oninput', 'onkeyup', 'name'].forEach(function (at) { this.removeAttribute(at); }, this);
                    this.id = u + 'Max'; this.value = max[u] || ''; this.placeholder = '∞'; this.title = MAX_TIP;
                });
                inRow.after(newIn).after(newLbl);
                newIn.find('input').each(function () { bindMax(this, this.id.replace(/Max$/, '')); });
                return;
            }
            /* Fallback: einfach unter das Backup-Feld setzen */
            $(this).after('<br><span title="' + MAX_TIP + '" style="color:#fff;font-weight:bold">Max</span><br>' +
                '<input type="text" id="' + unit + 'Max" size="5" placeholder="∞" value="' + (max[unit] || '') + '">');
            bindMax(document.getElementById(unit + 'Max'), unit);
        });
    }

    function addProfileBar() {
        var slot = $('#msNewUI .ms-barslot'), newUi = slot.length > 0;
        var box = newUi ? slot : $('#massScavengeSophie');
        if (!box.length || $('#msProfileBar').length) return;
        if (!newUi) {
            /* Fallback (altes Fenster): an die Bildschirmhöhe anpassen und scrollbar machen */
            var top = Math.max(0, box[0].getBoundingClientRect().top);
            box.css({ 'max-height': 'calc(100vh - ' + (Math.round(top) + 10) + 'px)', 'overflow-y': 'auto' });
        }
        var p = loadProfiles();
        var opts = Object.keys(p.list).map(function (n) {
            return '<option value="' + esc(n) + '"' + (n === p.active ? ' selected' : '') + '>' + esc(n) + '</option>';
        }).join('');
        var actions = newUi ? '' :
            '<button type="button" class="btn btn-confirm-yes" id="msCalc" title="Laufzeiten berechnen (wie der Button unten im Fenster)">Berechnen</button> ' +
            '<button type="button" class="btn" id="msRunAll" title="Alle Profile nacheinander berechnen, gemeinsame Vorschau">Alle Profile</button> ' +
            '<button type="button" class="btn" id="msOverview" title="Laufende Raubzüge und Restzeiten aller Dörfer anzeigen">Übersicht</button> ' +
            '<button type="button" class="btn" id="msStats" title="Rückkehrzeiten und Beute unterwegs">Statistik</button> ';
        box.prepend(
            '<div id="msProfileBar" style="' + (newUi ? '' : 'padding:6px 90px 6px 6px;background:#f4e4bc;color:#000;line-height:26px;position:sticky;top:0') + '">' +
            '<b>Profil:</b> <select id="msProfileSel">' + opts + '</select> ' +
            '<button type="button" class="btn" id="msProfileNew">Neu</button> ' +
            '<button type="button" class="btn" id="msProfileRen">Umbenennen</button> ' +
            '<button type="button" class="btn" id="msProfileDel">Löschen</button> ' + actions +
            (newUi ? ' &nbsp; ' : '<br>') + '<b>Dorfgruppe:</b> <span id="msGroupWrap">lädt…</span>' +
            ' &nbsp; <label title="Nur das Dorf berechnen, in dem du gerade bist"><input type="checkbox" id="msOnlyCur"' + (onlyCurrent() ? ' checked' : '') + '> nur aktuelles Dorf</label>' +
            '</div>'
        );

        $('#msRunAll').off('click').on('click', runAll);
        $('#msOverview').off('click').on('click', showOverview);
        $('#msStats').off('click').on('click', showStats);
        $('#msCalc').off('click').on('click', function () { if (typeof window.readyToSend === 'function') window.readyToSend(); });
        $('#msOnlyCur').on('change', function () { lsSet('msOnlyCurrent', this.checked ? '1' : '0'); });
        $('#msProfileSel').on('change', function () { switchProfile($(this).val()); });
        $('#msProfileNew').on('click', function () {
            var name = prompt('Name des neuen Profils:');
            if (!name) return;
            var pr = loadProfiles();
            if (pr.list[name]) return UI.ErrorMessage('Profil existiert schon.');
            storeActive(); pr = loadProfiles();
            pr.list[name] = { group: pr.list[pr.active].group, settings: snapshot() };
            pr.active = name; saveProfiles(pr); refreshBar();
        });
        $('#msProfileRen').on('click', function () {
            var pr = loadProfiles(), name = prompt('Neuer Name:', pr.active);
            if (!name || name === pr.active) return;
            if (pr.list[name]) return UI.ErrorMessage('Profil existiert schon.');
            pr.list[name] = pr.list[pr.active]; delete pr.list[pr.active];
            pr.active = name; saveProfiles(pr); refreshBar();
        });
        $('#msProfileDel').on('click', function () {
            var pr = loadProfiles();
            if (Object.keys(pr.list).length < 2) return UI.ErrorMessage('Letztes Profil bleibt.');
            if (!confirm('Profil "' + pr.active + '" löschen?')) return;
            delete pr.list[pr.active];
            var next = Object.keys(pr.list)[0];
            pr.active = next; saveProfiles(pr);
            applySettings(pr.list[next].settings); startOriginal();
        });

        loadGroups(function (groups) {
            var cur = activeGroup(), html;
            if (groups && !groups.some(function (g) { return g.id === cur; })) cur = lsGet('msDefaultGroup');
            if (groups) {
                html = '<select id="msGroupSel">' + groups.map(function (g) {
                    return '<option value="' + esc(g.id) + '"' + (g.id === cur ? ' selected' : '') + '>' + esc(g.name) + '</option>';
                }).join('') + '</select>';
            } else {
                html = '<input id="msGroupSel" size="6" value="' + esc(cur) + '" title="Gruppen-ID (0 = alle)">';
            }
            $('#msGroupWrap').html(html);
            $('#msGroupSel').on('change', function () {
                var pr = loadProfiles();
                pr.list[pr.active].group = String($(this).val() || '0');
                saveProfiles(pr);
                UI.SuccessMessage('Dorfgruppe für Profil "' + pr.active + '" gespeichert.');
            });
        });
    }

    function refreshBar() { $('#msProfileBar').remove(); addProfileBar(); }

    function switchProfile(name) {
        storeActive();
        var p = loadProfiles();
        if (!p.list[name]) return;
        p.active = name; saveProfiles(p);
        applySettings(p.list[name].settings);
        startOriginal(); /* Original neu laden, damit es die Einstellungen des Profils übernimmt */
    }

    /* ---------- Vorschau vor dem Abschicken ---------- */
    var CARRY = { spear: 25, sword: 15, axe: 10, archer: 10, light: 80, marcher: 50, heavy: 50, knight: 100 };
    var UNIT_DE = { spear: 'Speer', sword: 'Schwert', axe: 'Axt', archer: 'Bogen', light: 'LKav', marcher: 'bBogen', heavy: 'SKav', knight: 'Pala' };
    var LOOT_FACTOR = [0, 0.10, 0.25, 0.50, 0.75];

    function fmt(n) { return Math.round(n).toLocaleString('de-DE'); }
    function nowMs() {
        try { if (window.Timing && Timing.getCurrentServerTime) return Timing.getCurrentServerTime(); } catch (e) {}
        return Date.now();
    }
    function fmtTime(ms) {
        var d = new Date(ms), today = new Date(nowMs());
        var t = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
        return d.getDate() === today.getDate() ? 'heute ' + t : (d.getDate() + '.' + (d.getMonth() + 1) + '. ' + t);
    }
    function fmtDur(s) { var h = Math.floor(s / 3600), m = Math.round((s - h * 3600) / 60); return h + ':' + ('0' + m).slice(-2); }
    function optParams(opt) {
        var td = typeof tempData !== 'undefined' && tempData ? tempData : null,
            o = (td && td[opt]) || (massParams[opt]) || (td && td[1]) || massParams[1] || {};
        return {
            lf: o.loot_factor || LOOT_FACTOR[opt],
            exp: o.duration_exponent != null ? o.duration_exponent : (typeof duration_exponent !== 'undefined' ? duration_exponent : null),
            init: o.duration_initial_seconds != null ? o.duration_initial_seconds : (typeof duration_initial_seconds !== 'undefined' ? duration_initial_seconds : 0),
            fac: o.duration_factor != null ? o.duration_factor : (typeof duration_factor !== 'undefined' ? duration_factor : null)
        };
    }
    function captureVillages() {
        var list = (typeof scavengeInfo !== 'undefined' && scavengeInfo) || [];
        list.forEach(function (v) {
            if (!v || v.village_id == null) return;
            var free = null;
            if (v.options) { free = 0; Object.keys(v.options).forEach(function (k) { var o = v.options[k]; if (o && !o.is_locked && !o.scavenging_squad) free++; }); }
            vilMap[v.village_id] = { name: v.village_name || v.name || v.village_id, cf: v.unit_carry_factor || 1, free: free };
        });
    }
    function villageInfo(id) {
        if (vilMap[id]) return vilMap[id];
        var list = (typeof scavengeInfo !== 'undefined' && scavengeInfo) || [], v = null;
        for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].village_id) === String(id)) { v = list[i]; break; }
        return {
            name: v ? (v.village_name || v.name || id) : id,
            cf: v && v.unit_carry_factor ? v.unit_carry_factor : 1
        };
    }

    var MIN_UNITS = 10; /* Spielregel: ein Raubzug braucht mindestens 10 Einheiten */
    function squadSize(r) {
        var uc = (r.candidate_squad && r.candidate_squad.unit_counts) || {}, n = 0;
        Object.keys(uc).forEach(function (u) { n += Math.max(0, parseInt(uc[u], 10) || 0); });
        return n;
    }
    function hasUnits(r) { return squadSize(r) >= MIN_UNITS; }
    function smallNote(n) { return n ? n + ' Züge mit weniger als ' + MIN_UNITS + ' Einheiten entfernt (Truppen bleiben zu Hause).' : ''; }
    function showPreview() {
        try {
            var sq = typeof squads !== 'undefined' ? squads : null, groups = [], empty = {}, small = 0, valid = {};
            captureVillages();
            Object.keys(sq).forEach(function (g) {
                var all = sq[g] || [], reqs = all.filter(hasUnits);
                all.forEach(function (r) { var n = squadSize(r); empty[r.village_id] = 1; if (n > 0 && n < MIN_UNITS) small++; });
                reqs.forEach(function (r) { valid[r.village_id] = 1; });
                sq[g] = reqs; /* auch die Buttons des Originals schicken dann nur gültige Züge */
                if (reqs.length) groups.push({ label: 'Gruppe ' + (+g + 1), reqs: reqs, orig: +g });
            });
            Object.keys(valid).forEach(function (v) { delete empty[v]; });
            buildPreview(groups, empty, smallNote(small));
        } catch (e) { box('<b>Vorschau-Fehler:</b> ' + esc(e.message) + '<br><small>' + esc(dbg()) + '</small>'); }
    }
    function dbg() {
        try { return 'squads=' + JSON.stringify(typeof squads !== 'undefined' ? squads : 'undefiniert').slice(0, 300); } catch (e) { return 'squads: ' + e.message; }
    }
    function img(path, t) {
        var base = (typeof image_base !== 'undefined' && image_base) ? image_base : '/graphic/';
        return '<img src="' + base + path + '" title="' + (t || '') + '" style="width:16px;height:16px;vertical-align:-3px">';
    }
    function unitIcon(u) { return img('unit/unit_' + u + '.png', UNIT_DE[u] || u); }
    var RES_ICONS = function () { return img('holz.png', 'Holz') + img('lehm.png', 'Lehm') + img('eisen.png', 'Eisen'); };

    function injectStyle() {
        if (document.getElementById('msPreviewStyle')) return;
        var st = document.createElement('style');
        st.id = 'msPreviewStyle';
        st.textContent =
            '#msPreviewBox{position:fixed;top:40px;left:0;right:0;margin:auto;width:fit-content;max-width:95vw;z-index:2147483647;' +
            'background:#f4e4bc;color:#000;border:2px solid #804000;border-radius:4px;box-shadow:0 6px 24px rgba(0,0,0,.5);font:12px Verdana,Arial,sans-serif}' +
            '#msPreviewBox .ms-head{background:linear-gradient(#c1a264,#a4884d);color:#000;padding:6px 10px;font-weight:bold;font-size:14px;border-bottom:1px solid #804000;display:flex;justify-content:space-between;align-items:center;gap:12px}' +
            '#msPreviewBox .ms-body{padding:10px;max-height:70vh;overflow:auto}' +
            '#msPreviewBox .ms-tiles{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}' +
            '#msPreviewBox .ms-tile{background:#fff5da;border:1px solid #c1a264;border-radius:3px;padding:6px 10px;min-width:110px}' +
            '#msPreviewBox .ms-tile small{display:block;color:#6b4a1a;font-size:10px;text-transform:uppercase;letter-spacing:.5px}' +
            '#msPreviewBox .ms-tile b{font-size:14px}' +
            '#msPreviewBox .ms-note{background:#fff5da;border-left:3px solid #804000;padding:4px 8px;margin-bottom:8px}' +
            '#msPreviewBox table.ms-tab{border-collapse:collapse;width:100%;font-size:12px}' +
            '#msPreviewBox table.ms-tab th{background:#c1a264;padding:4px 6px;text-align:left;border:1px solid #a4884d;white-space:nowrap}' +
            '#msPreviewBox table.ms-tab td{padding:3px 6px;border:1px solid #dcc79a;vertical-align:middle}' +
            '#msPreviewBox table.ms-tab tr.v0 td{background:#fff5da}#msPreviewBox table.ms-tab tr.v1 td{background:#f0e2be}' +
            '#msPreviewBox .ms-st{display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;background:#804000;color:#fff;font-weight:bold;font-size:11px}' +
            '#msPreviewBox .ms-u{white-space:nowrap;margin-right:8px}' +
            '#msPreviewBox .ms-run{color:#a05000;font-size:10px}' +
            '#msPreviewBox .ms-foot{padding:8px 10px;border-top:1px solid #c1a264;background:#ecd9a8;display:flex;flex-wrap:wrap;gap:6px;align-items:center}' +
            '#msPreviewBox .r{text-align:right;white-space:nowrap}' +
            '#msPreviewBox table.ms-tab th{background:#c1a264!important;color:#000!important;background-image:none!important}' +
            '@media (max-width:760px){' +
            '#msPreviewBox{top:0;width:100vw;max-width:100vw;border-radius:0;border-left:0;border-right:0}' +
            '#msPreviewBox .ms-body{overflow-x:auto;padding:8px}' +
            '#msPreviewBox .ms-tile{min-width:0;flex:1 1 28%}' +
            '#msPreviewBox .ms-foot{flex-wrap:wrap}' +
            '}';
        document.head.appendChild(st);
    }
    function box(html, title, foot) {
        injectStyle();
        var old = document.getElementById('msPreviewBox');
        if (old) old.parentNode.removeChild(old);
        var d = document.createElement('div');
        d.id = 'msPreviewBox';
        d.innerHTML = '<div class="ms-head"><span>' + (title || 'Raubzug-Vorschau') + '</span><button type="button" class="btn ms-close">✕</button></div>' +
            '<div class="ms-body">' + html + '</div>' + (foot ? '<div class="ms-foot">' + foot + '</div>' : '');
        d.querySelector('.ms-close').onclick = function () { d.parentNode.removeChild(d); };
        document.body.appendChild(d);
        d.style.overflowY = 'auto'; fitHeight(d);
    }
    function closeAll() {
        ['msPreviewBox', 'massScavengeFinal', 'massScavengeSophie', 'msNewUI'].forEach(function (id) {
            var e = document.getElementById(id); if (e) e.parentNode.removeChild(e);
        });
    }
    function vNames(ids) {
        var n = ids.map(function (v) { return esc(String(villageInfo(v).name).replace(/\s*\(.*$/, '')); });
        return n.length > 8 ? n.slice(0, 8).join(', ') + ' … (+' + (n.length - 8) + ')' : n.join(', ');
    }
    /* Hinweise: warum Dörfer gekürzt, übersprungen oder ohne Züge sind */
    function runNotes(inPlan, idle) {
        var cap = [], skip = [], busy = [], noTroops = [];
        Object.keys(runInfo).forEach(function (v) {
            if (runInfo[v].skip) skip.push(v);
            else if (runInfo[v].capped && inPlan[v]) cap.push(v);
        });
        Object.keys(idle || {}).forEach(function (v) {
            if (runInfo[v] && runInfo[v].skip) return;
            (villageInfo(v).free === 0 ? busy : noTroops).push(v);
        });
        return (cap.length ? '<div>⏱ Laufzeit gekürzt, damit die neuen Züge mit dem laufenden Raubzug zurückkommen: ' + vNames(cap) + '</div>' : '') +
               (skip.length ? '<div>⏱ Übersprungen, laufender Raubzug kommt zu bald zurück: ' + vNames(skip) + '</div>' : '') +
               (busy.length ? '<div>Nichts zu senden, alle Stufen laufen noch: ' + vNames(busy) + '</div>' : '') +
               (noTroops.length ? '<div>Nichts zu senden, zu wenig Truppen (Reserve/Max, mind. ' + MIN_UNITS + ' Einheiten): ' + vNames(noTroops) + '</div>' : '');
    }
    function buildPreview(groups, empty, note) {
        var byVillage = {}, order = [], prof = {};
        groups.forEach(function (gr) {
            gr.reqs.forEach(function (r) {
                if (!byVillage[r.village_id]) { byVillage[r.village_id] = []; order.push(r.village_id); prof[r.village_id] = gr.profile; }
                byVillage[r.village_id].push(r);
            });
        });
        var notes = (note ? '<div>' + note + '</div>' : '') +
            (onlyCurrent() ? '<div>📍 Nur aktuelles Dorf: ' + esc((game_data.village && game_data.village.name) || '') + '</div>' : '') +
            runNotes(byVillage, empty);
        if (!order.length) return box((notes ? '<div class="ms-note">' + notes + '</div>' : '') +
            '<b>Nichts zu verschicken.</b> Reserve/Max prüfen oder alle Stufen belegt.<br><small>' + esc(dbg()) + '</small>');
        lastPreview = [groups, empty, note];
        sendList = groups; sentCount = groups.filter(function (g) { return g.sent; }).length;
        var now = nowMs(), totLoot = 0, lastRet = 0, stageLoot = [0, 0, 0, 0, 0], units = {}, rows = '';
        order.forEach(function (vid, vi_idx) {
            var vi = villageInfo(vid), reqs = byVillage[vid], ri = runInfo[vid];
            reqs.sort(function (a, b) { return a.option_id - b.option_id; });
            reqs.forEach(function (r, idx) {
                var uc = (r.candidate_squad && r.candidate_squad.unit_counts) || {}, cap = 0, txt = [];
                Object.keys(uc).forEach(function (u) {
                    var n = parseInt(uc[u], 10) || 0;
                    if (n > 0) {
                        cap += n * (CARRY[u] || 0);
                        txt.push('<span class="ms-u">' + unitIcon(u) + ' ' + fmt(n) + '</span>');
                        units[u] = (units[u] || 0) + n;
                    }
                });
                cap *= vi.cf;
                var p = optParams(r.option_id), loot = cap * p.lf, dur = null, ret = '?';
                if (p.exp != null && p.fac != null) {
                    dur = (Math.pow(Math.pow(loot, 2) * 100, p.exp) + (p.init || 0)) * p.fac;
                    ret = fmtTime(now + dur * 1000);
                    lastRet = Math.max(lastRet, now + dur * 1000);
                }
                totLoot += loot; stageLoot[r.option_id] += loot;
                rows += '<tr class="v' + (vi_idx & 1) + '">' +
                    (idx === 0 ? '<td rowspan="' + reqs.length + '"><a href="' + game_data.link_base_pure + 'info_village&id=' + vid + '" target="_blank"><b>' + esc(vi.name) + '</b></a>' +
                        (prof[vid] ? '<br><small>' + esc(prof[vid]) + '</small>' : '') +
                        (ri && ri.capped ? '<br><span class="ms-run">⏱ läuft bis ' + fmtTime(ri.until * 1000) + '</span>' : '') + '</td>' : '') +
                    '<td style="text-align:center"><span class="ms-st">' + r.option_id + '</span></td>' +
                    '<td>' + (txt.join('') || '–') + '</td>' +
                    '<td class="r">' + (dur != null ? fmtDur(dur) : '?') + '</td>' +
                    '<td class="r">' + ret + '</td>' +
                    '<td class="r">' + fmt(loot) + '</td></tr>';
            });
        });
        var unitSum = Object.keys(units).map(function (u) { return '<span class="ms-u">' + unitIcon(u) + ' ' + fmt(units[u]) + '</span>'; }).join('');
        var stageSum = [1, 2, 3, 4].filter(function (k) { return stageLoot[k] > 0; })
            .map(function (k) { return '<span class="ms-u"><span class="ms-st">' + k + '</span> ' + fmt(stageLoot[k]) + '</span>'; }).join('');
        var html =
            (notes ? '<div class="ms-note">' + notes + '</div>' : '') +
            '<div class="ms-tiles">' +
            '<div class="ms-tile"><small>Dörfer</small><b>' + order.length + '</b></div>' +
            '<div class="ms-tile"><small>Beute gesamt (ca.)</small><b>' + fmt(totLoot) + '</b><br>' + RES_ICONS() + ' je ~' + fmt(totLoot / 3) + '</div>' +
            '<div class="ms-tile"><small>Letzte Rückkehr</small><b>' + (lastRet ? fmtTime(lastRet) : '?') + '</b></div>' +
            '<div class="ms-tile"><small>Beute je Stufe</small>' + stageSum + '</div>' +
            '<div class="ms-tile"><small>Truppen</small>' + unitSum + '</div>' +
            '</div>' +
            '<table class="ms-tab"><tr><th>Dorf</th><th>Stufe</th><th>Truppen</th><th class="r">Dauer</th><th class="r">Zurück</th><th class="r">Beute</th></tr>' +
            rows + '</table>';
        var foot = groups.map(function (gr, i) {
            return gr.sent ? '<input type="button" class="btn" disabled value="' + esc(gr.label) + ': Gesendet ✓">'
                : '<input type="button" class="btn btn-confirm-yes" value="' + esc(gr.label) + ' abschicken" onclick="msSend(' + i + ',this)">';
        }).join('') + '<small style="margin-left:auto">Schätzwerte · Zeiten ab jetzt</small>';
        box(html, 'Raubzug-Vorschau', foot);
    }

    var sentCount = 0, lastPreview = null;
    function groupDone(gr, btn, ok) {
        btn.value = ok ? 'Gesendet ✓' : 'Fehler';
        if (!ok) return;
        gr.sent = true;
        sentCount++;
        if (sentCount >= sendList.length) {
            lastPreview = null;
            setTimeout(function () { closeAll(); UI.SuccessMessage('Raubzüge abgeschickt.'); }, 700);
        }
    }
    /* Mindestens 200 ms zwischen zwei Sende-Anfragen (höchstens 5 pro Sekunde, wie im Original) */
    var SEND_GAP = 210, lastSend = 0, sendQueue = Promise.resolve();
    function throttled(fn) {
        sendQueue = sendQueue.then(function () {
            return new Promise(function (res) {
                var wait = Math.max(0, lastSend + SEND_GAP - Date.now());
                setTimeout(function () { lastSend = Date.now(); try { fn(); } finally { res(); } }, wait);
            });
        });
    }
    window.msSend = function (i, btn) {
        var gr = sendList[i];
        if (!gr || btn.disabled) return;
        btn.disabled = true;
        btn.value = 'Sende…';
        throttled(function () { doSend(gr, btn); });
    };
    function doSend(gr, btn) {
        if (gr.orig != null && typeof sendGroup === 'function') { sendGroup(gr.orig, false); return groupDone(gr, btn, true); }
        btn.value = 'Sende…';
        TribalWars.post('scavenge_api', { ajaxaction: 'send_squads' }, { squad_requests: gr.reqs },
            function () { groupDone(gr, btn, true); }, function () { groupDone(gr, btn, false); });
    }

    /* ---------- Alle Profile nacheinander berechnen ---------- */
    function waitFinal(cb) {
        var t0 = Date.now();
        (function poll() {
            if ($('#massScavengeFinal').length) return setTimeout(function () { cb(true); }, 400);
            if (Date.now() - t0 > 30000) return cb(false);
            setTimeout(poll, 250);
        })();
    }
    function runAll() {
        if (batching) return;
        storeActive();
        var p = loadProfiles(), names = Object.keys(p.list), i = 0, groups = [], seen = {}, dup = 0, empty = {}, small = 0, failed = [], usedGroups = {}, sameGroup = [];
        /* Profile mit der Standardgruppe "alle" immer zuletzt, damit die spezielleren Gruppen zuerst ihre Dörfer bekommen */
        var defG = lsGet('msDefaultGroup') || '0';
        names = names.filter(function (n) { return resolveGroup(p.list[n].group) !== defG; })
            .concat(names.filter(function (n) { return resolveGroup(p.list[n].group) === defG; }));
        batching = true; runInfo = {};
        function next() {
            if (i >= names.length) return finish();
            var name = names[i++], pr = p.list[name];
            batchGroup = resolveGroup(pr.group);
            /* Gleiche Dorfgruppe wie ein früheres Profil -> alle Dörfer wären schon verplant, Profil überspringen */
            if (usedGroups[batchGroup]) { sameGroup.push(name + ' (wie ' + usedGroups[batchGroup] + ')'); return next(); }
            usedGroups[batchGroup] = name;
            box('Berechne Profil „' + esc(name) + '“ (' + i + '/' + names.length + ') …');
            applySettings(pr.settings);
            $('#massScavengeFinal').remove();
            $.getScript(SCRIPT_URL, function () {
                if (!installHooks()) { failed.push(name); return next(); }
                try { readyToSend(); } catch (e) { failed.push(name); return next(); }
                waitFinal(function (ok) {
                    if (!ok) { failed.push(name); return next(); }
                    captureVillages();
                    var sq = JSON.parse(JSON.stringify(typeof squads !== 'undefined' && squads ? squads : {})), reqs = [];
                    Object.keys(sq).forEach(function (g) {
                        (sq[g] || []).forEach(function (r) {
                            var n = squadSize(r);
                            if (!(r.village_id in seen)) empty[r.village_id] = 1;
                            if (n === 0) return;
                            if (n < MIN_UNITS) { small++; return; }
                            if (seen[r.village_id] && seen[r.village_id] !== name) { dup++; return; }
                            seen[r.village_id] = name;
                            r.use_premium = false;
                            reqs.push(r);
                        });
                    });
                    /* in Pakete zu je 50 Dörfern aufteilen */
                    var chunks = [], cur = [], vils = {};
                    reqs.forEach(function (r) {
                        if (!vils[r.village_id] && Object.keys(vils).length >= 50) { chunks.push(cur); cur = []; vils = {}; }
                        vils[r.village_id] = 1; cur.push(r);
                    });
                    if (cur.length) chunks.push(cur);
                    chunks.forEach(function (c, k) {
                        groups.push({ label: name + (chunks.length > 1 ? ' (Teil ' + (k + 1) + ')' : ''), reqs: c, profile: name });
                    });
                    next();
                });
            });
        }
        function finish() {
            batching = false; batchGroup = null;
            var a = loadProfiles();
            applySettings(a.list[a.active].settings);
            $('#massScavengeFinal').remove();
            startOriginal();
            var note = '<b>Alle Profile:</b> ' + (names.length - sameGroup.length - failed.length) + ' berechnet' +
                (dup ? ' · ' + dup + ' Züge übersprungen (Dorf schon in früherem Profil)' : '') +
                (sameGroup.length ? '<br>Übersprungen, gleiche Dorfgruppe: ' + esc(sameGroup.join(', ')) : '') +
                (failed.length ? ' · <span style="color:#a00">fehlgeschlagen: ' + esc(failed.join(', ')) + '</span>' : '') +
                (small ? '<br>' + smallNote(small) : '');
            Object.keys(seen).forEach(function (v) { delete empty[v]; });
            try { buildPreview(groups, empty, note); } catch (e) { box('<b>Vorschau-Fehler:</b> ' + esc(e.message)); }
        }
        next();
    }

    /* ================= Übersicht & Statistik =================
       Beide laden die Massen-Raubzug-Seiten (nacheinander, mind. 200 ms Abstand) und zeigen nur an.
       Es wird nichts verändert oder gesendet. */
    function extractVillages(html) {
        var i = html.indexOf('[{"village_id"');
        if (i < 0) return [];
        var depth = 0, inStr = false, esc2 = false;
        for (var j = i; j < html.length; j++) {
            var c = html[j];
            if (inStr) { if (esc2) esc2 = false; else if (c === '\\') esc2 = true; else if (c === '"') inStr = false; continue; }
            if (c === '"') inStr = true;
            else if (c === '[' || c === '{') depth++;
            else if (c === ']' || c === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(i, j + 1)); } catch (e) { return []; } } }
        }
        return [];
    }
    function pageCount(html) {
        var max = 0, re = /mode=scavenge_mass[^"']*?[?&]page=(\d+)/g, m;
        while ((m = re.exec(html))) max = Math.max(max, +m[1]);
        return max + 1;
    }
    /* Stufen-Parameter (Beutefaktor, Dauer-Formel) direkt aus der Seite lesen – vor dem ersten Berechnen fehlen sie sonst */
    var massParams = {};
    function extractParams(html) {
        var re = /\{[^{}]*"duration_exponent"[^{}]*\}/g, m, i = 0;
        while ((m = re.exec(html)) && i < 8) {
            try {
                var o = JSON.parse(m[0]), k = +(o.id || o.option_id || 0) || (++i);
                if (o.id || o.option_id) i++;
                if (k >= 1 && k <= 4) massParams[k] = o;
            } catch (e) {}
        }
    }
    function loadMassData(title, render) {
        box('Lade Raubzüge …', title);
        var base = 'game.php?screen=place&mode=scavenge_mass', all = [], pages = 1, p = 0, last = 0;
        if (game_data.player && game_data.player.sitter > 0) base = 'game.php?t=' + game_data.player.id + '&screen=place&mode=scavenge_mass';
        (function next() {
            if (p >= pages) {
                if (onlyCurrent()) all = all.filter(function (v) { return String(v.village_id) === String(game_data.village && game_data.village.id); });
                if (!all.length) return box('Keine Dörfer gefunden.', title);
                return render(all);
            }
            var wait = Math.max(0, last + 210 - Date.now());
            setTimeout(function () {
                last = Date.now();
                $.get(base + '&page=' + p).done(function (html) {
                    if (p === 0) { pages = Math.min(pageCount(html), 50); extractParams(html); }
                    all = all.concat(extractVillages(html));
                    p++; next();
                }).fail(function () { box('<b>Daten konnten nicht geladen werden.</b>', title); });
            }, wait);
        })();
    }
    function isSmall() { return window.innerWidth <= 760; }
    function fmtDate(ms, short) {
        var d = new Date(ms), p2 = function (n) { return ('0' + n).slice(-2); };
        return short ? p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '. ' + p2(d.getHours()) + ':' + p2(d.getMinutes())
                     : p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    }
    function vName(v, short) {
        var n = String(v.village_name || v.village_id);
        return short ? n.replace(/\s*K\d+\s*$/, '') : n;
    }
    function vLink(v, short) {
        return '<a href="' + game_data.link_base_pure + 'info_village&id=' + v.village_id + '" target="_blank"><b>' + esc(vName(v, short)) + '</b></a>';
    }
    function lastReturn(v) {
        var t = 0;
        [1, 2, 3, 4].forEach(function (k) { var o = v.options && v.options[k]; if (o && !o.is_locked && o.scavenging_squad) t = Math.max(t, +(o.scavenging_squad.return_time || 0)); });
        return t;
    }
    var RED = 'background:#d32f2f;color:#fff;font-weight:bold', GREEN = 'background:#2e7d32;color:#fff;font-weight:bold';
    function markFirstLast(sel) {
        var cells = $(sel), ts = cells.map(function () { return +this.getAttribute('data-last'); }).get().filter(function (t) { return t > 0; });
        if (ts.length < 2) return;
        var mn = Math.min.apply(null, ts), mx = Math.max.apply(null, ts);
        cells.each(function () {
            var t = +this.getAttribute('data-last');
            if (t === mn) this.setAttribute('style', GREEN); else if (t === mx) this.setAttribute('style', RED);
        });
    }
    function injectOvStyle() {
        if (document.getElementById('msOvStyle')) return;
        var st = document.createElement('style');
        st.id = 'msOvStyle';
        st.textContent =
            '#msPreviewBox td.ms-last{white-space:nowrap}' +
            '@media (max-width:760px){' +
            '#msPreviewBox table.ms-tab{font-size:11px}' +
            '#msPreviewBox table.ms-tab th,#msPreviewBox table.ms-tab td{padding:3px 4px}' +
            '#msPreviewBox .ms-sn{display:none}' +
            '#msPreviewBox .ms-tile{padding:4px 8px}#msPreviewBox .ms-tile b{font-size:13px}' +
            '#msPreviewBox td a b{display:inline-block;max-width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}' +
            '}';
        document.head.appendChild(st);
    }

    /* ---------- Übersicht: schlicht ---------- */
    var ovTimer = null;
    function showOverview() { loadMassData('Raubzug-Übersicht', renderOverview); }
    function renderOverview(list) {
        injectOvStyle();
        var sm = isSmall(), free = 0, running = 0;
        var rows = list.map(function (v, idx) {
            var lr = lastReturn(v);
            var cells = [1, 2, 3, 4].map(function (k) {
                var o = v.options && v.options[k];
                if (!o || o.is_locked) return '<td class="r" style="color:#8a7550">🔒</td>';
                var sq = o.scavenging_squad;
                if (!sq) { free++; return '<td class="r" style="color:#2e7d32;font-weight:bold">frei</td>'; }
                running++;
                var rt = +(sq.return_time || 0);
                return rt ? '<td class="r ms-cd" data-rt="' + rt + '" title="zurück ' + fmtDate(rt * 1000) + '"></td>' : '<td class="r">läuft</td>';
            }).join('');
            return '<tr class="v' + (idx & 1) + '"><td>' + vLink(v, sm) + '</td>' +
                '<td class="r ms-last" data-last="' + lr + '">' + (lr ? fmtDate(lr * 1000, sm) : '–') + '</td>' + cells + '</tr>';
        }).join('');
        var html =
            '<div class="ms-tiles"><div class="ms-tile"><small>Dörfer</small><b>' + list.length + '</b></div>' +
            '<div class="ms-tile"><small>Laufend</small><b>' + running + '</b></div>' +
            '<div class="ms-tile"><small>Frei</small><b style="color:#2e7d32">' + free + '</b></div></div>' +
            '<table class="ms-tab"><tr><th>Dorf</th><th class="r">Letzte Rückkehr</th>' +
            [1, 2, 3, 4].map(function (k) { return '<th class="r"><span class="ms-st">' + k + '</span><span class="ms-sn"> ' + STAGE_NAMES[k] + '</span></th>'; }).join('') +
            '</tr>' + rows + '</table>';
        box(html, 'Raubzug-Übersicht', '<small>Restzeit läuft live mit · 🔒 nicht freigeschaltet · <span style="' + GREEN + ';padding:0 4px">zuerst zurück</span> <span style="' + RED + ';padding:0 4px">zuletzt zurück</span></small>');
        markFirstLast('#msPreviewBox td.ms-last');
        function tick() {
            var cds = document.querySelectorAll('#msPreviewBox .ms-cd');
            if (!cds.length) { clearInterval(ovTimer); ovTimer = null; return; }
            var now = nowMs() / 1000;
            for (var i = 0; i < cds.length; i++) {
                var left = +cds[i].getAttribute('data-rt') - now;
                if (left <= 0) { cds[i].textContent = 'zurück'; cds[i].style.color = '#2e7d32'; cds[i].style.fontWeight = 'bold'; }
                else { var h = Math.floor(left / 3600), m = Math.floor((left - h * 3600) / 60), sec = Math.floor(left - h * 3600 - m * 60);
                       cds[i].textContent = h + ':' + ('0' + m).slice(-2) + ':' + ('0' + sec).slice(-2); }
            }
        }
        if (ovTimer) clearInterval(ovTimer);
        tick(); ovTimer = setInterval(tick, 1000);
    }

    /* ---------- Statistik: Rückkehr & Beute ---------- */
    function showStats() { loadMassData('Raubzug-Statistik', renderStats); }
    function squadLoot(sq, k, cf) {
        var lr = sq.loot_res || sq.loot;
        if (lr && typeof lr === 'object') return { wood: +lr.wood || 0, stone: +lr.stone || 0, iron: +lr.iron || 0, est: false };
        var cap = +sq.carry_max && +sq.carry_max < 1e9 ? +sq.carry_max : 0;
        if (!cap && sq.unit_counts) Object.keys(sq.unit_counts).forEach(function (u) { cap += (+sq.unit_counts[u] || 0) * (CARRY[u] || 0); });
        if (!cap) return null;
        var t = cap * (cf || 1) * optParams(k).lf / 3;
        return { wood: t, stone: t, iron: t, est: true };
    }
    function squadDur(L, k, sq) {
        var st = sq && +(sq.created_at || sq.start_time || 0), rt = sq && +(sq.return_time || 0);
        if (st && rt > st) return rt - st;
        var pr = optParams(k);
        if (pr.exp == null || pr.fac == null || !L) return 0;
        return (Math.pow(Math.pow(L, 2) * 100, pr.exp) + (pr.init || 0)) * pr.fac;
    }
    function unitSum(obj) { var n = 0; Object.keys(obj || {}).forEach(function (u) { if (u !== 'militia') n += +obj[u] || 0; }); return n; }
    function renderStats(list) {
        injectOvStyle();
        var sm = isSmall(), now = nowMs() / 1000;
        var T = { wood: 0, stone: 0, iron: 0, rate: 0, running: 0, unlocked: 0, out: 0, home: 0, outKnown: true, est: false },
            stageTot = [0, 0, 0, 0, 0], first = null, lastV = null, next = null, idle = [];
        var data = list.map(function (v) {
            var d = { v: v, lr: lastReturn(v), n: 0, unl: 0, wood: 0, stone: 0, iron: 0, rate: 0, out: 0, home: unitSum(v.unit_counts_home), free: 0 };
            [1, 2, 3, 4].forEach(function (k) {
                var o = v.options && v.options[k];
                if (!o || o.is_locked) return;
                d.unl++;
                var sq = o.scavenging_squad;
                if (!sq) { d.free++; return; }
                d.n++;
                var rt = +(sq.return_time || 0);
                if (rt && (!next || rt < next.t)) next = { t: rt, v: v, k: k };
                var uc = sq.unit_counts || (sq.candidate_squad && sq.candidate_squad.unit_counts);
                if (uc) d.out += unitSum(uc); else T.outKnown = false;
                var l = squadLoot(sq, k, v.unit_carry_factor);
                if (!l) return;
                if (l.est) T.est = true;
                var L = l.wood + l.stone + l.iron, dur = squadDur(L, k, sq);
                d.wood += l.wood; d.stone += l.stone; d.iron += l.iron;
                if (dur > 0) d.rate += L / dur * 3600;
                stageTot[k] += L;
            });
            d.sum = d.wood + d.stone + d.iron;
            d.util = d.unl ? d.n / d.unl : 0;
            d.perUnit = d.out ? d.rate / d.out : 0;
            d.idle = d.free > 0 && d.home >= MIN_UNITS;
            if (d.idle) idle.push(d);
            T.wood += d.wood; T.stone += d.stone; T.iron += d.iron; T.rate += d.rate;
            T.running += d.n; T.unlocked += d.unl; T.out += d.out; T.home += d.home;
            if (d.lr) {
                if (!first || d.lr < first.t) first = { t: d.lr, v: v };
                if (!lastV || d.lr > lastV.t) lastV = { t: d.lr, v: v };
            }
            return d;
        });
        data.sort(function (a, b) { return b.rate - a.rate; }); /* Rangliste nach Beute pro Stunde */
        var pct = function (x) { return Math.round(x * 100) + ' ' + '%'; };
        var ca = T.est ? ' (ca.)' : '';
        var rows = data.map(function (d, idx) {
            var utilCol = d.util >= 1 ? '#2e7d32' : d.util >= 0.5 ? '#9a6b00' : '#d32f2f';
            return '<tr class="v' + (idx & 1) + '"' + (d.idle ? ' style="outline:2px solid #e6a100;outline-offset:-2px"' : '') + '>' +
                '<td class="r">' + (idx + 1) + '</td>' +
                '<td>' + vLink(d.v, sm) + (d.idle ? ' <span title="Freie Stufe und Truppen zu Hause">⚠️</span>' : '') + '</td>' +
                (sm ? '' : '<td class="r">' + d.n + '/' + d.unl + '</td>') +
                '<td class="r" style="color:' + utilCol + ';font-weight:bold">' + pct(d.util) + '</td>' +
                '<td class="r ms-last" data-last="' + d.lr + '">' + (d.lr ? fmtDate(d.lr * 1000, sm) : '–') + '</td>' +
                (sm ? '' : '<td class="r">' + fmt(d.sum) + '</td>') +
                '<td class="r"><b>' + (d.rate ? fmt(d.rate) : '–') + '</b></td>' +
                (sm ? '' : '<td class="r">' + (d.perUnit ? d.perUnit.toFixed(1).replace('.', ',') : '–') + '</td>' +
                           '<td class="r">' + fmt(d.home) + '</td>') +
                '</tr>';
        }).join('');
        var totAll = T.wood + T.stone + T.iron;
        var outPct = T.outKnown && (T.out + T.home) ? pct(T.out / (T.out + T.home)) : '–';
        var tile = function (label, val, sub, style) {
            return '<div class="ms-tile"' + (style ? ' style="' + style + '"' : '') + '><small>' + label + '</small><b>' + val + '</b>' + (sub ? '<br>' + sub : '') + '</div>';
        };
        var html =
            '<div class="ms-tiles">' +
            tile('Beute pro Stunde' + ca, fmt(T.rate), 'Hochrechnung 24 h: ' + fmt(T.rate * 24)) +
            tile('Beute unterwegs' + ca, fmt(totAll), img('holz.png', 'Holz') + ' ' + fmt(T.wood) + ' ' + img('lehm.png', 'Lehm') + ' ' + fmt(T.stone) + ' ' + img('eisen.png', 'Eisen') + ' ' + fmt(T.iron)) +
            tile('Auslastung Stufen', T.unlocked ? pct(T.running / T.unlocked) : '–', T.running + ' von ' + T.unlocked + ' belegt') +
            tile('Truppen unterwegs', outPct, T.outKnown ? fmt(T.out) + ' unterwegs · ' + fmt(T.home) + ' zu Hause' : fmt(T.home) + ' zu Hause') +
            tile('Leerlauf', idle.length ? idle.length + (idle.length === 1 ? ' Dorf' : ' Dörfer') : 'keiner', idle.length ? 'freie Stufe + Truppen zu Hause' : 'alles ausgelastet',
                 idle.length ? 'border-color:#e6a100;background:#fff3cd' : 'border-color:#2e7d32') +
            (next ? tile('Nächste freie Stufe', fmtDate(next.t * 1000, true), esc(vName(next.v, true)) + ' · Stufe ' + next.k) : '') +
            (first ? tile('Erste Rückkehr', '<span style="color:#2e7d32">' + fmtDate(first.t * 1000, sm) + '</span>', esc(vName(first.v, sm)), 'border-color:#2e7d32') : '') +
            (lastV ? tile('Letzte Rückkehr', '<span style="color:#d32f2f">' + fmtDate(lastV.t * 1000, sm) + '</span>', esc(vName(lastV.v, sm)), 'border-color:#d32f2f') : '') +
            tile('Beute je Stufe' + ca, '', [1, 2, 3, 4].map(function (k) { return '<span class="ms-u"><span class="ms-st">' + k + '</span> ' + fmt(stageTot[k]) + '</span>'; }).join('')) +
            '</div>' +
            '<table class="ms-tab"><tr><th class="r">#</th><th>Dorf</th>' + (sm ? '' : '<th class="r">Züge</th>') +
            '<th class="r">Auslastung</th><th class="r">Letzte Rückkehr</th>' + (sm ? '' : '<th class="r">Beute' + ca + '</th>') +
            '<th class="r">Beute/h</th>' + (sm ? '' : '<th class="r" title="Beute pro Stunde je Einheit unterwegs">pro Einheit/h</th><th class="r">Truppen zu Hause</th>') +
            '</tr>' + rows + '</table>';
        box(html, 'Raubzug-Statistik',
            '<small>Sortiert nach Beute/h · ⚠️ = freie Stufe und Truppen zu Hause · ' +
            '<span style="' + GREEN + ';padding:0 4px">zuerst zurück</span> <span style="' + RED + ';padding:0 4px">zuletzt zurück</span>' +
            (T.est ? ' · Beute geschätzt aus Tragkapazität' : '') + '</small>');
        markFirstLast('#msPreviewBox td.ms-last');
    }

    function addPreviewButton() {
        var fin = $('#massScavengeFinal');
        if (!fin.length || fin.attr('data-ms')) return;
        /* Das Launch-Fenster des Originals wird nicht mehr gebraucht - die Vorschau ersetzt es */
        fin.attr('data-ms', '1').css('display', 'none');
        if (!batching) setTimeout(showPreview, 0);
    }

    /* ================= Neues Einstellungsfenster =================
       Das Original bleibt unsichtbar im Hintergrund. Alle Eingaben werden in dessen
       Felder geschrieben, gerechnet wird weiter mit readyToSend() des Originals. */
    var STAGE_NAMES = ['', 'Faule Sammler', 'Bescheidene', 'Kluge Sammler', 'Großartige'];
    function origOk() {
        return $('#imgRow').length && $('#category1').length && $('#timeSelectorHours').length &&
               $('.runTime_off').length && $('.runTime_def').length && $('#settingPriorityBalanced').length &&
               typeof window.readyToSend === 'function';
    }
    function fire(el, ev) { if (el) el.dispatchEvent(new Event(ev || 'input', { bubbles: true })); }
    function origUnits() { return $('#imgRow :checkbox').map(function () { return this.name; }).get(); }
    function unitCol(u) { var cb = $('#imgRow :checkbox[name="' + u + '"]'); var c = cb.closest('#imgRow > *'); return c.length ? c : cb.parent(); }

    function injectUiStyle() {
        if (document.getElementById('msUiStyle')) return;
        var st = document.createElement('style');
        st.id = 'msUiStyle';
        st.textContent =
            '#msNewUI{position:fixed;top:30px;left:0;right:0;margin:auto;width:820px;max-width:96vw;max-height:calc(100vh - 40px);overflow:auto;z-index:12000;' +
            'background:#f4e4bc;color:#000;border:2px solid #804000;border-radius:4px;box-shadow:0 6px 24px rgba(0,0,0,.45);font:12px Verdana,Arial,sans-serif}' +
            '#msNewUI .ms-h{background:linear-gradient(#c1a264,#a4884d);padding:7px 10px;font-weight:bold;font-size:14px;border-bottom:1px solid #804000;display:flex;align-items:center;gap:8px;cursor:move;position:sticky;top:0;z-index:2}' +
            '#msNewUI .ms-h .sp{flex:1}#msNewUI .ms-h small{font-weight:normal;font-size:11px;color:#5a3c10}' +
            '#msNewUI .ms-barslot{padding:8px 10px;background:#ecd9a8;border-bottom:1px solid #c1a264;line-height:26px}' +
            '#msNewUI .ms-grid{display:grid;grid-template-columns:1.15fr 1fr;gap:10px;padding:10px}' +
            '#msNewUI .ms-col{display:flex;flex-direction:column;gap:10px}' +
            '#msNewUI .ms-card{background:#fff5da;border:1px solid #c1a264;border-radius:3px}' +
            '#msNewUI .ms-card h4{margin:0;padding:5px 8px;background:#e3cf9b;border-bottom:1px solid #c1a264;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#5a3c10;display:flex;justify-content:space-between}' +
            '#msNewUI .ms-card h4 small{text-transform:none;letter-spacing:0;font-weight:normal;color:#7a5a2a}' +
            '#msNewUI .ms-in{padding:8px}' +
            '#msNewUI table.ms-u{border-collapse:collapse;width:100%;font-size:12px}' +
            '#msNewUI table.ms-u th{font-size:10px;color:#6b4a1a;text-align:left;padding:4px 6px;border-bottom:1px solid #dcc79a}' +
            '#msNewUI table.ms-u td{padding:4px 6px;border-bottom:1px solid #eadbb3}' +
            '#msNewUI table.ms-u tr:nth-child(even) td{background:#fbf0d0}' +
            '#msNewUI table.ms-u tr.off td{opacity:.45}#msNewUI table.ms-u tr.drag td{background:#f7e2b0}' +
            '#msNewUI .ms-grip{color:#a4884d;cursor:grab;font-size:14px;user-select:none}' +
            '#msNewUI input.ms-num{width:58px;text-align:right}' +
            '#msNewUI .ms-stages{display:grid;grid-template-columns:1fr 1fr;gap:6px}' +
            '#msNewUI .ms-stage{display:flex;align-items:center;gap:6px;border:1px solid #c1a264;border-radius:3px;padding:5px 7px;background:#fbf0d0;cursor:pointer}' +
            '#msNewUI .ms-stage.on{background:#e8f0d0;border-color:#6f8f3a}' +
            '#msNewUI .ms-st{display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;background:#804000;color:#fff;font-weight:bold;font-size:11px}' +
            '#msNewUI .ms-seg{display:inline-flex;border:1px solid #a4884d;border-radius:3px;overflow:hidden;margin-bottom:8px}' +
            '#msNewUI .ms-seg span{padding:3px 10px;background:#fbf0d0;cursor:pointer}#msNewUI .ms-seg span.a{background:#804000;color:#fff}' +
            '#msNewUI .ms-rt{display:grid;grid-template-columns:auto 1fr auto;gap:6px 8px;align-items:center}' +
            '#msNewUI .ms-hint{font-size:10px;color:#7a5a2a}' +
            '#msNewUI .ms-radio{display:flex;gap:6px}' +
            '#msNewUI .ms-radio label{flex:1;border:1px solid #c1a264;border-radius:3px;padding:6px;background:#fbf0d0;cursor:pointer}' +
            '#msNewUI .ms-radio label.a{border-color:#804000;background:#f7e2b0;box-shadow:inset 0 0 0 1px #804000}' +
            '#msNewUI .ms-f{display:flex;gap:6px;align-items:center;padding:8px 10px;border-top:1px solid #c1a264;background:#ecd9a8;position:sticky;bottom:0}' +
            '#msNewUI .ms-f .sp{flex:1}' +
            '#msNewUI table.ms-u th{background:#e3cf9b!important;color:#5a3c10!important;background-image:none!important}' +
            '#msNewUI .ms-mv{display:none;white-space:nowrap}#msNewUI .ms-mv button{padding:2px 6px;margin:0 1px;font-size:11px}' +
            /* Handy / schmale Bildschirme */
            '@media (max-width:760px){' +
            '#msNewUI{top:0;width:100vw;max-width:100vw;border-radius:0;border-left:0;border-right:0;font-size:13px}' +
            '#msNewUI .ms-h{flex-wrap:wrap;font-size:13px;padding:6px 8px}#msNewUI .ms-h small{display:none}' +
            '#msNewUI .ms-barslot{padding:6px 8px}' +
            '#msNewUI .ms-grid{grid-template-columns:1fr;padding:8px;gap:8px}' +
            '#msNewUI table.ms-u td,#msNewUI table.ms-u th{padding:4px 3px}' +
            '#msNewUI input.ms-num{width:52px}' +
            '#msNewUI .ms-grip{display:none}#msNewUI .ms-mv{display:inline}#msNewUI .ms-card h4 small{display:none}' +
            '#msNewUI .ms-rt{grid-template-columns:auto 1fr}#msNewUI .ms-rt .ms-hint{grid-column:1/-1}' +
            '#msNewUI .ms-f{flex-wrap:wrap}#msNewUI .ms-f .sp,#msNewUI .ms-f .ms-hint{display:none}' +
            '}';
        document.head.appendChild(st);
    }

    function hoursHint(h) {
        var n = parseFloat(String(h).replace(',', '.'));
        return n > 0 ? 'zurück ca. ' + fmtTime(nowMs() + n * 3600000) : '';
    }

    /* Höhe an den sichtbaren Bereich anpassen; auf dem Handy Platz für die untere App-Leiste lassen */
    function fitHeight(el) {
        function fit() {
            if (!document.body.contains(el)) return window.removeEventListener('resize', fit);
            var small = window.innerWidth <= 760, top = Math.max(0, el.getBoundingClientRect().top);
            el.style.maxHeight = Math.max(200, window.innerHeight - top - (small ? 100 : 10)) + 'px';
        }
        fit(); window.addEventListener('resize', fit);
    }
    function buildNewUi() {
        injectUiStyle();
        $('#msNewUI').remove();
        var max = loadMax(), units = origUnits();
        var rows = units.map(function (u) {
            var on = $('#imgRow :checkbox[name="' + u + '"]').is(':checked');
            return '<tr data-u="' + u + '" class="' + (on ? '' : 'off') + '" draggable="true">' +
                '<td><span class="ms-grip" title="Ziehen zum Sortieren">≡</span><span class="ms-mv"><button type="button" class="btn ms-up" title="nach oben">▲</button><button type="button" class="btn ms-dn" title="nach unten">▼</button></span></td>' +
                '<td>' + unitIcon(u) + ' ' + (UNIT_DE[u] || u) + '</td>' +
                '<td style="text-align:center"><input type="checkbox" class="ms-use"' + (on ? ' checked' : '') + '></td>' +
                '<td style="text-align:right"><input type="text" class="ms-num ms-keep" value="' + esc($('#' + u + 'Backup').val() || 0) + '"></td>' +
                '<td style="text-align:right"><input type="text" class="ms-num ms-max" placeholder="∞" title="' + MAX_TIP + '" value="' + (max[u] || '') + '"></td></tr>';
        }).join('');
        var stages = [1, 2, 3, 4].map(function (k) {
            var on = $('#category' + k).is(':checked');
            return '<label class="ms-stage' + (on ? ' on' : '') + '"><input type="checkbox" class="ms-cat" data-k="' + k + '"' + (on ? ' checked' : '') + '><span class="ms-st">' + k + '</span> ' + STAGE_NAMES[k] + '</label>';
        }).join('');
        var dateMode = $('#timeSelectorDate').is(':checked');
        var bal = !$('#settingPriorityPriority').is(':checked');
        var p = loadProfiles();
        var html =
            '<div class="ms-h"><span>⚔ Mass Scavenge Extended</span><small>by Maltox</small><small>· Profil „' + esc(p.active) + '“</small><span class="sp"></span>' +
            '<button type="button" class="btn" id="msReset" title="Einstellungen des Originals zurücksetzen">↺ Reset</button>' +
            '<button type="button" class="btn" id="msUiClose" title="Schließen">✕</button></div>' +
            '<div class="ms-barslot"></div>' +
            '<div class="ms-grid"><div class="ms-card"><h4>Einheiten <small>Reihenfolge per ≡ ziehen</small></h4>' +
            '<table class="ms-u"><tr><th></th><th>Einheit</th><th style="text-align:center">nutzen</th><th style="text-align:right">Reserve</th><th style="text-align:right">Max</th></tr>' + rows + '</table>' +
            '<div class="ms-in ms-hint">Reserve bleibt immer zu Hause · Max = höchstens so viele pro Dorf · leer = kein Limit</div></div>' +
            '<div class="ms-col">' +
            '<div class="ms-card"><h4>Stufen</h4><div class="ms-in ms-stages">' + stages + '</div></div>' +
            '<div class="ms-card"><h4>Rückkehr</h4><div class="ms-in">' +
            '<div class="ms-seg"><span data-m="h" class="' + (dateMode ? '' : 'a') + '">Laufzeit (Std.)</span><span data-m="d" class="' + (dateMode ? 'a' : '') + '">Uhrzeit</span></div>' +
            '<div class="ms-rt ms-rt-h"' + (dateMode ? ' style="display:none"' : '') + '>' +
            '<b>Off-Dörfer</b><input type="text" class="ms-h-off" style="width:70px" value="' + esc($('.runTime_off').val() || '') + '"><span class="ms-hint ms-hh-off"></span>' +
            '<b>Deff-Dörfer</b><input type="text" class="ms-h-def" style="width:70px" value="' + esc($('.runTime_def').val() || '') + '"><span class="ms-hint ms-hh-def"></span></div>' +
            '<div class="ms-rt ms-rt-d"' + (dateMode ? '' : ' style="display:none"') + '>' +
            '<b>Off-Dörfer</b><span><input type="date" class="ms-d-offDay" value="' + esc($('#offDay').val() || '') + '"> <input type="time" class="ms-d-offTime" value="' + esc($('#offTime').val() || '') + '"></span><span></span>' +
            '<b>Deff-Dörfer</b><span><input type="date" class="ms-d-defDay" value="' + esc($('#defDay').val() || '') + '"> <input type="time" class="ms-d-defTime" value="' + esc($('#defTime').val() || '') + '"></span><span></span></div>' +
            '</div></div>' +
            '<div class="ms-card"><h4>Verteilung</h4><div class="ms-in ms-radio">' +
            '<label class="' + (bal ? 'a' : '') + '"><input type="radio" name="msPrio" value="b"' + (bal ? ' checked' : '') + '> <b>Ausgewogen</b><br><span class="ms-hint">gleichmäßig über alle Stufen</span></label>' +
            '<label class="' + (bal ? '' : 'a') + '"><input type="radio" name="msPrio" value="p"' + (bal ? '' : ' checked') + '> <b>Höhere zuerst</b><br><span class="ms-hint">obere Stufen zuerst füllen</span></label>' +
            '</div></div></div></div>' +
            '<div class="ms-f"><button type="button" class="btn btn-confirm-yes" id="msCalc">▶ Berechnen</button>' +
            '<button type="button" class="btn" id="msRunAll" title="Alle Profile nacheinander berechnen, gemeinsame Vorschau">Alle Profile berechnen</button>' +
            '<button type="button" class="btn" id="msOverview" title="Laufende Raubzüge und Restzeiten aller Dörfer anzeigen">Übersicht</button>' +
            '<button type="button" class="btn" id="msStats" title="Rückkehrzeiten und Beute unterwegs">Statistik</button>' +
            '<span class="sp"></span><span class="ms-hint">Basis: Mass scavenging · Shinko to Kuma</span></div>';
        var ui = $('<div id="msNewUI"></div>').html(html).appendTo('body');
        fitHeight(ui[0]);

        /* --- Einheiten --- */
        ui.find('.ms-use').on('change', function () {
            var u = $(this).closest('tr').attr('data-u');
            $('#imgRow :checkbox[name="' + u + '"]').prop('checked', this.checked);
            $(this).closest('tr').toggleClass('off', !this.checked);
        });
        ui.find('.ms-keep').on('input change', function () {
            var u = $(this).closest('tr').attr('data-u');
            $('#' + u + 'Backup').val(this.value);
        });
        ui.find('.ms-max').each(function () {
            var u = $(this).closest('tr').attr('data-u');
            bindMax(this, u);
            $(this).on('input change', function () { $('#' + u + 'Max').val(this.value); });
        });
        /* Reihenfolge per Drag & Drop -> Spalten im Original umsortieren (bestimmt sendOrder) */
        var dragRow = null;
        ui.find('tr[data-u]').on('dragstart', function (e) { dragRow = this; $(this).addClass('drag'); e.originalEvent.dataTransfer.effectAllowed = 'move'; try { e.originalEvent.dataTransfer.setData('text', 'x'); } catch (x) {} })
            .on('dragend', function () { $(this).removeClass('drag'); dragRow = null; })
            .on('dragover', function (e) {
                if (!dragRow || dragRow === this) return;
                e.preventDefault();
                var r = this.getBoundingClientRect(), after = e.originalEvent.clientY > r.top + r.height / 2;
                if (after) $(this).after(dragRow); else $(this).before(dragRow);
            })
            .on('drop', function (e) { e.preventDefault(); applyOrder(); });
        function applyOrder() {
            ui.find('tr[data-u]').each(function () { var c = unitCol($(this).attr('data-u')); c.parent().append(c); });
        }
        /* Handy: Pfeile statt Ziehen */
        ui.find('.ms-up').on('click', function () { var r = $(this).closest('tr'), p = r.prev('tr[data-u]'); if (p.length) { p.before(r); applyOrder(); } });
        ui.find('.ms-dn').on('click', function () { var r = $(this).closest('tr'), n = r.next('tr[data-u]'); if (n.length) { n.after(r); applyOrder(); } });
        /* --- Stufen --- */
        ui.find('.ms-cat').on('change', function () {
            $('#category' + $(this).attr('data-k')).prop('checked', this.checked);
            $(this).closest('.ms-stage').toggleClass('on', this.checked);
        });
        /* --- Rückkehr --- */
        function hh() { ui.find('.ms-hh-off').text(hoursHint(ui.find('.ms-h-off').val())); ui.find('.ms-hh-def').text(hoursHint(ui.find('.ms-h-def').val())); }
        hh();
        ui.find('.ms-seg span').on('click', function () {
            var d = $(this).attr('data-m') === 'd';
            ui.find('.ms-seg span').removeClass('a'); $(this).addClass('a');
            ui.find('.ms-rt-h').toggle(!d); ui.find('.ms-rt-d').toggle(d);
            var r = document.getElementById(d ? 'timeSelectorDate' : 'timeSelectorHours');
            if (r) { r.checked = true; fire(r); fire(r, 'change'); }
        });
        ui.find('.ms-h-off').on('input', function () { var o = $('.runTime_off')[0]; o.value = this.value; fire(o); hh(); });
        ui.find('.ms-h-def').on('input', function () { var o = $('.runTime_def')[0]; o.value = this.value; fire(o); hh(); });
        ['offDay', 'offTime', 'defDay', 'defTime'].forEach(function (id) {
            ui.find('.ms-d-' + id).on('input change', function () { var o = document.getElementById(id); if (o) { o.value = this.value; fire(o); } });
        });
        /* --- Verteilung --- */
        ui.find('input[name=msPrio]').on('change', function () {
            var r = document.getElementById(this.value === 'b' ? 'settingPriorityBalanced' : 'settingPriorityPriority');
            if (r) { r.checked = true; fire(r, 'change'); }
            ui.find('.ms-radio label').removeClass('a'); $(this).closest('label').addClass('a');
        });
        /* --- Kopfzeile --- */
        ui.find('#msUiClose').on('click', function () { $('#msNewUI').remove(); $('#massScavengeSophie').remove(); });
        ui.find('#msReset').on('click', function () {
            if (typeof window.resetSettings === 'function' && confirm('Einstellungen des Originals zurücksetzen?')) window.resetSettings();
        });
        /* Fenster verschiebbar */
        ui.find('.ms-h').on('mousedown', function (e) {
            if ($(e.target).is('button')) return;
            var el = ui[0], r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
            el.style.margin = '0'; el.style.right = 'auto';
            function mv(ev) { el.style.left = (ev.clientX - dx) + 'px'; el.style.top = Math.max(0, ev.clientY - dy) + 'px'; }
            function up() { $(document).off('mousemove', mv).off('mouseup', up); }
            $(document).on('mousemove', mv).on('mouseup', up);
            e.preventDefault();
        });
    }

    function addUi() {
        var so = $('#massScavengeSophie');
        addMaxInputs();
        if (batching) { so.css('display', 'none'); return; }
        if (so.length && !so.attr('data-ms-ui') && origOk()) {
            so.attr('data-ms-ui', '1').css('display', 'none');
            buildNewUi();
            addProfileBar();
            return;
        }
        if (!$('#msNewUI').length) addProfileBar(); /* Fallback: Original sichtbar lassen, Leiste darin */
    }

    if (window.__msObserver) window.__msObserver.disconnect();
    {
        window.__msObserver = new MutationObserver(function () {
            if ($('#massScavengeSophie').length) addUi();
            addPreviewButton();
        });
        window.__msObserver.observe(document.body, { childList: true, subtree: true });
    }

    loadGroups(function () {}); /* Standardgruppe "alle" früh ermitteln */
    /* Beim Start: Einstellungen des aktiven Profils laden, dann Original starten */
    var start = loadProfiles();
    applySettings(start.list[start.active].settings);
    startOriginal();
})();
