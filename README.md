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

Fordert Rohstoffe für einen Ausbau, Münzen oder AGs aus mehreren eigenen Dörfern an.
Das Skript rechnet nur und trägt die Mengen auf der Marktplatz-Seite „Anfordern“ ein –
abgeschickt wird mit dem Spiel-Button „Anfordern“ per eigenem Klick. Benötigt Premium.

### Einbinden (Schnellleiste → Ziel-URL)

```
javascript:$.getScript('https://cdn.jsdelivr.net/gh/Maltox-DS/ds-scripts@main/rohstoffeAnfordern.js');void 0;
```

### Ablauf

1. **Im Hauptgebäude starten** – Bedarf zusammenstellen und Lieferdörfer anhaken, dann „Im Marktplatz eintragen“.
2. **Auf der Seite „Anfordern“ erneut starten** – die Mengen werden eingetragen und grün markiert.
3. **Selbst auf „Anfordern“ klicken.**

### Funktionen

- **Bedarf aus mehreren Posten** – nächste Gebäudestufe (Kosten aus dem Hauptgebäude), Münzen
  (Kosten aus der Weltkonfiguration), AG-Einheitenkosten und freie Mengen, beliebig kombinierbar.
- **Abzüge** – vorhandene Rohstoffe im Dorf (abschaltbar) und „bereits unterwegs“ (manuell).
- **Speicher-Check** – warnt und kürzt, wenn der Speicher die angeforderte Menge nicht fasst.
- **Lieferdörfer** – alle Dörfer nach Entfernung sortiert mit Rohstoffen und freien Händlern;
  Auswahl per Haken, „Nächste 5“ oder „Keine“. Die Auswahl wird gespeichert.
- **Verteilung** – nächste Dörfer zuerst, mit Mindestreserve je Rohstoff im Lieferdorf und
  begrenzt durch die freien Händler (Kapazität je Händler einstellbar, Standard 1.000).
  Was nicht gedeckt werden kann, wird rot als „Fehlt noch“ angezeigt.
- **Schutz vor Doppelanforderung** – ein schon eingetragener Plan wird nur nach Rückfrage erneut
  eingetragen; Pläne älter als 30 Minuten werden gemeldet. „Plan verwerfen“ löscht den Plan.

### Bekannte Grenzen

- AG: nur die Einheitenkosten (40.000 / 50.000 / 50.000) – Münzen separat hinzufügen.
- „Bereits unterwegs“ wird noch nicht automatisch erkannt.
- Erste Version, die Erkennung der Felder auf der Seite „Anfordern“ ist noch nicht im Spiel getestet.

## Alte Datei

`massScavenge_AlleProfile.js` ist der frühere Name und wird nicht mehr aktualisiert.

## Hinweis

Nicht von InnoGames freigegeben. Es wird nichts automatisch abgeschickt oder wiederholt –
jede Gruppe bzw. Anforderung wird per Klick gesendet. Nutzung auf eigenes Risiko.
