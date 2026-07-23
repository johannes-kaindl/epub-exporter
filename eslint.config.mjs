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
    // The settings tab implements the declarative getSettingDefinitions() API
    // (Obsidian 1.13+, drives both rendering and settings-search) AND keeps
    // display() as the documented <1.13 fallback: obsidian.d.ts sanctions
    // display() as "a fallback for plugins that need to support Obsidian
    // versions older than 1.13.0" (SettingTab#display doc comment), and
    // manifest.json's minAppVersion is 1.8.7. Because that kept display()
    // overrides a method obsidian.d.ts marks `@deprecated Since 1.13.0`,
    // @typescript-eslint/no-deprecated flags it — silence it for exactly this
    // file. (prefer-setting-definitions now passes on its own; its former
    // override was removed with the migration.) Retire display() and this
    // override once minAppVersion moves past 1.13.0.
    files: ["src/obsidian/settings-tab.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
);
