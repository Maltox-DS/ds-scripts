# ds-scripts

## Mass Scavenge Extended by Maltox

Erweiterung für das Massenraubzug-Skript von Shinko to Kuma (Die Stämme).
Das Originalskript wird unverändert geladen, die Erweiterung hängt sich nur ein.

## Einbinden (Schnellleiste → Ziel-URL)

```
javascript:$.getScript('https://cdn.jsdelivr.net/gh/Maltox-DS/ds-scripts@main/massScavengeExtended.js');void 0;
```

Nur die Übersicht bzw. nur die Statistik als eigener Schnellleisten-Eintrag:

```
javascript:window.msMode='overview';$.getScript('https://cdn.jsdelivr.net/gh/Maltox-DS/ds-scripts@main/massScavengeExtended.js');void 0;
javascript:window.msMode='stats';$.getScript('https://cdn.jsdelivr.net/gh/Maltox-DS/ds-scripts@main/massScavengeExtended.js');void 0;
```

Nach einem Update kann es etwas dauern, bis jsDelivr die neue Version unter `@main` ausliefert.
Zum sofortigen Testen statt `@main` den Commit-Hash verwenden (z. B. `@abc1234`).

## Funktionen

- **Neues Einstellungsfenster** – kompaktes Fenster im Stämme-Stil (Einheiten mit Reserve/Max,
  Stufen, Rückkehr, Verteilung). Das Original läuft unsichtbar im Hintergrund und rechnet weiter;
  fehlen dessen Felder (z. B. nach einem Update von Shinko), wird automatisch das Original angezeigt.
- **Max pro Einheit** – zusätzlich zur Reserve (Backup): höchstens so viele Truppen pro Dorf losschicken.
- **Profile** – komplette Einstellungen speichern und umschalten (Neu / Umbenennen / Löschen).
- **Dorfgruppe pro Profil** – jedes Profil rechnet nur mit den Dörfern seiner Gruppe
  (Standard ist die spielinterne Gruppe „alle“).
- **Nur aktuelles Dorf** – Checkbox, berechnet nur das Dorf, in dem man gerade ist.
- **Alle Profile** – Schritt für Schritt: jedes Profil wird mit einem eigenen Klick berechnet
  („Weiter: … berechnen“), danach gemeinsame Vorschau (auch vorzeitig möglich, oder Abbrechen).
  Profile mit der Gruppe „alle“ laufen immer zuletzt, Profile mit gleicher Gruppe werden übersprungen,
  und ein Dorf in mehreren Gruppen wird nur vom ersten Profil verplant.
- **Laufende Raubzüge** – läuft in einem Dorf schon ein Raubzug (nur freigeschaltete Stufen),
  wird die Laufzeit so gekürzt, dass die neuen Züge spätestens mit dem laufenden zurück sind.
  Ist die Rückkehrzeit unklar oder zu kurz, wird das Dorf übersprungen.
- **Vorschau** – öffnet sich nach „Calculate runtimes“ automatisch: Truppen je Stufe, Dauer,
  Rückkehr, geschätzte Beute, mit Stämme-Icons. Abschicken direkt aus der Vorschau,
  jede Gruppe per eigenem Klick. Nach dem letzten Senden schließen sich alle Fenster.
  Das Launch-Fenster des Originals wird nicht mehr angezeigt.
- **Übersicht** – immer alle Dörfer: pro Dorf und Stufe frei / gesperrt / Restzeit (live), letzte Rückkehr
  (früheste grün, späteste rot) und Beute unterwegs je Rohstoff. Funktioniert auch auf dem Handy.
- **Rückkehr „Täglich um“** – dritte Zeit-Option: nur Uhrzeit eingeben (z. B. 08:00); ist sie schon vorbei,
  wird automatisch der nächste Tag genommen.
- **Danach zur vorherigen Gruppe zurück** – optionaler Schalter (Standard: aus). Ist er an, wechselt das Spiel
  nach dem Berechnen bzw. nach Übersicht/Statistik wieder auf die vorher ausgewählte Dorfgruppe
  (eine zusätzliche Seitenabfrage).
- **Statistik** – Effizienz auf einen Blick: Beute pro Stunde (mit 24-h-Hochrechnung), Beute unterwegs,
  Auslastung der Stufen, Truppen unterwegs vs. zu Hause, Leerlauf-Warnung (freie Stufe + Truppen zu Hause),
  nächste freie Stufe, erste/letzte Rückkehr, Beute je Stufe und eine Rangliste der Dörfer nach Beute/h.
- **Mindestens 10 Einheiten** – Züge mit weniger als 10 Einheiten werden entfernt.

## Rohstoffe anfordern by Maltox

Fordert Rohstoffe für einen Ausbau, Münzen oder AGs aus mehreren eigenen Dörfern an –
im Stil von „Request resources to HQ“ (Shinko to Kuma), aber mit mehreren Lieferdörfern. Benötigt Premium.

### Tampermonkey (empfohlen)

Einmal installieren: in Tampermonkey „Aus URL installieren“:

```
https://raw.githubusercontent.com/Maltox-DS/ds-scripts/main/rohstoffeAnfordern.user.js
```

Das ist nur ein kleiner Loader. Der eigentliche Code steht in `rohstoffeAnfordernButtons.js` und wird bei jedem
Aufruf von Hauptgebäude oder Adelshof über jsDelivr geladen – Updates im Repo kommen also ohne Neuinstallation an
(nach dem Upload jsDelivr-Cache leeren). Zum Testen eines bestimmten Stands im Loader `REF = 'main'` durch einen Commit-Hash ersetzen.

Danach gibt es dauerhaft Buttons:

- **Hauptgebäude** – eigene Spalte „Anfordern“: Button nur, wenn Rohstoffe fehlen (Tooltip zeigt, was fehlt),
  ✓ bei genug Rohstoffen, „zu klein“ wenn der Speicher die Stufe nicht fasst. Oben „Rohstoffe anfordern“ für freie Mengen.
- **Adelshof** – Leiste mit „Münzen“, „AG“ und „Freie Menge“. Die fürs nächste AG fehlenden Münzen werden
  aus dem Adelshof gelesen und vorausgefüllt (falls erkannt). Bei Münzen und AGs darf mehr angefordert werden,
  als in den Speicher passt (für die automatische Prägung): **gleichmäßig** – jede Lieferung kommt im exakten
  Kostenverhältnis, und alles, was innerhalb von 90 Sekunden ankommt, bleibt zusammen unter der Speichergrenze
  (mit Puffer für einen noch nicht geprägten Rest).

Ein Klick öffnet das Anforderungsfenster:

1. **Bedarf** – Kosten minus vorhandene Rohstoffe (abschaltbar) minus eingehende Rohstoffe
   (werden automatisch von der Seite „Anfordern“ gelesen, von Hand änderbar). Bei Gebäuden lässt sich
   „bis Stufe“ erhöhen, dann werden die Kosten aller Stufen exakt aus den Spieldaten berechnet.
2. **Lieferdörfer** – nach Laufzeit sortiert (von der Seite „Anfordern“, sonst geschätzt) mit Ankunftszeit,
   Rohstoffen und freien Händlern. „Automatisch“ hakt die schnellsten Dörfer mit freien Händlern an,
   bis der Bedarf gedeckt ist; von Hand änderbar.
3. **Verteilung** – schnellste Dörfer zuerst, mit Reserve je Rohstoff und begrenzt durch die freien Händler.
   Was nicht gedeckt werden kann, steht rot darunter. Unten steht, wann alles da ist.
4. **Anfordern** – pro Lieferdorf ein Klick („Anfordern“ in der Zeile oder „Nächstes anfordern“).
   Nach der ersten Anforderung ist der Plan gesperrt, damit nichts doppelt angefordert wird.

Reserve und Händlerkapazität werden gespeichert. Für Diagnose-Ausgaben in der Konsole in `rohstoffeAnfordernButtons.js` `DEBUG = true` setzen.

### Schnellleisten-Version (alt)

Rechnet im Hauptgebäude und trägt die Mengen auf der Seite „Anfordern“ nur ein – abgeschickt wird mit dem Spiel-Button.

```
javascript:$.getScript('https://cdn.jsdelivr.net/gh/Maltox-DS/ds-scripts@main/rohstoffeAnfordern.js');void 0;
javascript:$.getScript('https://cdn.jsdelivr.net/gh/Maltox-DS/ds-scripts@main/rohstoffeAnfordernTest.js');void 0;
```

Die zweite Zeile ist die Testversion mit Diagnose-Ausgaben in der Konsole (F12).

### Bekannte Grenzen

- AG: nur die Einheitenkosten (40.000 / 50.000 / 50.000) – Münzen separat anfordern.
- Tampermonkey-Skripte können nicht in die Skriptbibliothek aufgenommen werden.

## Alte Datei

`massScavenge_AlleProfile.js` ist der frühere Name und wird nicht mehr aktualisiert.

## Hinweis

Nicht von InnoGames freigegeben. Es wird nichts automatisch abgeschickt oder wiederholt –
jede Gruppe bzw. Anforderung wird per Klick gesendet. Nutzung auf eigenes Risiko.
