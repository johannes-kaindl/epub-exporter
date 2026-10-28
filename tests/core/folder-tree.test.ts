import { describe, it, expect } from "vitest";
import {
  buildBookTree,
  fileInputFromNote,
  flattenPages,
  type BookNode,
  type BookTree,
  type FolderBookOptions,
  type FolderFileInput,
} from "../../src/core/folder-tree";

function file(path: string, extra: Partial<FolderFileInput> = {}): FolderFileInput {
  return { path, chapterTitle: null, headingTitle: null, excluded: false, ...extra };
}

const OFF: FolderBookOptions = { numberPrefix: false, introNames: [], titleFromHeading: true };

// Das nvim-Muster: README je Ordner, Reihenfolge nicht in der Eingabe, ausgeschlossene Seite, Ordner nur mit ausgeschlossener Seite.
function nvimFiles(): FolderFileInput[] {
  return [
    file("docs/tutorials/lektion-02-b.md"),
    file("docs/README.md", { headingTitle: "Dokumentation" }),
    file("docs/STAND.md"),
    file("docs/tutorials/README.md", { headingTitle: "Tutorials" }),
    file("docs/tutorials/lektion-01-a.md"),
    file("docs/reference/handbuch/README.md"),
    file("docs/reference/handbuch/01-x.md"),
    file("docs/explanation/farbsystem.md", { headingTitle: "Erklärung: Das Farbsystem" }),
    file("docs/explanation/intern.md", { excluded: true }),
    file("docs/0 - Entwurf/a.md"),
    file("docs/leer/x.md", { excluded: true }),
  ];
}

/** Lesbare Form: ein Eintrag je Zeile, Tiefe als Einrückung, Einleitungsseite in eckigen Klammern. */
function outline(nodes: readonly BookNode[], depth = 0): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    const pad = "  ".repeat(depth);
    if (n.kind === "page") {
      out.push(`${pad}page:${n.title}`);
    } else {
      out.push(`${pad}chapter:${n.title}${n.intro ? ` [${n.intro.path}]` : ""}`);
      out.push(...outline(n.children, depth + 1));
    }
  }
  return out;
}

function pathsOf(tree: BookTree): string[] {
  return flattenPages(tree).map((p) => p.path);
}

describe("buildBookTree — ohne Schalter", () => {
  it("sortiert den vollen Namen natürlich, Seiten und Ordner gemischt", () => {
    const tree = buildBookTree("docs", nvimFiles(), OFF);
    expect(tree.title).toBe("docs");
    expect(outline(tree.children)).toEqual([
      "chapter:0 - Entwurf",
      "  page:a",
      "chapter:explanation",
      "  page:Erklärung: Das Farbsystem",
      // Ohne Einleitungsliste ist die README eine gewöhnliche Seite: sortiert nach dem Namen, betitelt nach der Überschrift.
      "page:Dokumentation",
      "chapter:reference",
      "  chapter:handbuch",
      "    page:01-x",
      "    page:README",
      "page:STAND",
      "chapter:tutorials",
      "  page:lektion-01-a",
      "  page:lektion-02-b",
      "  page:Tutorials",
    ]);
    // Zehn nach zwei: natürliche Ziffernfolge, nicht Zeichen für Zeichen.
    const nums = buildBookTree("d", [file("d/k 10.md"), file("d/k 2.md"), file("d/k 1.md")], OFF);
    expect(outline(nums.children)).toEqual(["page:k 1", "page:k 2", "page:k 10"]);
  });

  it("blendet ohne Schalter nichts aus, auch `0 - …` nicht", () => {
    const tree = buildBookTree("docs", nvimFiles(), OFF);
    expect(tree.hiddenCount).toBe(0);
    expect(pathsOf(tree)).toContain("docs/0 - Entwurf/a.md");
  });

  it("lässt ausgeschlossene Seiten und Ordner nur mit ausgeschlossenen Seiten weg, ohne sie zu zählen", () => {
    const tree = buildBookTree("docs", nvimFiles(), OFF);
    const paths = pathsOf(tree);
    expect(paths).not.toContain("docs/explanation/intern.md");
    expect(paths).not.toContain("docs/leer/x.md");
    expect(outline(tree.children).join("\n")).not.toContain("leer");
    expect(tree.hiddenCount).toBe(0);
  });

  it("ignoriert Dateien außerhalb der Wurzel und andere Dateitypen", () => {
    const tree = buildBookTree("docs", [file("docs/a.md"), file("docsx/b.md"), file("other/c.md"), file("docs/skript.py")], OFF);
    expect(pathsOf(tree)).toEqual(["docs/a.md"]);
  });
});

describe("buildBookTree — Namensregel", () => {
  const ON: FolderBookOptions = { numberPrefix: true, introNames: [], titleFromHeading: false };

  it("sortiert nach Zahl und entfernt das Präfix aus dem Titel", () => {
    const tree = buildBookTree(
      "b",
      [file("b/2. Der Mittelteil.md"), file("b/01 - Der Anfang.md"), file("b/1.10 Foo.md"), file("b/1.2 Foo.md"), file("b/Anhang.md")],
      ON,
    );
    expect(outline(tree.children)).toEqual(["page:Der Anfang", "page:Foo", "page:Foo", "page:Der Mittelteil", "page:Anhang"]);
    expect(pathsOf(tree)).toEqual(["b/01 - Der Anfang.md", "b/1.2 Foo.md", "b/1.10 Foo.md", "b/2. Der Mittelteil.md", "b/Anhang.md"]);
  });

  it("blendet `0 - …` als Ordner samt Teilbaum aus und zählt ihn einmal, nicht seine Seiten", () => {
    const files = [...nvimFiles(), file("docs/0 - Entwurf/b.md"), file("docs/0 - Entwurf/tief/c.md")];
    const tree = buildBookTree("docs", files, ON);
    expect(outline(tree.children).join("\n")).not.toContain("Entwurf");
    expect(pathsOf(tree).some((p) => p.includes("Entwurf"))).toBe(false);
    expect(tree.hiddenCount).toBe(1);
  });

  it("zählt ausgeblendete Seiten, aber nicht ausgeschlossene", () => {
    const tree = buildBookTree("b", [file("b/000_Entwurf.md"), file("b/0 - Notizen.md"), file("b/01 - A.md"), file("b/x.md", { excluded: true })], ON);
    expect(pathsOf(tree)).toEqual(["b/01 - A.md"]);
    expect(tree.hiddenCount).toBe(2);
  });

  it("behält bei einem Namen aus nur einer Zahl den vollen Namen als Titel", () => {
    const tree = buildBookTree("b", [file("b/01.md")], ON);
    expect(outline(tree.children)).toEqual(["page:01"]);
  });

  it("wendet die Regel auf den Ordnertitel und den Buchtitel an", () => {
    const tree = buildBookTree("Projekte/02 - Handbuch", [file("Projekte/02 - Handbuch/01 - Kap/x.md")], ON);
    expect(tree.title).toBe("Handbuch");
    expect(outline(tree.children)).toEqual(["chapter:Kap", "  page:x"]);
  });

  it("ein Ordner, dessen Seiten alle ausgeblendet sind, erscheint nicht", () => {
    const tree = buildBookTree("b", [file("b/ordner/0 - a.md"), file("b/ordner/00 - b.md"), file("b/x.md")], ON);
    expect(outline(tree.children)).toEqual(["page:x"]);
    expect(tree.hiddenCount).toBe(2);
  });
});

describe("buildBookTree — Einleitungsseiten", () => {
  const README: FolderBookOptions = { numberPrefix: false, introNames: ["README"], titleFromHeading: true };

  it("macht die README zur Einleitung des Kapitels und führt sie nicht noch einmal als Kind", () => {
    const tree = buildBookTree("docs", nvimFiles(), README);
    expect(tree.intro).toMatchObject({ kind: "page", path: "docs/README.md", title: "Dokumentation" });
    const tutorials = tree.children.find((n) => n.kind === "chapter" && n.title === "tutorials");
    expect(tutorials).toMatchObject({ kind: "chapter", folderPath: "docs/tutorials", intro: { path: "docs/tutorials/README.md" } });
    expect(outline(tree.children)).toEqual([
      "chapter:0 - Entwurf",
      "  page:a",
      "chapter:explanation",
      "  page:Erklärung: Das Farbsystem",
      "chapter:reference",
      "  chapter:handbuch [docs/reference/handbuch/README.md]",
      "    page:01-x",
      "page:STAND",
      "chapter:tutorials [docs/tutorials/README.md]",
      "  page:lektion-01-a",
      "  page:lektion-02-b",
    ]);
  });

  it("nimmt `{{folder_name}}` als Namen des Ordners, ohne Beachtung der Groß-/Kleinschreibung", () => {
    const opts: FolderBookOptions = { numberPrefix: false, introNames: ["{{folder_name}}"], titleFromHeading: true };
    const tree = buildBookTree("r", [file("r/plugins/Plugins.md"), file("r/plugins/andere.md")], opts);
    expect(outline(tree.children)).toEqual(["chapter:plugins [r/plugins/Plugins.md]", "  page:andere"]);
  });

  it("vergleicht `{{folder_name}}` nach dem Entfernen des Präfixes", () => {
    const opts: FolderBookOptions = { numberPrefix: true, introNames: ["{{folder_name}}", "README"], titleFromHeading: false };
    const tree = buildBookTree("r", [file("r/02 - plugins/plugins.md"), file("r/02 - plugins/01 - x.md")], opts);
    expect(outline(tree.children)).toEqual(["chapter:plugins [r/02 - plugins/plugins.md]", "  page:x"]);
  });

  it("die Wurzel-README ist die Einleitung des Buchs, nicht eine lose Seite", () => {
    const tree = buildBookTree("docs", nvimFiles(), README);
    expect(tree.intro?.path).toBe("docs/README.md");
    expect(pathsOf(tree)[0]).toBe("docs/README.md");
    expect(pathsOf(tree).filter((p) => p === "docs/README.md")).toHaveLength(1);
  });

  it("bei zwei Treffern gewinnt der erste nach Listenreihenfolge, der andere bleibt gewöhnliche Seite", () => {
    const opts: FolderBookOptions = { numberPrefix: false, introNames: ["Index", "README"], titleFromHeading: true };
    const tree = buildBookTree("r", [file("r/k/README.md"), file("r/k/index.md"), file("r/k/z.md")], opts);
    expect(outline(tree.children)).toEqual(["chapter:k [r/k/index.md]", "  page:README", "  page:z"]);
  });

  it("eine ausgeblendete oder ausgeschlossene Seite wird keine Einleitung", () => {
    const opts: FolderBookOptions = { numberPrefix: true, introNames: ["README"], titleFromHeading: false };
    const tree = buildBookTree("r", [file("r/k/0 - README.md"), file("r/k/a.md"), file("r/j/README.md", { excluded: true }), file("r/j/b.md")], opts);
    expect(outline(tree.children)).toEqual(["chapter:j", "  page:b", "chapter:k", "  page:a"]);
  });

  it("ein Kapitel nur mit Einleitungsseite bleibt erhalten", () => {
    const tree = buildBookTree("r", [file("r/k/README.md")], README);
    expect(outline(tree.children)).toEqual(["chapter:k [r/k/README.md]"]);
  });
});

describe("buildBookTree — Titel", () => {
  it("chapter_title schlägt alles, auch die Überschrift", () => {
    const f = file("b/x.md", { chapterTitle: "Mein Titel", headingTitle: "Überschrift" });
    expect(outline(buildBookTree("b", [f], OFF).children)).toEqual(["page:Mein Titel"]);
    expect(outline(buildBookTree("b", [f], { ...OFF, titleFromHeading: false }).children)).toEqual(["page:Mein Titel"]);
  });

  it("nimmt mit titleFromHeading die Überschrift, ohne Überschrift den Namen", () => {
    const files = [file("b/mit.md", { headingTitle: "Erklärung: Das Farbsystem" }), file("b/ohne.md")];
    // Sortiert wird nach dem Namen (mit < ohne), nicht nach dem Titel.
    expect(outline(buildBookTree("b", files, OFF).children)).toEqual(["page:Erklärung: Das Farbsystem", "page:ohne"]);
  });

  it("nimmt mit titleFromHeading: false immer den Namen", () => {
    const files = [file("b/mit.md", { headingTitle: "Überschrift" })];
    expect(outline(buildBookTree("b", files, { ...OFF, titleFromHeading: false }).children)).toEqual(["page:mit"]);
  });

  it("der Name läuft nur mit dem Schalter durch die Namensregel", () => {
    const f = file("b/01 - Der Anfang.md");
    expect(outline(buildBookTree("b", [f], OFF).children)).toEqual(["page:01 - Der Anfang"]);
    expect(outline(buildBookTree("b", [f], { numberPrefix: true, introNames: [], titleFromHeading: false }).children)).toEqual(["page:Der Anfang"]);
  });
});

describe("flattenPages", () => {
  it("liefert die Wurzel-Einleitung, dann je Kapitel die Einleitung vor den Kindern, tiefenzuerst", () => {
    const tree = buildBookTree("docs", nvimFiles(), { numberPrefix: false, introNames: ["README"], titleFromHeading: true });
    expect(pathsOf(tree)).toEqual([
      "docs/README.md",
      "docs/0 - Entwurf/a.md",
      "docs/explanation/farbsystem.md",
      "docs/reference/handbuch/README.md",
      "docs/reference/handbuch/01-x.md",
      "docs/STAND.md",
      "docs/tutorials/README.md",
      "docs/tutorials/lektion-01-a.md",
      "docs/tutorials/lektion-02-b.md",
    ]);
  });

  it("ist leer für einen Baum ohne Seiten", () => {
    expect(flattenPages(buildBookTree("docs", [], OFF))).toEqual([]);
  });
});

describe("fileInputFromNote", () => {
  it("liest chapter_title, epub_exclude und die erste Überschrift", () => {
    const input = fileInputFromNote({
      path: "d/x.md",
      frontmatter: { chapter_title: "Kapitel", epub_exclude: true },
      body: "Vorspann\n\n## Titel\n",
    });
    expect(input).toEqual({ path: "d/x.md", chapterTitle: "Kapitel", headingTitle: "Titel", excluded: true });
  });

  it("ignoriert leere oder falsch typisierte Werte", () => {
    expect(fileInputFromNote({ path: "d/x.md", frontmatter: { chapter_title: "  ", epub_exclude: "true" }, body: "kein Titel" })).toEqual({
      path: "d/x.md",
      chapterTitle: null,
      headingTitle: null,
      excluded: false,
    });
    expect(fileInputFromNote({ path: "d/x.md", frontmatter: { chapter_title: 5, epub_exclude: false }, body: "" }).chapterTitle).toBeNull();
  });

  it("liest die Überschrift auch bei Windows-Zeilenenden", () => {
    expect(fileInputFromNote({ path: "d/x.md", frontmatter: {}, body: "# Titel\r\nText\r\n" }).headingTitle).toBe("Titel");
  });
});
