# ds-scripts

Erweiterung für das Massenraubzug-Skript von Shinko to Kuma (Die Stämme).
Das Originalskript wird unverändert geladen, die Erweiterung hängt sich nur ein.

## Einbinden (Schnellleiste → Ziel-URL)

```
javascript:$.getScript('https://cdn.jsdelivr.net/gh/Maltox-DS/ds-scripts@main/massScavenge_AlleProfile.js');void 0;
```

Nach einem Update kann es etwas dauern, bis jsDelivr die neue Version unter `@main` ausliefert.
Zum sofortigen Testen statt `@main` den Commit-Hash verwenden (z. B. `@f193513`).

## Funktionen

- **Max pro Einheit** – zusätzlich zur Reserve (Backup): höchstens so viele Truppen pro Dorf losschicken.
- **Profile** – komplette Einstellungen speichern und umschalten (Neu / Umbenennen / Löschen).
- **Dorfgruppe pro Profil** – jedes Profil rechnet nur mit den Dörfern seiner Gruppe
  (Standard ist die spielinterne Gruppe „alle“).
- **Nur aktuelles Dorf** – Checkbox, berechnet nur das Dorf, in dem man gerade ist.
- **Alle Profile** – alle Profile nacheinander berechnen, gemeinsame Vorschau.
  Profile mit der Gruppe „alle“ laufen immer zuletzt, Profile mit gleicher Gruppe werden übersprungen,
  und ein Dorf in mehreren Gruppen wird nur vom ersten Profil verplant.
- **Laufende Raubzüge** – läuft in einem Dorf schon ein Raubzug (nur freigeschaltete Stufen),
  wird die Laufzeit so gekürzt, dass die neuen Züge spätestens mit dem laufenden zurück sind.
  Ist die Rückkehrzeit unklar oder zu kurz, wird das Dorf übersprungen.
- **Vorschau** – öffnet sich nach „Calculate runtimes“ automatisch: Truppen je Stufe, Dauer,
  Rückkehr, geschätzte Beute, mit Stämme-Icons. Abschicken direkt aus der Vorschau,
  jede Gruppe per eigenem Klick. Nach dem letzten Senden schließen sich alle Fenster.
  Das Launch-Fenster des Originals wird nicht mehr angezeigt; über „Vorschau“ in der Leiste
  lässt sich die letzte Berechnung wieder öffnen.
- **Mindestens 10 Einheiten** – Züge mit weniger als 10 Einheiten werden entfernt.

## Hinweis

Nicht von InnoGames freigegeben. Es wird nichts automatisch abgeschickt oder wiederholt –
jede Gruppe wird per Klick gesendet. Nutzung auf eigenes Risiko.
