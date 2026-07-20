// Obsidian-Guideline-Gate (PROF-OBS-08): type-checked gegen ECHTE obsidian-Typen.
// KEIN Inline-`// eslint-disable` — genuin unvermeidbare Ausnahmen NUR als file-scoped
// Override unten, mit Begruendung. Erzwungen von `scripts/check-no-inline-disables.mjs`
// (erster Schritt von `npm run lint`); der Store wertet ein Inline-disable als ERROR.
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
  { ignores: ["main.js", "node_modules/", "tests/", "src/vendor/"] },
  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The settings tab keeps the classic display() API. obsidian.d.ts documents
    // display() as `@deprecated Since 1.13.0` but explicitly sanctions it as
    // "a fallback for plugins that need to support Obsidian versions older
    // than 1.13.0" (SettingTab#display doc comment) — so this is the
    // documented, supported path, not a workaround. manifest.json's
    // minAppVersion is 1.8.7, well below 1.13.0, so hosts on that floor never
    // call getSettingDefinitions() and must have a working display().
    // Migrating the four Setting rows to the declarative API is a real
    // feature change (parallel getControlValue/setControlValue wiring,
    // re-verifying the conditional customFolder row), not a lint fix — out
    // of scope for a type-/lint-only cleanup pass that must not alter
    // behaviour. Revisit as its own dedicated task if/when minAppVersion
    // moves past 1.13.0 and display() can be retired outright.
    files: ["src/obsidian/settings-tab.ts"],
    rules: {
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
      "@typescript-eslint/no-deprecated": "off",
    },
  },
);
