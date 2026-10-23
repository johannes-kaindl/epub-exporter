---
paths:
  - "src/obsidian/settings-tab.ts"
  - "src/obsidian/settings.ts"
  - "eslint.overrides.mjs"
  - "eslint.config.mjs"
---

# Settings-Tab — deklarativ plus `display()`-Fallback

`getSettingDefinitions()` treibt auf Obsidian **1.13+** das Rendering **und** die Settings-Suche; `display()` bleibt als dokumentierter **<1.13-Fallback** (obsidian.d.ts sanktioniert es explizit; `minAppVersion` ist **1.8.7**). `getControlValue`/`setControlValue` sind überschrieben (Sprach-Coercion, `customFolder`-Trim, Persistenz via `saveSettings`).

- **Load-bearing-Gotcha: deklarative Rows statisch halten (kein `visible`-Prädikat).** Dynamische Sichtbarkeit bräuchte `refreshDomState`/`update`, die **1.13-only** sind und das Store-Lint-Gate (`obsidianmd/no-unsupported-api`, **Error**) bei minAppVersion 1.8.7 blockt. Kontext wandert stattdessen in einen `desc`-Hinweis. Der `display()`-Fallback rendert über `renderSettingDefinitions` dieselbe Definitionsliste; die Zeile `customFolder` steht auf beiden Pfaden unbedingt da (ein früher getrennter Fallback blendete sie nur bei `outputDestination === "customFolder"` ein, was die Definitionen nie ausdrückten).
- **`eslint.overrides.mjs` hält dafür einen file-scoped `@typescript-eslint/no-deprecated: off`** (nur für `settings-tab.ts`, weil das behaltene `display()` deprecated-aber-sanktioniert ist). Bei minAppVersion > 1.13.0: `display()` + Override retiren, Rows dürfen dann dynamisch werden.
