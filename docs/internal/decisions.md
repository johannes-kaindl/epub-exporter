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
