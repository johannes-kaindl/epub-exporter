// Repo-eigene ESLint-Abweichungen — der EINZIGE Ort dafuer. Der Kern
// (eslint.config.mjs) ist template-verwaltet, Inline-disables blockt das Lint-Gate.
// Jeder Override braucht eine Begruendung im Kommentar.
//
// Zwei Klassen, zwei Preise (Details: _docs/docs/obsidian-plugin-publishing.md):
// - Kosmetik-/Benennungsregeln (z. B. ui/sentence-case bei Eigennamen/API-Namen):
//   Override ist die richtige Antwort und kostet nichts — der Scanner hat keinen
//   Mangel gefunden, sondern eine Konvention falsch angelegt.
// - Faehigkeitsregeln (z. B. settings-tab/prefer-setting-definitions): der Scanner
//   bewertet den Mangel, nicht die Begruendung — ein Override hier ist gestundete
//   Schuld und kostet die Store-Wertung ("Satisfactory" statt "Passed").
//   Marker fuer solche Faelle: `// STORE-SCHULD:` + wo die Abloesung geplant ist.
export default [
  {
    // Type-aware Linting braucht das Build-tsconfig des Repos. Achtung Falle
    // (json_viewer 1.9.0): ein obsidian→Mock-paths-Alias im referenzierten tsconfig
    // laesst die type-aware Regeln auf einen losen Mock aufloesen → no-unsafe-*-Kaskade.
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
];
