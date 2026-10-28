# Entscheidungen — das Warum

Verdichtete Design-Essenz zu den Regeln im Kern (`AGENTS.md`). Vor dem Übernehmen einer Altentscheidung gilt: Grund aufsuchen, messen, ob er heute trägt.

## Die Buch-Note ist die Single Source of Truth

Ein Letterhead-artiges Frontmatter-Set plus geordnete `![[embeds]]` als Kapitel-Spine: dadurch ist das Buch in Obsidians Lesemodus **live als fertiges Buch sichtbar**. Das ist das Alleinstellungsmerkmal gegenüber einer reinen Link-Liste oder einem MOC.

## Kein Zwei-Wege-Sync

Bewusst out-of-scope (Komplexitäts-Sumpf). Die Kapitelreihenfolge schreibt ohne Rückfrage in die Buchnotiz; das ist die Absicht der Geste (Ziehen, Alt+Pfeil) und lässt sich mit der Gegenrichtung zurücknehmen (Entscheidung des Maintainers 2026-10-15, Cockpit).

## Eigener ZIP-Writer

Zero-Dep-Ethos wie bei Letterhead und Paperize: gut 90 Zeilen, rein store-only. Er bleibt Original-Code und ist ein Kit-Kandidat.

## Sidebar: ein Panel statt Tab-Maschinerie

Bewusst keine Tabs wie die Geschwister-Hubs (YAGNI).

## Settings-Rows statisch

Dynamische Sichtbarkeit wäre 1.13-only und würde das Store-Lint-Gate bei minAppVersion 1.8.7 blocken (Regel: `.claude/rules/settings-tab.md`).

## Zentrales Release-Tooling

Dieses Repo hat kein eigenes `scripts/release.mjs` (es war der erste Nutznießer des zentralen Toolings `../tools/release/`), damit Bugfixes am Release-Weg nicht N-fach nachgezogen werden müssen.

## SDD-Artefakte außerhalb des Repos

Specs und Pläne liegen im Coding-Cockpit des Maintainers (CORE-META-12/14): Sie tragen Arbeitskontext (Schwester-Repo-Interna, absolute Pfade), der in einem öffentlichen Repo niemandem nützt. Das Repo behält die Design-Essenz in diesen beiden Dateien und in `CHANGELOG.md`.

## Ordner als Buch: ein Menüeintrag, die Sidebar trägt den Rest

Der Rechtsklick auf einen Ordner bietet nur „EPUB erstellen“ und öffnet die Sidebar im Ordnermodus; Vorschau, Hinweis, Arbeitskopie und Export liegen dort (Entscheidung von Johannes, 2026-10-27). Der frühere Import (Ordner → Buch-Notiz) verlor seinen Menüeintrag und wanderte als Knopf in den Ordnermodus, Verhalten unverändert. Der Ordnermodus hat eine eigene Auswahl und endet nur durch eine ausdrückliche Handlung, nicht durch den Wechsel der aktiven Notiz, weil im Datei-Explorer umbenannt wird und dabei Notizen angeklickt werden; ein Umbenennen oder Verschieben des gewählten Ordners (auch eines übergeordneten) trägt die Auswahl auf den neuen Pfad, statt sie still zu leeren (Vault-Ereignis `rename`).

## Namensregel: Schalter aus, Zahl sortiert, `0` blendet aus

Der Schalter steht standardmäßig aus, damit ein Name wie „2024 Rückblick“ für bestehende Ordner-Exporte nichts verändert. Das Präfix reicht bis zum ersten Buchstaben; aus seinen Ziffernfolgen wird eine Zahlenliste (`1.10` hinter `1.2`). Ziffern, die unmittelbar in einen Buchstaben übergehen (`3D Grafik`, `2FA einrichten`), bleiben Teil des Titels. Ausgeblendet wird nur, wenn alle Werte 0 sind: `0`, `00`, `0.0`; `0.5 Foo` und `01` bleiben sichtbar. Ein Name, der nach dem Entfernen des Präfix leer wäre (`01`), behält den vollen Namen als Titel. Der Titelvergleich ist natürlich und läuft nach Codepunkten statt mit `localeCompare`, damit die Reihenfolge über ICU-Versionen stabil bleibt. Die Funktionen liegen im code-kit (`name-order`), weil paperize denselben Baum für das PDF braucht.

## Links im Ordner-Buch: voller Pfad, Anker entfallen

Die Doku verlinkt mit relativen Markdown-Links. Der Weg über den Dateinamen hätte jeden Link `README.md` auf die zuletzt eingetragene Seite gelenkt, falsch und ohne Meldung; deshalb löst `link-resolver` (code-kit) den Link relativ zum Pfad der verlinkenden Seite auf und lässt eine Seite außerhalb des Buchs zu Text werden. Gemessen am echten DOM (GUI-Smoke O5, Obsidian 1.15.0): `data-href` eines Links `[x](../x.md#a)` ist der Rohtext `../x.md#a`; ein Link mit `%20` kommt dekodiert (`../my page.md`), und die Auflösung nimmt beide Formen. Anker (`#abschnitt`) entfallen in Stufe 1: der Export setzt keine Kennungen an Überschriften, und die Regel, nach der ein Anker zu einer Überschrift passt, unterscheidet sich zwischen Forge und Obsidian; beides wäre ein eigener Baustein.

## Arbeitskopie: gespiegelter Pfad, nie überschreiben, erst Hilfsordner

Das Ziel ist `<Arbeitsverzeichnis>/<Vault-Pfad des Originals>`, damit gleichnamige Ordner (`docs` aus vielen Repos) nicht kollidieren und der Zielpfad aus dem Original allein folgt. Eine vorhandene Kopie wird nie überschrieben (dort wurde umbenannt), und es gibt keinen Weg zurück ins Original. Kopiert wird in einen Hilfsordner `<Ziel>.epub-exporter-tmp` neben dem Ziel und am Ende mit `vault.rename` umbenannt (kein `fileManager.renameFile`, das Links umschreiben könnte): Ein Abbruch mitten im Kopieren hinterließ sonst ein Ziel mit einem Teil der Dateien, das der nächste Klick wegen „nie überschreiben“ für fertig hielt und die Vorschau als Buch las. Ein liegen gebliebener Hilfsordner geht beim nächsten Versuch über `fileManager.trashFile` in den Papierkorb, nie per Löschen. Das EPUB aus der Arbeitskopie landet neben der Kopie, nicht neben dem Original (Entscheidung von Johannes, 2026-10-28): das Repo bleibt sauber, keine Binärdatei neben `docs/`.
