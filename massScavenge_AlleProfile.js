/* Massenraubzug-Erweiterung (Max, Profile, Dorfgruppe, Vorschau, Alle Profile)
   Laden per Schnellleiste:  javascript:$.getScript('https://DEIN-HOST/massScavenge_AlleProfile.js');void 0; */
var premiumBtnEnabled = false;

(function () {
    var SCRIPT_URL = 'https://shinko-to-kuma.com/scripts/massScavenge.js';
    var MAX_KEY = 'maxSend';
    var PROFILE_KEY = 'msProfiles';
    /* Alle Einstellungen des Originals + Max, die pro Profil gespeichert werden */
    var runInfo = {};
    /* Rückkehrzeit (Unix-Sekunden) des spätesten laufenden Raubzugs im Dorf, sonst null */
    function runningUntil(data) {
        var o = data && data.options, until = null;
        if (!o) return null;
        Object.keys(o).forEach(function (k) {
            var sq = o[k] && o[k].scavenging_squad;
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
    function activeGroup() { if (batching) return batchGroup; var p = loadProfiles(); return p.list[p.active].group || '0'; }

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
    function loadGroups(cb) {
        if (groupCache) return cb(groupCache);
        $.get(game_data.link_base_pure + 'groups&mode=overview&ajax=load_group_menu')
            .done(function (d) {
                try {
                    if (typeof d === 'string') d = JSON.parse(d);
                    groupCache = [{ id: '0', name: 'Alle' }];
                    (d.result || []).forEach(function (g) {
                        if (g.group_id != null && g.type !== 'separator') groupCache.push({ id: String(g.group_id), name: g.name });
                    });
                } catch (e) { groupCache = null; }
                cb(groupCache);
            })
            .fail(function () { cb(null); });
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
            /* Laufender Raubzug im Dorf: neue Züge dürfen nicht länger laufen als der späteste laufende */
            var run = runningUntil(data);
            if (run === null) return origCalc.call(this, data);
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
            var r = origReady.apply(this, arguments);
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
    function addMaxInputs() {
        var max = loadMax();
        $('input[id$="Backup"]').each(function () {
            var unit = this.id.replace(/Backup$/, '');
            if (document.getElementById(unit + 'Max')) return;
            $(this).after(
                '<br><font title="Maximal pro Dorf losschicken (leer/0 = kein Limit)">Max</font><br>' +
                '<input type="text" id="' + unit + 'Max" size="5" placeholder="∞" value="' + (max[unit] || '') + '">'
            );
            $('#' + unit + 'Max').on('input change', function () {
                var m = loadMax(), v = parseInt($(this).val(), 10);
                if (v > 0) m[unit] = v; else delete m[unit];
                lsSet(MAX_KEY, JSON.stringify(m));
                storeActive();
            });
        });
    }

    function addProfileBar() {
        var box = $('#massScavengeSophie');
        if (!box.length || $('#msProfileBar').length) return;
        var p = loadProfiles();
        var opts = Object.keys(p.list).map(function (n) {
            return '<option value="' + esc(n) + '"' + (n === p.active ? ' selected' : '') + '>' + esc(n) + '</option>';
        }).join('');
        box.prepend(
            '<div id="msProfileBar" style="padding:6px;background:#f4e4bc;color:#000">' +
            '<b>Profil:</b> <select id="msProfileSel">' + opts + '</select> ' +
            '<button type="button" class="btn" id="msProfileNew">Neu</button> ' +
            '<button type="button" class="btn" id="msProfileRen">Umbenennen</button> ' +
            '<button type="button" class="btn" id="msProfileDel">Löschen</button> ' +
            '<button type="button" class="btn" id="msRunAll" title="Alle Profile nacheinander berechnen, gemeinsame Vorschau">Alle Profile</button> ' +
            '&nbsp; <b>Dorfgruppe:</b> <span id="msGroupWrap">lädt…</span>' +
            '</div>'
        );

        $('#msRunAll').on('click', runAll);
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
        var td = typeof tempData !== 'undefined' ? tempData : null, o = (td && td[opt]) || (td && td[1]) || {};
        return {
            lf: o.loot_factor || LOOT_FACTOR[opt],
            exp: o.duration_exponent != null ? o.duration_exponent : (typeof duration_exponent !== 'undefined' ? duration_exponent : null),
            init: o.duration_initial_seconds != null ? o.duration_initial_seconds : (typeof duration_initial_seconds !== 'undefined' ? duration_initial_seconds : 0),
            fac: o.duration_factor != null ? o.duration_factor : (typeof duration_factor !== 'undefined' ? duration_factor : null)
        };
    }
    function captureVillages() {
        var list = (typeof scavengeInfo !== 'undefined' && scavengeInfo) || [];
        list.forEach(function (v) { if (v && v.village_id != null) vilMap[v.village_id] = { name: v.village_name || v.name || v.village_id, cf: v.unit_carry_factor || 1 }; });
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

    function hasUnits(r) {
        var uc = (r.candidate_squad && r.candidate_squad.unit_counts) || {}, has = false;
        Object.keys(uc).forEach(function (u) { if (parseInt(uc[u], 10) > 0) has = true; });
        return has;
    }
    function showPreview() {
        try {
            var sq = typeof squads !== 'undefined' ? squads : null, groups = [], empty = 0;
            captureVillages();
            Object.keys(sq).forEach(function (g) {
                var all = sq[g] || [], reqs = all.filter(hasUnits);
                empty += all.length - reqs.length;
                if (reqs.length) groups.push({ label: 'Gruppe ' + (+g + 1), reqs: reqs, orig: +g });
            });
            buildPreview(groups, empty, '');
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
            '#msPreviewBox .r{text-align:right;white-space:nowrap}';
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
    }
    function closeAll() {
        ['msPreviewBox', 'massScavengeFinal', 'massScavengeSophie'].forEach(function (id) {
            var e = document.getElementById(id); if (e) e.parentNode.removeChild(e);
        });
    }
    function runNotes() {
        var skip = 0, cap = 0;
        Object.keys(runInfo).forEach(function (v) { if (runInfo[v].skip) skip++; else if (runInfo[v].capped) cap++; });
        return (cap ? '<div>⏱ ' + cap + ' Dörfer mit laufendem Raubzug: Laufzeit auf dessen Rückkehr gekürzt.</div>' : '') +
               (skip ? '<div>⏱ ' + skip + ' Dörfer übersprungen: laufender Raubzug kommt zu bald zurück.</div>' : '');
    }
    function buildPreview(groups, empty, note) {
        var byVillage = {}, order = [], prof = {};
        groups.forEach(function (gr) {
            gr.reqs.forEach(function (r) {
                if (!byVillage[r.village_id]) { byVillage[r.village_id] = []; order.push(r.village_id); prof[r.village_id] = gr.profile; }
                byVillage[r.village_id].push(r);
            });
        });
        var notes = (note ? '<div>' + note + '</div>' : '') + runNotes() +
            (empty ? '<div>' + empty + ' leere Züge ohne Truppen ausgeblendet.</div>' : '');
        if (!order.length) return box((notes ? '<div class="ms-note">' + notes + '</div>' : '') +
            '<b>Nichts zu verschicken.</b> Reserve/Max prüfen oder alle Stufen belegt.<br><small>' + esc(dbg()) + '</small>');
        sendList = groups; sentCount = 0;
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
            return '<input type="button" class="btn btn-confirm-yes" value="' + esc(gr.label) + ' abschicken" onclick="msSend(' + i + ',this)">';
        }).join('') + '<small style="margin-left:auto">Schätzwerte · Zeiten ab jetzt</small>';
        box(html, 'Raubzug-Vorschau', foot);
    }

    var sentCount = 0;
    function groupDone(btn, ok) {
        btn.value = ok ? 'Gesendet ✓' : 'Fehler';
        if (!ok) return;
        sentCount++;
        if (sentCount >= sendList.length) {
            setTimeout(function () { closeAll(); UI.SuccessMessage('Raubzüge abgeschickt.'); }, 700);
        }
    }
    window.msSend = function (i, btn) {
        var gr = sendList[i];
        if (!gr || btn.disabled) return;
        btn.disabled = true;
        if (gr.orig != null && typeof sendGroup === 'function') { sendGroup(gr.orig, false); return groupDone(btn, true); }
        btn.value = 'Sende…';
        TribalWars.post('scavenge_api', { ajaxaction: 'send_squads' }, { squad_requests: gr.reqs },
            function () { groupDone(btn, true); }, function () { groupDone(btn, false); });
    };

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
        var p = loadProfiles(), names = Object.keys(p.list), i = 0, groups = [], seen = {}, dup = 0, empty = 0, failed = [];
        batching = true; runInfo = {};
        function next() {
            if (i >= names.length) return finish();
            var name = names[i++], pr = p.list[name];
            batchGroup = pr.group || '0';
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
                            if (!hasUnits(r)) { empty++; return; }
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
            var note = '<b>Alle Profile:</b> ' + names.length + ' berechnet' +
                (dup ? ' · ' + dup + ' Züge übersprungen (Dorf schon in früherem Profil)' : '') +
                (failed.length ? ' · <span style="color:#a00">fehlgeschlagen: ' + esc(failed.join(', ')) + '</span>' : '');
            try { buildPreview(groups, empty, note); } catch (e) { box('<b>Vorschau-Fehler:</b> ' + esc(e.message)); }
        }
        next();
    }

    function addPreviewButton() {
        var fin = $('#massScavengeFinal');
        if (!fin.length || $('#msPreviewBtn').length) return;
        window.msShowPreview = showPreview;
        fin.prepend('<input type="button" class="btn" id="msPreviewBtn" value="Vorschau" style="margin:4px" onclick="msShowPreview()">');
        if (!batching) setTimeout(showPreview, 0);
    }

    function addUi() { addProfileBar(); addMaxInputs(); }

    if (window.__msObserver) window.__msObserver.disconnect();
    {
        window.__msObserver = new MutationObserver(function () {
            if ($('#massScavengeSophie').length) addUi();
            addPreviewButton();
        });
        window.__msObserver.observe(document.body, { childList: true, subtree: true });
    }

    /* Beim Start: Einstellungen des aktiven Profils laden, dann Original starten */
    var start = loadProfiles();
    applySettings(start.list[start.active].settings);
    startOriginal();
})();
