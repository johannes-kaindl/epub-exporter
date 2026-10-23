---
paths:
  - "scripts/gui-smoke.ts"
  - "scripts/e2e-crossplugin.ts"
  - "scripts/shots.ts"
  - "docs/SMOKE.md"
---

# GUI-Smoke und Naht-Lauf — Gotchas

Allgemeine Treiber-Regeln, Zweitinstanz und Lock stehen im Dach (`../.claude/rules/gui-smoke-treiber.md`, `../.claude/rules/obsidian-instanz.md`, `../.claude/rules/cdp-lock.md`); Rezept im Kopf von `scripts/gui-smoke.ts`, Prüfpunkte in `docs/SMOKE.md`.

- **`smoke:e2e` gehört NICHT ins Gate.** Er setzt `local-image-generator` echt installiert im selben Staging-Vault voraus (aus dem Nachbar-Repo deployt, nicht aus dem Store) — genau das, was `smoke:gui` bewusst nicht voraussetzt. Beide zusammen ergeben die Prüfung: T1–T3 messen unsere Hälfte in jedem Durchgang, `smoke:e2e` die Naht, wenn der Nachbar da ist. Der Titelbild-Stub in `gui-smoke.ts` bleibt deshalb, er wird nicht ersetzt.
- **Der Klick braucht eine Haltedauer.** `clickReal(cdp, ausdruck, 200)` — ohne den dritten Parameter gehen `mousePressed`/`mouseReleased` ohne Pause raus, also schneller als der asynchrone Rerender der Sidebar. Der Knopf überlebt dann einen Klick, den er im Gebrauch nicht überlebt, und S4 ist **grün am Falschen** (gemessen 2026-08-30: die Gegenprobe blieb 12/12 grün, obwohl der Fix ausgebaut war).
