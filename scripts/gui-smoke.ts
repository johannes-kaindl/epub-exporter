/**
 * GUI-Smoke — faehrt die Pruefpunkte aus `docs/SMOKE.md` gegen ein **laufendes** Obsidian.
 *
 * Warum es das gibt (CORE-TEST-02): was gegen einen Mock geprueft ist, ist spezifiziert,
 * nicht getestet. Die vitest-Suite kennt `dom-to-xhtml` nur gegen einen Fake-DOM — ob
 * **Obsidian selbst** so rendert, wie die Engine es erwartet, sagt sie nicht. Und der
 * Code-Block-Hijack-Guard ist gegen einen Mock **prinzipiell** nicht pruefbar: er existiert
 * genau deshalb, weil `MarkdownRenderer.render` alle Prozessoren fremder Plugins ausfuehrt.
 *
 * Bruecke, Vault-Aufbau und Aufnahme-Primitive kommen zentral aus dem Dach
 * (`obsidian-plugins/tools/obsidian-cdp/`); dieser Treiber importiert sie und vendort
 * nichts. Im Repo bleiben nur Pruefpunkte, Fixture und Vertrag.
 *
 * ## Ablauf
 *
 * Gelaufen wird in einer **Zweitinstanz** mit eigenem Profil und eigenem Port (Dach-AGENTS
 * § Staging-Vaults) — nie in der regulaeren Instanz, nie per Quit:
 *
 * ```bash
 * npm run build
 * npm run smoke:gui -- --setup --port <port>   # Staging-Vault aus dem Fixture herstellen
 * #   Profil UD=/tmp/obs-test-epub-exporter: aktuelle obsidian-*.asar hineinkopieren, Vault und
 * #   "language":"en" in $UD/obsidian.json eintragen, mit --user-data-dir="$UD" und
 * #   --remote-debugging-port=<port> starten (vorher: lsof -nP -iTCP:<port> -sTCP:LISTEN)
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label epub-exporter \
 *   --intent "GUI-Smoke" --exclusive focus --port <port> --ttl 300
 * npm run smoke:gui -- --port <port>           # Vertrauensdialog und Restricted Mode erledigt der Treiber
 * npm run smoke:gui -- --port <port> --only S4 # einen Punkt nachziehen
 * npm run smoke:gui -- --list                  # Vertrag anzeigen
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py release
 * ```
 *
 * `--port` ist Pflicht (auch als `CDP_PORT` lesbar): ohne Angabe bricht der Treiber ab, statt
 * auf die reguläre Instanz (9222) zu greifen. Je Messlauf ein frischer Prozess.
 *
 * Bilanz in vier Zustaenden (CORE-TEST-19, `tools/obsidian-cdp/bilanz.ts`): gruen · rot ·
 * uebersprungen · nichts gemessen. `PUNKTE` ist der Nenner; ein nie aufgezeichneter Punkt
 * zaehlt als „nichts gemessen“ und setzt Exit 1, ein Abbruch ist Exit 2.
 *
 * ## Fallen, die dieser Treiber bereits umgeht (alle real getreten)
 *
 * 1. **`cdp.evaluate` nimmt einen FUNKTIONSKOERPER, keinen Ausdruck.** Die Bruecke wickelt
 *    den String in `(async () => { … })()`; ein Ausdruck ohne `return` ist immer
 *    `undefined`, also falsy — jedes Warten laeuft in seinen Timeout, waehrend der Zustand
 *    laengst da ist. Deshalb wird hier ausschliesslich `requireUntil` benutzt: das setzt
 *    das `return` selbst und **wirft** bei Zeitablauf, statt `null` zu liefern.
 * 2. **Plugin-eigene Anker, nie eine nackte Obsidian-Klasse.** `.view-action` trifft
 *    Obsidians Lesezeichen-Knopf, `.notice` den globalen Toast, in den jedes der Plugins
 *    im Vault schreibt. Hier wird ueber `.epub-sb-…` eingestiegen.
 * 3. **Effekt messen, nicht Ursache.** Kein Spy um eine Plugin-Methode: ein Wrapper, der
 *    beim Aufraeumen liegen bleibt, verschluckt danach still jeden Aufruf und sieht wie ein
 *    Produktfehler aus (llm-lab, 2026-08-30). Gemessen wird die entstandene Datei und der
 *    Dateiinhalt der Buch-Notiz.
 * 4. **Ein Deploy laedt das Plugin nicht neu.** Der Vault-Plugin-Ordner ist eine Kopie,
 *    kein Symlink; ein veralteter Build maskiert sich als Code-Bug. `ladePluginNeu()` der
 *    Bruecke holt das nach — inklusive `loadManifests`, sonst bleibt die Versionsangabe der
 *    Stand vom App-Start (json_viewer, 2026-08-22) — und prueft mit `repoMainJs` vorher, dass
 *    der Build im Vault der gebaute Repo-Stand ist (`requireEigenerBuild`, CORE-TEST-08 a).
 * 5. **Schreibende Pruefpunkte fassen die Fixture-Buch-Notiz nicht an.** R1–R3 und E1–E3
 *    laufen gegen eine eigene, zur Laufzeit angelegte Smoke-Buch-Notiz. Sonst waeren die
 *    README-Bilder an das Aufraeumen dieses Treibers gekoppelt — zwei Werkzeuge, ein
 *    Fixture, und der Fehlschlag des einen beschaedigt still das andere.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { argv, cwd, env } from "node:process";

import {
  attachTo,
  beimAbbruch,
  bereiteInstanzVor,
  Cdp,
  clearNotices,
  clickReal,
  closeExtraLeaves,
  istAbgebrochen,
  ladePluginNeu,
  openExisting,
  pollUntil,
  requireUntil,
  requireVisible,
  schliesseDialog,
} from "../../tools/obsidian-cdp/cdp.js";
import { createBilanz, parseArgs, runDriver, Vorbedingung } from "../../tools/obsidian-cdp/bilanz.js";
import { messeErreichbarkeit } from "../../tools/obsidian-cdp/pflichtpunkte.js";
import { capture } from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "epub-exporter";
const PLUGIN_ID = "epub-exporter";
/** Vault-Name = Repo-Name. Der Filter in `attachTo` haengt daran. */
const VAULT_NAME = REPO_NAME;
/** Pflicht: `--port` oder `CDP_PORT`; gesetzt in `main()`. Kein Default 9222 (reguläre Instanz). */
let PORT = 0;

/** Soll-Liste (Nenner der Bilanz). C0 und C1 rahmen die Pruefpunkte (Rest-Stub / Aufraeumprotokoll). */
const PUNKTE = [
  "C0", "S1", "S2", "S3", "S6", "S4", "S5", "X1", "R1", "R2", "R3", "E1", "E2", "E3", "T1", "T2", "T3", "F1", "O1", "O2", "O3", "O4", "O5", "C1",
] as const;
type PunktId = (typeof PUNKTE)[number];

const REPO_ROOT = cwd();
const FIXTURE_DIR = join(REPO_ROOT, "docs", "images", "fixture");

/** Die Fixture-Pfade, wie sie IM VAULT liegen. */
const BOOK = "Notes from the Salt Marsh.md";
const BOOK_TITLE = "Notes from the Salt Marsh";
const FIRST_CHAPTER = "Chapters/01 - The Tide Line.md";
const SPINE_TITLES = [
  "01 - The Tide Line",
  "02 - Grey Weather",
  "03 - The Heron",
  "04 - Low Water",
  "05 - Going Back",
];

/** Eigenes Pruefmaterial fuer die schreibenden Punkte — beruehrt das Bild-Fixture nicht. */
const SMOKE_DIR = "_smoke";
const SMOKE_BOOK = `${SMOKE_DIR}/Smoke Book.md`;
const SMOKE_EPUB = `${SMOKE_DIR}/Smoke Book.epub`;
const SMOKE_BOOK_TITLE = "Smoke Book";
const SMOKE_COVER = `${SMOKE_DIR}/Smoke Book cover.png`;
const SMOKE_PROMPT = "a smoke test cover, plain red";
/** F1: eine Notiz mit eigenem Block, der eine Flow-Liste und einen Kommentar enthaelt — beides verliert `processFrontMatter`. */
const SMOKE_FM_NOTE = `${SMOKE_DIR}/Smoke Frontmatter.md`;
const SMOKE_FM_EIGEN = "title: Mein Buch\nfoo: [a, b]\n# Hinweis\n";
const SMOKE_FM_VORHER = `---\n${SMOKE_FM_EIGEN}---\nBody\n`;
/** Die Felder der Buch-Vorlage, unabhaengig vom Plugin-Code aufgeschrieben (der Treiber ist nicht sein eigenes Orakel). */
const SMOKE_FM_FELDER = [
  "epub", "title", "author", "language", "cover", "description", "date", "publisher", "identifier", "series", "series_index", "subject", "rights",
];
/** Ein gueltiges 1x1-PNG (rot). Der Stub liefert es statt eines gerechneten Bildes —
 *  geprueft wird, DASS Bytes im Vault ankommen, nicht wie sie aussehen. */
const STUB_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const FIXTURE_EPUB = "Notes from the Salt Marsh.epub";
/** Der Code, der den Hijack-Guard belegt. Bewusst mit Sonderzeichen, die eine
 *  HTML-Entitaeten-Wandlung sichtbar machen wuerden. */
const SMOKE_CODE = 'const x = a < b && c > d ? "ja" : "nein";';
const SMOKE_CHAPTERS = [
  { pfad: `${SMOKE_DIR}/S1 Erstes.md`, body: "# Erstes\n\nEin Absatz.\n" },
  {
    pfad: `${SMOKE_DIR}/S2 Zweites.md`,
    body: `# Zweites\n\n\`\`\`js\n${SMOKE_CODE}\n\`\`\`\n`,
  },
  { pfad: `${SMOKE_DIR}/S3 Drittes.md`, body: "# Drittes\n\nNoch ein Absatz.\n" },
];
/** Der dritte Embed traegt einen Alias — R3 prueft, dass er den Reorder woertlich
 *  ueberlebt. `reorderSpine` permutiert rohe Zeilen, statt sie zu regenerieren; ein
 *  regenerierender Fix waere an R1/R2 unsichtbar. */
const SMOKE_ALIAS = "Drittes|Der dritte Teil";
const SMOKE_SPINE = [
  "![[S1 Erstes]]",
  "![[S2 Zweites]]",
  `![[${SMOKE_ALIAS}]]`,
];
const SMOKE_BOOK_BODY =
  "---\n" +
  "epub: true\n" +
  "title: Smoke Book\n" +
  "author: GUI-Smoke\n" +
  "language: en\n" +
  "---\n\n" +
  "# Smoke Book\n\n" +
  SMOKE_SPINE.join("\n\n") +
  "\n";

interface Pruefpunkt {
  id: string;
  was: string;
  /** Liefert `null` bei Erfolg, sonst den Grund — als Klartext, der die Fehlersuche
   *  traegt. CORE-TEST-14: eine Bilanzzeile ohne Eingabe und Antwort blockiert sie. */
  pruefe: (cdp: Cdp) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

/** Panel oeffnen und auf gerenderten Inhalt warten. Idempotent. */
async function oeffnePanel(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    const vorhanden = app.workspace.getLeavesOfType("epub-exporter-hub");
    if (vorhanden.length === 0) {
      await app.commands.executeCommandById("epub-exporter:open-sidebar");
    }
    return true;
  `);
  await requireUntil(cdp, `document.querySelector(".epub-sb-header")`, "Panel erschien nicht");
}

/** Notiz oeffnen und warten, bis das Panel ihren Kontext uebernommen hat. Das Panel folgt
 *  dem aktiven Blatt ueber `active-leaf-change`; ohne die Wartephase misst der naechste
 *  Punkt den vorherigen Kontext — und ist dabei gruen. */
async function oeffneUndWarte(cdp: Cdp, pfad: string, erwartet: string): Promise<void> {
  const ok = await openExisting(cdp, pfad, "preview");
  if (!ok) throw new Error(`Notiz ${pfad} liess sich nicht oeffnen (gerendert?)`);
  await requireUntil(
    cdp,
    erwartet,
    `Panel uebernahm den Kontext von ${pfad} nicht (Bedingung: ${erwartet})`,
  );
}

/** Dateiinhalt aus dem Vault lesen — ueber die Obsidian-API, damit ungespeicherte
 *  Editor-Zustaende nicht am Treiber vorbeilaufen. */
async function leseDatei(cdp: Cdp, pfad: string): Promise<string | null> {
  return cdp.evaluate<string | null>(`
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(pfad)});
    if (!f) return null;
    return await app.vault.read(f);
  `);
}

async function schreibeDatei(cdp: Cdp, pfad: string, body: string): Promise<void> {
  await cdp.evaluate(`
    const pfad = ${JSON.stringify(pfad)};
    const body = ${JSON.stringify(body)};
    const ordner = pfad.split("/").slice(0, -1).join("/");
    if (ordner && !app.vault.getAbstractFileByPath(ordner)) await app.vault.createFolder(ordner);
    const f = app.vault.getAbstractFileByPath(pfad);
    if (f) await app.vault.modify(f, body);
    else await app.vault.create(pfad, body);
    return true;
  `);
}

/** In den Papierkorb, nicht per Hard-Delete — der Lauf laeuft in einem echten Vault. */
async function inDenPapierkorb(cdp: Cdp, pfade: string[]): Promise<void> {
  await cdp.evaluate(`
    for (const pfad of ${JSON.stringify(pfade)}) {
      const f = app.vault.getAbstractFileByPath(pfad);
      if (f) await app.fileManager.trashFile(f);
    }
    return true;
  `);
}

/** Alle Overlays schliessen — vor jedem Punkt, nicht nur nach dem, der eines geoeffnet hat.
 *  Ein stehengebliebenes Modal laesst den NAECHSTEN Punkt scheitern, und der Fehlschlag
 *  zeigt dann auf den falschen Pruefpunkt. */
async function schliesseUeberlagerungen(cdp: Cdp): Promise<void> {
  // Schliessen-Knopf in beiden Formen (`.modal-close-button` bis 1.12, `.modal-header-button` ab 1.14).
  await schliesseDialog(cdp, { escapeRueckfall: false });
  await cdp.evaluate(`
    document.querySelectorAll(".menu").forEach((m) => m.remove());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    return true;
  `);
}

/** Obsidians globalen Toast leeren. Er gehoert nicht dem Plugin — jedes der Plugins im
 *  Vault schreibt hinein, und ein fremder Text, der zufaellig passt, macht einen
 *  Pruefpunkt **gruen am Falschen**. */
async function leereNotices(cdp: Cdp): Promise<void> {
  await clearNotices(cdp);
}

/** Ob irgendein `.notice` in einem der Dokumente (Hauptfenster, `activeDocument`) den Text traegt. */
function noticeEnthaelt(text: string): string {
  return `(() => {
    const docs = new Set([document]);
    if (typeof activeDocument !== "undefined" && activeDocument) docs.add(activeDocument);
    for (const d of docs) for (const n of d.querySelectorAll(".notice")) if (n.textContent.includes(${JSON.stringify(text)})) return true;
    return false;
  })()`;
}

/** Auf eine Datei im Vault warten und ihren Pfad im Dateisystem liefern. */
async function warteAufDatei(cdp: Cdp, pfad: string, frist = 20_000): Promise<string> {
  await requireUntil(
    cdp,
    `app.vault.getAbstractFileByPath(${JSON.stringify(pfad)})`,
    `Datei ${pfad} entstand nicht`,
    frist,
  );
  return join(stagingVaultDir(REPO_NAME), pfad);
}

// ---------------------------------------------------------------------------
// ZIP-Leser — nur so viel, wie die Pruefpunkte brauchen
// ---------------------------------------------------------------------------

interface ZipEintrag {
  name: string;
  /** 0 = stored (unkomprimiert), 8 = deflate. */
  methode: number;
  daten: Buffer;
}

/**
 * Die lokalen Header sequenziell durchlaufen.
 *
 * Zulaessig, weil dieser Writer die Groessen **vor** dem Schreiben kennt und sie in den
 * lokalen Header setzt (kein Data-Descriptor). Ein Scan nach der Signatur `PK\x03\x04`
 * waere dagegen falsch: sie kann in Nutzdaten vorkommen.
 */
function liesZip(buf: Buffer): ZipEintrag[] {
  const eintraege: ZipEintrag[] = [];
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const methode = buf.readUInt16LE(p + 8);
    const groesse = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString("utf8");
    const start = p + 30 + nameLen + extraLen;
    eintraege.push({ name, methode, daten: buf.subarray(start, start + groesse) });
    p = start + groesse;
  }
  return eintraege;
}

// ---------------------------------------------------------------------------
// Ordnermodus (O1–O5): Wegwerf-Baum, Menue und Zustand des Plugins
// ---------------------------------------------------------------------------

/** Wurzel des Wegwerf-Materials fuer O1–O5. Bewusst NICHT `_smoke`: dort liegen die Notizen der Buch-Punkte,
 *  und ein Ordner-Export von `_smoke` wuerde sie als Kapitel einsammeln. */
const O_DIR = "_smoke-ordner";
const O_ROOT = `${O_DIR}/Handbuch`;
const O_TIEF = `${O_DIR}/Tief`;
const O_PROBE = `${O_DIR}/O5`;
/** Arbeitsverzeichnis der Arbeitskopie (O4); die Kopie spiegelt den Vault-Pfad des Originals darunter. */
const O_ARBEIT = "_smoke-arbeit";
const O_KOPIE = `${O_ARBEIT}/${O_ROOT}`;
const O_EPUB = `${O_DIR}/Handbuch.epub`;
const O_HILFSORDNER = `${O_KOPIE}.epub-exporter-tmp`;
/** Die Einstellungen, unter denen O1–O4 messen: Zahlenregel an, README als Einleitungsseite, Seitentitel aus der Ueberschrift. */
const O_EINSTELLUNGEN = {
  folderNumberPrefix: true,
  folderIntroNames: "README",
  folderPageTitle: "heading",
  outputDestination: "besideNote",
  workDir: "",
  useWorkCopy: false,
};

/** Der Baum, wie ein Doku-Ordner aussieht: zwei `README.md` in verschiedenen Ordnern, ein Name ohne Ueberschrift,
 *  ein ausgeblendeter Ordner (`0 - …`) und eine ausgeblendete Seite (`000_…`), ein Teilbaum mit Tiefe 3.
 *  Die MARKER stehen im Text, damit ein Kapitel im Archiv an seinem Inhalt erkannt wird, nicht an seiner Nummer. */
const O_BAUM: Array<{ pfad: string; body: string }> = [
  { pfad: `${O_ROOT}/README.md`, body: "# Handbuch Start\n\nMARKER-WURZEL-INTRO\n" },
  { pfad: `${O_ROOT}/01 - Anfang/README.md`, body: "# Anfang\n\nMARKER-ANFANG-INTRO\n" },
  {
    pfad: `${O_ROOT}/01 - Anfang/01 - Erste Schritte.md`,
    body: "# Erste Schritte\n\nMARKER-ERSTE\n\nNachbar: [Einleitung](README.md). Wurzel: [Start](../README.md#start). Draussen: [weg](../../Ausserhalb.md).\n",
  },
  { pfad: `${O_ROOT}/01 - Anfang/02 - Zweites.md`, body: "# Zweite Seite\n\nMARKER-ZWEITE\n" },
  { pfad: `${O_ROOT}/01 - Anfang/03 - Namenstitel.md`, body: "Nur Text, keine Ueberschrift. MARKER-NAMENSTITEL\n" },
  { pfad: `${O_ROOT}/02 - Vertiefung/README.md`, body: "# Vertiefung\n\nMARKER-VERTIEFUNG-INTRO\n" },
  {
    pfad: `${O_ROOT}/02 - Vertiefung/01 - Details.md`,
    body: "# Details\n\nMARKER-DETAILS\n\nHier: [README](README.md). Anfang: [A](../01%20-%20Anfang/README.md#a).\n",
  },
  { pfad: `${O_ROOT}/02 - Vertiefung/Tiefer/Noch tiefer/01 - Ganz unten.md`, body: "# Ganz unten\n\nMARKER-UNTEN\n" },
  { pfad: `${O_ROOT}/0 - Entwurf/geheim.md`, body: "# Geheim\n\nMARKER-GEHEIM\n" },
  { pfad: `${O_ROOT}/000_Notiz.md`, body: "# Notiz\n\nMARKER-GEHEIM-SEITE\n" },
  { pfad: `${O_ROOT}/Lose Seite.md`, body: "# Lose Seite\n\nMARKER-LOSE\n" },
];
const O_PNG = `${O_ROOT}/img/x.png`;
/** Die Vorschau, die dieser Baum ergeben muss — von Hand aus der Regel gelesen (Design § 5.1–5.4), nicht aus dem Plugin. */
const O_ZEILEN: Array<{ titel: string; tiefe: number; art: "chapter" | "page" }> = [
  { titel: "Handbuch Start", tiefe: 0, art: "page" },
  { titel: "Anfang", tiefe: 0, art: "chapter" },
  { titel: "Erste Schritte", tiefe: 1, art: "page" },
  { titel: "Zweite Seite", tiefe: 1, art: "page" },
  { titel: "Namenstitel", tiefe: 1, art: "page" },
  { titel: "Vertiefung", tiefe: 0, art: "chapter" },
  { titel: "Details", tiefe: 1, art: "page" },
  { titel: "Tiefer", tiefe: 1, art: "chapter" },
  { titel: "Noch tiefer", tiefe: 2, art: "chapter" },
  { titel: "Ganz unten", tiefe: 3, art: "page" },
  { titel: "Lose Seite", tiefe: 0, art: "page" },
];
const O_AUSGEBLENDET = 2;

/** Der Einstellungsstand vor dem ersten O-Punkt; `cleanupState` stellt ihn wieder her. */
let oEinstellungenVorher: string | null = null;
/** `nativeMenus` vor dem ersten O-Punkt (`null` = Obsidians Standard, unter macOS das native Menue). */
let oNativeMenusVorher: { wert: unknown } | null = null;

/** Warten auf ein Verhalten des Plugins: laeuft die Frist ab, ist das ein Befund (rot, mit Grund), kein Abbruch des Treibers.
 *  `requireUntil` bleibt fuer den Aufbau (Material herstellen, Fenster oeffnen), dessen Scheitern „nichts gemessen“ heisst. */
async function erwarte(cdp: Cdp, ausdruck: string, grund: string, fristMs = 10_000): Promise<string | null> {
  const ok = await pollUntil<boolean>(cdp, `return (${ausdruck});`, fristMs, 200);
  return ok ? null : `${grund} (nach ${fristMs / 1000} s)`;
}

const warteMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function schreibeBinaer(cdp: Cdp, pfad: string, base64: string): Promise<void> {
  await cdp.evaluate(`
    const pfad = ${JSON.stringify(pfad)};
    const ordner = pfad.split("/").slice(0, -1).join("/");
    if (ordner && !app.vault.getAbstractFileByPath(ordner)) await app.vault.createFolder(ordner);
    const bin = atob(${JSON.stringify(base64)});
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (!app.vault.getAbstractFileByPath(pfad)) await app.vault.createBinary(pfad, bytes.buffer);
    return true;
  `);
}

async function ordnerEinstellungen(cdp: Cdp, patch: Record<string, unknown>): Promise<void> {
  await cdp.evaluate(`
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    Object.assign(p.settings, ${JSON.stringify(patch)});
    await p.saveSettings();
    const native = ${JSON.stringify(oNativeMenusVorher?.wert ?? null)};
    if (${JSON.stringify(oNativeMenusVorher !== null)}) app.vault.setConfig("nativeMenus", native === null ? undefined : native);
    return true;
  `);
}

/** Wegwerf-Material frisch herstellen: jeder O-Punkt beginnt hier, damit `--only` dasselbe misst wie der Gesamtlauf. */
async function legeOrdnerBaumAn(cdp: Cdp, mitTief = false): Promise<void> {
  if (oEinstellungenVorher === null) {
    oEinstellungenVorher = await cdp.evaluate<string>(`return JSON.stringify(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings);`);
  }
  if (oNativeMenusVorher === null) {
    // Unter macOS zeichnet Obsidian Menues nativ (NSMenu), nicht als `.menu` im DOM: der Rechtsklick wirkte, das Menue blieb unlesbar.
    // Im Wegwerf-Vault auf DOM-Menues stellen; der Wert vorher geht in die Aufraeumarbeit.
    oNativeMenusVorher = { wert: await cdp.evaluate<unknown>(`return app.vault.getConfig("nativeMenus") ?? null;`) };
  }
  await cdp.evaluate(`
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    p.folderSelection = null;
    await p.refreshHub();
    return true;
  `);
  await inDenPapierkorb(cdp, [O_DIR, O_ARBEIT]);
  await requireUntil(
    cdp,
    `!app.vault.getAbstractFileByPath(${JSON.stringify(O_DIR)}) && !app.vault.getAbstractFileByPath(${JSON.stringify(O_ARBEIT)})`,
    "Wegwerf-Ordner liessen sich nicht in den Papierkorb legen",
  );
  await ordnerEinstellungen(cdp, O_EINSTELLUNGEN);
  for (const k of O_BAUM) await schreibeDatei(cdp, k.pfad, k.body);
  await schreibeBinaer(cdp, O_PNG, STUB_PNG_BASE64);
  if (mitTief) {
    const tief = Array.from({ length: 8 }, (_, i) => `e${i + 1}`).join("/");
    await schreibeDatei(cdp, `${O_TIEF}/${tief}/seite.md`, "# Tiefe Seite\n\nMARKER-TIEF\n");
  }
  // Obsidians Metadaten-Cache braucht einen Atemzug, bevor die Frontmatter-Lesung der neuen Dateien stimmt.
  await warteMs(500);
}

/** Den Ordner im Datei-Explorer zeigen und mit der echten rechten Maustaste anklicken; das Menue bleibt offen. */
async function rechtsklickOrdner(cdp: Cdp, pfad: string): Promise<void> {
  // Unmittelbar vor dem Klick und mit Rueckfrage: ein frueher gesetzter Wert hielt in einem frischen Prozess nicht bis hierher (gemessen).
  const native = await cdp.evaluate<unknown>(`app.vault.setConfig("nativeMenus", false); return app.vault.getConfig("nativeMenus");`);
  if (native !== false) throw new Error(`nativeMenus liess sich nicht auf false stellen (liest ${JSON.stringify(native)}): das Menue wuerde nativ gezeichnet`);
  await cdp.evaluate(`
    app.workspace.leftSplit.expand();
    let leaf = app.workspace.getLeavesOfType("file-explorer")[0];
    if (!leaf) { leaf = app.workspace.getLeftLeaf(false); await leaf.setViewState({ type: "file-explorer" }); }
    app.workspace.revealLeaf(leaf);
    const ordner = app.vault.getAbstractFileByPath(${JSON.stringify(pfad)});
    if (!ordner) throw new Error("Ordner fehlt: " + ${JSON.stringify(pfad)});
    leaf.view.revealInFolder(ordner);
    return true;
  `);
  const titel = `[...document.querySelectorAll(".nav-folder-title")].find((e) => e.getAttribute("data-path") === ${JSON.stringify(pfad)})`;
  await requireUntil(
    cdp,
    `(() => { const e = ${titel}; return !!e && e.getBoundingClientRect().width > 0; })()`,
    `Der Ordner ${pfad} erschien nicht im Datei-Explorer`,
  );
  // Die Seitenleiste faehrt beim ersten Oeffnen aus: erst klicken, wenn die Lage des Ordners zweimal hintereinander gleich gemessen ist,
  // sonst trifft der Rechtsklick die Stelle, an der der Ordner eben noch stand (gemessen an einem frischen Prozess: kein Menue).
  const lage = `
    const e = ${titel};
    e.scrollIntoView({ block: "center" });
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  `;
  let box = await cdp.evaluate<{ x: number; y: number }>(lage);
  for (let i = 0; i < 20; i++) {
    await warteMs(150);
    const jetzt = await cdp.evaluate<{ x: number; y: number }>(lage);
    const stabil = jetzt.x === box.x && jetzt.y === box.y;
    box = jetzt;
    if (stabil) break;
  }
  const rechts = { x: box.x, y: box.y, button: "right", clickCount: 1 };
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...rechts, buttons: 0 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...rechts, buttons: 2 });
  await warteMs(60);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...rechts, buttons: 0 });
  const da = await pollUntil<boolean>(cdp, `return !!document.querySelector(".menu .menu-item");`, 8_000, 200);
  if (!da) {
    // Was der Klick traf, gehoert in die Meldung: ein Menue, das ausbleibt, hat selten nur eine Ursache.
    const lage = await cdp.evaluate<string>(`
      return JSON.stringify({
        modal: document.querySelectorAll(".modal-container").length, menus: document.querySelectorAll(".menu").length,
        aktiv: document.querySelectorAll(".has-active-menu").length, native: app.vault.getConfig("nativeMenus"), fokus: document.hasFocus(), sichtbar: document.visibilityState,
        links: app.workspace.leftSplit.collapsed,
      });
    `);
    throw new Error(`Das Kontextmenue des Ordners ${pfad} oeffnete sich nicht: ${lage}`);
  }
}

/** Die Eintraege des offenen Menues: Titel und ob ein Icon (svg) gezeichnet wurde. */
async function menueEintraege(cdp: Cdp): Promise<Array<{ titel: string; icon: boolean }>> {
  return cdp.evaluate(`
    return [...document.querySelectorAll(".menu .menu-item")].map((i) => ({
      titel: i.querySelector(".menu-item-title")?.textContent ?? "",
      icon: !!i.querySelector(".menu-item-icon svg"),
    }));
  `);
}

const MENUE_EINTRAG = (titel: string): string =>
  `[...document.querySelectorAll(".menu .menu-item")].find((i) => i.querySelector(".menu-item-title")?.textContent === ${JSON.stringify(titel)})`;

/** Ordnermodus wie im Gebrauch betreten: Rechtsklick, Klick auf „Create EPUB“, warten bis die Sidebar den Ordner zeigt. */
async function waehleOrdner(cdp: Cdp, pfad: string): Promise<void> {
  await rechtsklickOrdner(cdp, pfad);
  const getroffen = await clickReal(cdp, MENUE_EINTRAG("Create EPUB"), 80);
  if (!getroffen) throw new Error("Der Menue-Eintrag „Create EPUB“ liess sich nicht klicken");
  await requireUntil(
    cdp,
    `app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].folderSelection === ${JSON.stringify(pfad)} && !!document.querySelector(".epub-exporter-sidebar .epub-sb-source")`,
    `Die Sidebar zeigte den Ordner ${pfad} nicht`,
  );
}

interface VorschauZeile { titel: string; tiefe: number; art: string; icon: string }

/** Die Zeilen der Ordner-Vorschau, wie das DOM sie fuehrt. `art` kommt aus dem gezeichneten Icon, nicht aus dem Modell. */
async function leseVorschau(cdp: Cdp): Promise<VorschauZeile[]> {
  return cdp.evaluate(`
    return [...document.querySelectorAll(".epub-exporter-sidebar .epub-sb-tree > li.epub-sb-row")].map((li) => {
      const svg = li.querySelector(".epub-sb-row-icon svg");
      const icon = svg ? [...svg.classList].find((c) => c.startsWith("lucide-")) ?? "svg" : "";
      return {
        titel: li.querySelector(".epub-sb-row-title")?.textContent ?? "",
        tiefe: Number(li.getAttribute("data-depth")),
        art: icon.startsWith("lucide-folder") ? "chapter" : icon === "lucide-file-text" ? "page" : "?",
        icon,
      };
    });
  `);
}

function vergleicheZeilen(ist: VorschauZeile[], soll: typeof O_ZEILEN): string | null {
  const zeigIst = JSON.stringify(ist.map((z) => `${z.tiefe}:${z.art}:${z.titel}`));
  if (ist.length !== soll.length) return `${ist.length} Zeilen in der Vorschau, erwartet ${soll.length}: ${zeigIst}`;
  for (let i = 0; i < soll.length; i++) {
    const s = soll[i]!;
    const z = ist[i]!;
    if (z.titel !== s.titel || z.tiefe !== s.tiefe || z.art !== s.art) {
      return `Zeile ${i + 1}: ist ${z.tiefe}:${z.art}:${JSON.stringify(z.titel)}, soll ${s.tiefe}:${s.art}:${JSON.stringify(s.titel)} — alle: ${zeigIst}`;
    }
  }
  return null;
}

/** Den Export-Knopf einmal mit Haltedauer klicken und die entstandene Datei als Bytes lesen (Groesse stabil, dann gelesen). */
async function exportiereOrdnerRoh(cdp: Cdp, ziel: string): Promise<Buffer> {
  await inDenPapierkorb(cdp, [ziel]);
  await requireUntil(cdp, `!app.vault.getAbstractFileByPath(${JSON.stringify(ziel)})`, `${ziel} liess sich nicht entfernen`);
  await leereNotices(cdp);
  const getroffen = await clickReal(cdp, `document.querySelector(".epub-sb-action-export")`, 200);
  if (!getroffen) throw new Error("Export-Knopf im Ordnermodus nicht klickbar");
  const fsPfad = await warteAufDatei(cdp, ziel);
  let letzte = -1;
  for (let i = 0; i < 25; i++) {
    const groesse = existsSync(fsPfad) ? readFileSync(fsPfad).length : -1;
    if (groesse > 0 && groesse === letzte) break;
    letzte = groesse;
    await warteMs(200);
  }
  return readFileSync(fsPfad);
}

/** Wie `exportiereOrdnerRoh`, aber entpackt; ein Export ohne lesbare Datei ist ein Befund (Text), kein Abbruch des Treibers. */
async function exportiereOrdner(cdp: Cdp, ziel: string): Promise<Map<string, string> | string> {
  try {
    return entpacke(await exportiereOrdnerRoh(cdp, ziel));
  } catch (e) {
    return `Der Export lieferte kein lesbares EPUB (${ziel}): ${(e as Error).message}`;
  }
}

/** Ein EPUB entpacken: Name → Text. */
function entpacke(buf: Buffer): Map<string, string> {
  const alle = unzipSync(new Uint8Array(buf));
  return new Map(Object.entries(alle).map(([name, daten]) => [name, strFromU8(daten)]));
}

/** Die Eintraege des Inhaltsverzeichnisses in `nav.xhtml` (nur `epub:type="toc"`), mit Tiefe ab 0. */
function navEintraege(nav: string): Array<{ tiefe: number; titel: string; href: string }> {
  const ab = nav.search(/<nav\b[^>]*epub:type="toc"/);
  const bis = ab < 0 ? -1 : nav.indexOf("</nav>", ab);
  if (ab < 0 || bis < 0) return [];
  const teil = nav.slice(ab, bis);
  const aus: Array<{ tiefe: number; titel: string; href: string }> = [];
  let tiefe = 0;
  for (const m of teil.matchAll(/<(\/?)ol\b[^>]*>|<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (m[0].startsWith("<ol") || m[0].startsWith("</ol")) tiefe += m[1] === "/" ? -1 : 1;
    else aus.push({ tiefe: tiefe - 1, titel: (m[3] ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&"), href: m[2] ?? "" });
  }
  return aus;
}

/** Die `navPoint`-Knoten aus `toc.ncx`: Tiefe und `playOrder` in Dokumentreihenfolge. */
function ncxPunkte(ncx: string): Array<{ tiefe: number; playOrder: number }> {
  const aus: Array<{ tiefe: number; playOrder: number }> = [];
  let tiefe = 0;
  for (const m of ncx.matchAll(/<navPoint\b[^>]*playOrder="(\d+)"[^>]*>|<\/navPoint>/g)) {
    if (m[0] === "</navPoint>") tiefe -= 1;
    else { aus.push({ tiefe, playOrder: Number(m[1]) }); tiefe += 1; }
  }
  return aus;
}

/** Alles, was die O-Punkte am Plugin aendern, zurueck: Einstellungen wie vorgefunden, kein Ordnermodus, kein Eingriff an vault.copy. */
async function stelleOrdnerZustandWiederHer(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    delete app.vault.copy;
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    if (!p) return true;
    p.folderSelection = null;
    const vorher = ${JSON.stringify(oEinstellungenVorher)};
    if (vorher !== null) Object.assign(p.settings, JSON.parse(vorher));
    await p.saveSettings();
    return true;
  `);
}

// ---------------------------------------------------------------------------
// Die Pruefpunkte — der Vertrag aus docs/SMOKE.md, ausfuehrbar
// ---------------------------------------------------------------------------

const PRUEFPUNKTE: Pruefpunkt[] = [
  {
    id: "S1",
    was: "Sidebar oeffnet und hat Ausdehnung",
    pruefe: async (cdp) => {
      await oeffnePanel(cdp);
      const mass = await cdp.evaluate<{ leaves: number; breite: number; kacheln: number }>(`
        const el = document.querySelector(".epub-exporter-sidebar");
        return {
          leaves: app.workspace.getLeavesOfType("epub-exporter-hub").length,
          breite: el ? Math.round(el.getBoundingClientRect().width) : -1,
          kacheln: el ? el.getClientRects().length : 0,
        };
      `);
      if (mass.leaves !== 1) return `Leaves vom Typ epub-exporter-hub: ${mass.leaves}, erwartet 1`;
      // Ausdehnung statt blossem querySelector: ein Panel mit 0 px Breite ist vorhanden
      // und unsichtbar, und der Punkt waere gruen.
      if (mass.kacheln === 0) return "Panel im DOM, aber ohne Kachel (getClientRects() leer)";
      if (mass.breite <= 0) return `Panel im DOM, aber ${mass.breite} px breit`;
      return null;
    },
  },
  {
    id: "S2",
    was: "Buch-Notiz: Titel und 5 Kapitel in Spine-Reihenfolge",
    pruefe: async (cdp) => {
      await oeffnePanel(cdp);
      await oeffneUndWarte(cdp, BOOK, `document.querySelector(".epub-sb-chapter")`);
      const gesehen = await cdp.evaluate<{ titel: string; kapitel: string[] }>(`
        const wurzel = document.querySelector(".epub-exporter-sidebar");
        if (!wurzel) return { titel: "(kein Panel)", kapitel: [] };
        const sub = wurzel.querySelector(".epub-sb-subtitle");
        // :scope > erzwingt die direkte Kindschaft. Ein blosses querySelectorAll faende
        // Nachfahren beliebiger Tiefe — genau daran hat json_viewer zwei Werte aus
        // verschiedenen Ebenen verglichen (2026-08-22).
        const lis = wurzel.querySelectorAll(".epub-sb-chapters > li.epub-sb-chapter");
        return {
          titel: sub ? sub.textContent.trim() : "(kein Untertitel)",
          kapitel: Array.from(lis, (li) => {
            const t = li.querySelector(".epub-sb-chapter-title");
            return t ? t.textContent.trim() : "(ohne Titel)";
          }),
        };
      `);
      if (gesehen.titel !== BOOK_TITLE) {
        return `Untertitel ist ${JSON.stringify(gesehen.titel)}, erwartet ${JSON.stringify(BOOK_TITLE)}`;
      }
      if (gesehen.kapitel.length !== SPINE_TITLES.length) {
        return `${gesehen.kapitel.length} Kapitel im Panel, erwartet ${SPINE_TITLES.length}: ${JSON.stringify(gesehen.kapitel)}`;
      }
      for (let i = 0; i < SPINE_TITLES.length; i++) {
        if (gesehen.kapitel[i] !== SPINE_TITLES[i]) {
          return `Reihenfolge weicht ab an Position ${i + 1}: ${JSON.stringify(gesehen.kapitel)}`;
        }
      }
      return null;
    },
  },
  {
    id: "S3",
    was: "Kapitel-Notiz: Einzelnoten-Kontext statt Buch-Kontext",
    pruefe: async (cdp) => {
      await oeffnePanel(cdp);
      // Zuerst das Buch, damit ein toter Kontextwechsel auffaellt: bliebe das Panel
      // einfach stehen, waere es der Buch-Zustand und der Punkt rot. Ohne diesen
      // Vorzustand koennte ein nie befuelltes Panel den Punkt gruen machen.
      await oeffneUndWarte(cdp, BOOK, `document.querySelector(".epub-sb-chapter")`);
      await oeffneUndWarte(
        cdp,
        FIRST_CHAPTER,
        `!document.querySelector(".epub-sb-chapters > li.epub-sb-chapter")`,
      );
      const zustand = await cdp.evaluate<{ untertitel: string; kapitel: number; aktion: boolean; text: string }>(`
        const wurzel = document.querySelector(".epub-exporter-sidebar");
        if (!wurzel) return { untertitel: "", kapitel: -1, aktion: false, text: "(kein Panel)" };
        const sub = wurzel.querySelector(".epub-sb-subtitle");
        const btn = wurzel.querySelector(".epub-sb-action-export");
        return {
          untertitel: sub ? sub.textContent.trim() : "",
          kapitel: wurzel.querySelectorAll(".epub-sb-chapters > li.epub-sb-chapter").length,
          aktion: Boolean(btn && btn.getClientRects().length > 0),
          text: wurzel.textContent.trim().slice(0, 120),
        };
      `);
      // Die Aussage ist der KONTEXTWECHSEL, nicht ein bestimmter Endzustand. Das Plugin
      // kennt drei Kontexte — "book", "note" und "none" —, und eine offene Kapitel-Notiz
      // ist "note": Untertitel plus Einzelnoten-Aktionen, kein Kapitel-Block. Der
      // Empty-State gehoert zu "none" (gar keine Notiz offen) und wird in S6 geprueft.
      // Der erste Lauf hat hier "none" erwartet und das korrekte Verhalten als Defekt
      // gemeldet — eine Behauptung, die nur einen richtigen Ausgang kennt, ist bei
      // intaktem Code dauerhaft rot.
      if (zustand.kapitel > 0) {
        return `Panel zeigt noch ${zustand.kapitel} Kapitel — Kontextwechsel griff nicht. Panel-Text: ${JSON.stringify(zustand.text)}`;
      }
      if (zustand.untertitel !== "01 - The Tide Line") {
        return `Untertitel ist ${JSON.stringify(zustand.untertitel)}, erwartet den Kapitelnamen "01 - The Tide Line". Panel-Text: ${JSON.stringify(zustand.text)}`;
      }
      if (!zustand.aktion) {
        return `Keine sichtbare Export-Aktion im Einzelnoten-Kontext. Panel-Text: ${JSON.stringify(zustand.text)}`;
      }
      return null;
    },
  },
  {
    id: "S6",
    was: "Keine Notiz offen: sichtbarer Empty-State",
    pruefe: async (cdp) => {
      await oeffnePanel(cdp);
      await oeffneUndWarte(cdp, BOOK, `document.querySelector(".epub-sb-chapter")`);
      // Alle Markdown-Blaetter abraeumen — danach hat der Workspace keine aktive Datei,
      // und das ist der Kontext "none".
      await cdp.evaluate(`
        const zu = [];
        app.workspace.iterateRootLeaves((l) => zu.push(l));
        for (const l of zu) l.detach();
        await new Promise((r) => setTimeout(r, 400));
        return true;
      `);
      await requireUntil(
        cdp,
        `document.querySelector(".epub-sb-empty")`,
        "Kein Empty-State, obwohl keine Notiz offen ist",
      );
      const sichtbar = await cdp.evaluate<{ kacheln: number; text: string }>(`
        const el = document.querySelector(".epub-sb-empty");
        return { kacheln: el ? el.getClientRects().length : 0, text: el ? el.textContent.trim() : "" };
      `);
      if (sichtbar.kacheln === 0) return "Empty-State im DOM, aber ohne Kachel (unsichtbar)";
      if (!sichtbar.text) return "Empty-State ist sichtbar, aber ohne Text — der Hinweis fehlt";
      // Der Satz mit dem Einstieg (view.emptyHint): ein zweites Element unter dem ersten, sichtbar, und er
      // nennt den Befehl so, wie die Befehlspalette ihn fuehrt. Der Name kommt aus dem lebenden Befehlsregister
      // (nicht aus dem Quelltext): sonst waere der Punkt gruen, auch wenn Satz und Befehl auseinanderlaufen.
      // `befehl` leer heisst „Befehl nicht gefunden“, nie „enthaelt trivial“ (jeder Text enthaelt "").
      const hinweis = await cdp.evaluate<{ anzahl: number; kacheln: number; text: string; befehl: string; rueckfall: boolean }>(`
        const alle = document.querySelectorAll(".epub-sb-empty");
        const el = document.querySelector(".epub-sb-empty-hint");
        const cmd = app.commands.commands["epub-exporter:insert-book-frontmatter"];
        const name = cmd ? String(cmd.name) : "";
        return {
          anzahl: alle.length,
          kacheln: el ? el.getClientRects().length : 0,
          text: el ? el.textContent.trim() : "",
          befehl: name.includes(": ") ? name.slice(name.indexOf(": ") + 2) : name,
          rueckfall: !!el && el.textContent.trim() === "view.emptyHint",
        };
      `);
      if (!hinweis.befehl) return "Befehl insert-book-frontmatter nicht im Befehlsregister — der Hinweis laesst sich nicht gegenpruefen";
      if (hinweis.anzahl < 2 || !hinweis.text) return "Der Satz mit dem Einstieg (.epub-sb-empty-hint) fehlt unter dem Empty-State";
      if (hinweis.rueckfall) return "Der Hinweis zeigt den Schluessel statt des Textes (view.emptyHint nicht uebersetzt)";
      if (hinweis.kacheln === 0) return "Der Hinweis ist im DOM, aber ohne Kachel (unsichtbar)";
      if (!hinweis.text.includes(hinweis.befehl)) return `Der Hinweis nennt den Befehl nicht: „${hinweis.text}“ enthaelt nicht „${hinweis.befehl}“`;
      return null;
    },
  },
  {
    id: "S4",
    was: "Ein einziger Klick auf Exportieren erzeugt die Datei",
    pruefe: async (cdp) => {
      await oeffnePanel(cdp);
      await oeffneUndWarte(cdp, BOOK, `document.querySelector(".epub-sb-action-export")`);
      await inDenPapierkorb(cdp, [FIXTURE_EPUB]);
      await leereNotices(cdp);
      // Echter Mausklick MIT HALTEDAUER — beides ist noetig, und das zweite ist erst in
      // der Gegenprobe aufgefallen.
      //
      // `element.click()` scheidet aus, weil der Klick `isTrusted:false` traegt und an
      // den Host-Pfaden vorbeilaeuft, an denen der Defekt sass. Aber auch ein echter
      // Klick OHNE Pause geht daran vorbei: `clickReal` schickte `mousePressed` und
      // `mouseReleased` ohne Zwischenzeit, und der Rerender ist asynchron
      // (`await bridge.snapshot()` ist echtes I/O). Der Knopf ueberlebte also, obwohl er
      // im Gebrauch stirbt. Gemessen bei ausgebautem Fix: 0 ms → Export laeuft (Punkt
      // gruen trotz aktivem Defekt), 150 ms und 400 ms → Knopf weg, kein Export.
      //
      // Deshalb 200 ms: laenger als die gemessene Schwelle, kuerzer als ein Klick, den
      // ein Mensch als Halten empfaende.
      const getroffen = await clickReal(cdp, `document.querySelector(".epub-sb-action-export")`, 200);
      if (!getroffen) return "Export-Knopf nicht klickbar (kein Element getroffen)";
      try {
        await warteAufDatei(cdp, FIXTURE_EPUB);
      } catch (e) {
        const toast = await cdp.evaluate<string>(`
          const t = [];
          const docs = new Set([document]);
          if (typeof activeDocument !== "undefined" && activeDocument) docs.add(activeDocument);
          for (const d of docs) for (const n of d.querySelectorAll(".notice")) t.push(n.textContent.trim());
          return t.join(" | ");
        `);
        // Den Klartext des Prueflings mitliefern, nicht nur den Messwert: eine
        // Bilanzzeile "Datei entstand nicht" neben einer ungelesenen Meldung ist eine
        // Fehldiagnose mit Zahl (CORE-TEST-14).
        return `${(e as Error).message}${toast ? ` — Meldung des Plugins: ${JSON.stringify(toast)}` : " — und das Plugin meldete nichts"}`;
      }
      return null;
    },
  },
  {
    id: "S5",
    was: "Ribbon oeffnet die Sidebar und exportiert nicht",
    pruefe: async (cdp) => {
      await oeffneUndWarte(cdp, BOOK, `document.querySelector(".markdown-reading-view")`);
      await inDenPapierkorb(cdp, [FIXTURE_EPUB]);
      // Panel schliessen, damit "oeffnet die Sidebar" ueberhaupt eine Wirkung sein kann.
      await cdp.evaluate(`
        app.workspace.getLeavesOfType("epub-exporter-hub").forEach((l) => l.detach());
        await new Promise((r) => setTimeout(r, 300));
        return true;
      `);
      const getroffen = await clickReal(
        cdp,
        `document.querySelector('.side-dock-ribbon-action[aria-label*="EPUB" i], .side-dock-ribbon-action[aria-label*="book" i]')`,
      );
      if (!getroffen) {
        const vorhanden = await cdp.evaluate<string[]>(`
          return Array.from(
            document.querySelectorAll(".side-dock-ribbon-action"),
            (e) => e.getAttribute("aria-label") || "(ohne Label)",
          );
        `);
        return `Ribbon-Knopf nicht gefunden. Vorhandene Ribbon-Labels: ${JSON.stringify(vorhanden)}`;
      }
      await requireUntil(
        cdp,
        `app.workspace.getLeavesOfType("epub-exporter-hub").length > 0`,
        "Ribbon oeffnete die Sidebar nicht",
      );
      // Die zweite Haelfte der Behauptung, und die eigentliche: es darf NICHT exportiert
      // haben. Ohne sie waere der Punkt auch bei der alten Verdrahtung gruen, sobald das
      // Panel nebenbei aufging.
      const datei = await cdp.evaluate<boolean>(`
        return Boolean(app.vault.getAbstractFileByPath(${JSON.stringify(FIXTURE_EPUB)}));
      `);
      if (datei) return `Das Ribbon hat exportiert — ${FIXTURE_EPUB} entstand, obwohl es nur die Sidebar oeffnen soll`;
      return null;
    },
  },
  {
    id: "X1",
    was: "Teilen-Export fragt vor dem Loeschen fremder Dateien und behaelt sie bei „Nein“",
    pruefe: async (cdp) => {
      await schreibeSmokeBuch(cdp);
      await oeffneUndWarte(cdp, SMOKE_BOOK, `document.querySelector(".markdown-reading-view")`);
      const epub = `.epub-export/${SMOKE_BOOK_TITLE}.epub`;
      // `openWithDefaultApp` wuerde auf dem Mac die Standard-App starten; fuer den Lauf ersetzt, danach zurueck.
      await cdp.evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        window.__epubX1 = { dest: p.settings.outputDestination, open: app.openWithDefaultApp };
        p.settings.outputDestination = "share";
        app.openWithDefaultApp = async () => {};
        const a = app.vault.adapter;
        if (!(await a.exists(".epub-export"))) await a.mkdir(".epub-export");
        await a.write(".epub-export/keep.txt", "meine Datei");
        await a.write(".epub-export/old.epub", "alt");
        return true;
      `);
      try {
        await leereNotices(cdp);
        await cdp.evaluate(`app.commands.executeCommandById("epub-exporter:export-epub"); return true;`);
        // Die Rueckfrage ist ein Modal mit „Keep them“ — ohne sie waere der Export durchgelaufen und keep.txt weg.
        const frage = await cdp.evaluate<string | null>(`
          for (let i = 0; i < 40; i++) {
            const m = document.querySelector(".modal-container .modal");
            if (m && /keep\\s+them|behalten/i.test(m.textContent || "")) return m.textContent;
            await new Promise((r) => setTimeout(r, 250));
          }
          return null;
        `);
        if (frage === null) {
          const lage = await cdp.evaluate<string>(`
            const a = app.vault.adapter;
            return JSON.stringify({
              notices: [...document.querySelectorAll(".notice")].map((n) => n.textContent),
              dateien: (await a.list(".epub-export")).files,
              aktiv: app.workspace.getActiveFile()?.path ?? null,
            });
          `);
          return `Keine Rueckfrage erschienen — die fremde Datei wurde ungefragt behandelt (Lage: ${lage})`;
        }
        if (!frage.includes("keep.txt")) return `Die Rueckfrage nennt die Datei nicht: ${JSON.stringify(frage)}`;
        await cdp.evaluate(`
          const b = [...document.querySelectorAll(".modal-container .modal button")].find((x) => /keep\\s+them|behalten/i.test(x.textContent || ""));
          b.click();
          return true;
        `);
        await requireUntil(cdp, `(async () => await app.vault.adapter.exists(${JSON.stringify(epub)}))()`, "Der Export lief nach „Nein“ nicht weiter");
        const stand = await cdp.evaluate<{ keep: boolean; old: boolean }>(`
          const a = app.vault.adapter;
          return { keep: await a.exists(".epub-export/keep.txt"), old: await a.exists(".epub-export/old.epub") };
        `);
        if (!stand.keep) return "keep.txt wurde trotz „Nein“ geloescht";
        if (stand.old) return "Der eigene alte Export old.epub blieb stehen (haette still ersetzt werden muessen)";
        return null;
      } finally {
        await cdp.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          if (window.__epubX1) { p.settings.outputDestination = window.__epubX1.dest; app.openWithDefaultApp = window.__epubX1.open; delete window.__epubX1; }
          const a = app.vault.adapter;
          if (await a.exists(".epub-export")) await a.rmdir(".epub-export", true);
          return true;
        `).catch(() => undefined);
      }
    },
  },
  {
    id: "R1",
    was: "Alt+Pfeil-ab vertauscht Kapitel 1 und 2 IM DATEIINHALT",
    pruefe: async (cdp) => {
      await schreibeSmokeBuch(cdp);
      await oeffnePanel(cdp);
      await oeffneUndWarte(cdp, SMOKE_BOOK, `document.querySelector(".epub-sb-chapter")`);
      const vorher = await leseDatei(cdp, SMOKE_BOOK);
      await gesteAltAb(cdp, 0);
      const nachher = await requireDateiWechsel(cdp, SMOKE_BOOK, vorher ?? "");
      const spine = spineZeilen(nachher);
      if (spine.length !== 3) return `Spine hat ${spine.length} Zeilen statt 3: ${JSON.stringify(spine)}`;
      if (spine[0] !== SMOKE_SPINE[1] || spine[1] !== SMOKE_SPINE[0]) {
        return `Reihenfolge in der Datei nicht vertauscht: ${JSON.stringify(spine)}`;
      }
      return null;
    },
  },
  {
    id: "R2",
    was: "Zweites Alt+Pfeil-ab bewegt dasselbe Kapitel weiter (1 → 2 → 3)",
    pruefe: async (cdp) => {
      await schreibeSmokeBuch(cdp);
      await oeffnePanel(cdp);
      await oeffneUndWarte(cdp, SMOKE_BOOK, `document.querySelector(".epub-sb-chapter")`);
      const start = (await leseDatei(cdp, SMOKE_BOOK)) ?? "";
      await gesteAltAb(cdp, 0);
      const nachEins = await requireDateiWechsel(cdp, SMOKE_BOOK, start);
      // Die zweite Geste geht bewusst NICHT wieder an Position 0, sondern an die neue
      // Position des bewegten Elements. Genau da sass der historische Defekt: ein stale
      // focusIndex liess sie auf das alte Element zeigen, und das Kapitel pendelte.
      await gesteAltAb(cdp, 1);
      const nachZwei = await requireDateiWechsel(cdp, SMOKE_BOOK, nachEins);
      const spine = spineZeilen(nachZwei);
      if (spine[2] !== SMOKE_SPINE[0]) {
        return `Kapitel 1 steht nach zwei Gesten nicht an Position 3 — es pendelt: ${JSON.stringify(spine)}`;
      }
      return null;
    },
  },
  {
    id: "R3",
    was: "Embed mit Alias ueberlebt den Reorder woertlich",
    pruefe: async (cdp) => {
      await schreibeSmokeBuch(cdp);
      await oeffnePanel(cdp);
      await oeffneUndWarte(cdp, SMOKE_BOOK, `document.querySelector(".epub-sb-chapter")`);
      const start = (await leseDatei(cdp, SMOKE_BOOK)) ?? "";
      await gesteAltAb(cdp, 0);
      const nachher = await requireDateiWechsel(cdp, SMOKE_BOOK, start);
      const alias = `![[${SMOKE_ALIAS}]]`;
      if (!nachher.includes(alias)) {
        return `Der Alias-Embed ${JSON.stringify(alias)} steht nicht mehr woertlich in der Datei — der Spine wurde regeneriert statt permutiert. Spine jetzt: ${JSON.stringify(spineZeilen(nachher))}`;
      }
      return null;
    },
  },
  {
    id: "E1",
    was: "EPUB-Struktur: PK-Signatur, mimetype zuerst und unkomprimiert",
    pruefe: async (cdp) => {
      const buf = await exportiereSmokeBuch(cdp);
      if (buf.length < 4) return `Datei ist ${buf.length} Bytes gross`;
      const sig = buf.subarray(0, 4);
      if (!(sig[0] === 0x50 && sig[1] === 0x4b && sig[2] === 0x03 && sig[3] === 0x04)) {
        return `Kein ZIP: erste vier Bytes sind ${JSON.stringify(sig.toString("hex"))}`;
      }
      const eintraege = liesZip(buf);
      if (eintraege.length === 0) return "ZIP enthaelt keine lesbaren Eintraege";
      const erster = eintraege[0]!;
      if (erster.name !== "mimetype") {
        return `Erster Eintrag heisst ${JSON.stringify(erster.name)}, die EPUB-Spezifikation verlangt "mimetype"`;
      }
      if (erster.methode !== 0) {
        return `mimetype ist mit Methode ${erster.methode} komprimiert, die Spezifikation verlangt 0 (stored)`;
      }
      const inhalt = erster.daten.toString("utf8");
      if (inhalt !== "application/epub+zip") {
        return `mimetype enthaelt ${JSON.stringify(inhalt)}, erwartet "application/epub+zip"`;
      }
      return null;
    },
  },
  {
    id: "E2",
    was: "Alle Kapitel des Spine liegen als XHTML im Paket",
    pruefe: async (cdp) => {
      const buf = await exportiereSmokeBuch(cdp);
      const namen = liesZip(buf).map((e) => e.name);
      const xhtml = namen.filter((n) => /\.x?html$/i.test(n));
      // Titelei und Inhaltsverzeichnis zaehlen mit — gemessen wird deshalb "mindestens
      // so viele wie Kapitel", nicht eine exakte Zahl. Ein Punkt, der nur einen einzigen
      // richtigen Ausgang kennt, ist bei intaktem Code dauerhaft rot.
      if (xhtml.length < SMOKE_CHAPTERS.length) {
        return `${xhtml.length} XHTML-Dateien im Paket, erwartet mindestens ${SMOKE_CHAPTERS.length} (ein Kapitel je Spine-Eintrag). Enthalten: ${JSON.stringify(namen)}`;
      }
      return null;
    },
  },
  {
    id: "E3",
    was: "Fenced Code kommt woertlich im XHTML an (Hijack-Guard)",
    pruefe: async (cdp) => {
      const buf = await exportiereSmokeBuch(cdp);
      const eintraege = liesZip(buf).filter((e) => /\.x?html$/i.test(e.name) && e.methode === 0);
      if (eintraege.length === 0) {
        // Der Writer darf komprimieren (natives CompressionStream); dann ist der Inhalt
        // hier nicht ohne Entpacker lesbar. Das ist kein Defekt, sondern eine Grenze
        // dieses Pruefpunkts — und sie gehoert benannt, nicht als Fehlschlag getarnt.
        throw new Vorbedingung("XHTML liegt komprimiert vor, dieser Punkt liest nur unkomprimierte Eintraege");
      }
      const gesamt = eintraege.map((e) => e.daten.toString("utf8")).join("\n");
      // Rueckwaerts entschaerfen statt vorwaerts escapen.
      //
      // Der erste Lauf hat hier vorwaerts verglichen und dabei auch `"` zu `&quot;`
      // gemacht — im TEXTINHALT escaped XHTML aber nur `& < >`, Anfuehrungszeichen
      // brauchen es nur in Attributwerten. Der Punkt war rot, waehrend der Code
      // vollstaendig im Paket stand. Die Richtung ist deshalb keine Geschmacksfrage:
      // vorwaerts muss der Treiber JEDE Escaping-Entscheidung des Prueflings erraten,
      // rueckwaerts muss er sie nur aufloesen.
      const entschaerft = gesamt
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        // `&amp;` zuletzt, sonst wuerde aus `&amp;lt;` faelschlich `<`.
        .replace(/&amp;/g, "&");
      if (!entschaerft.includes(SMOKE_CODE)) {
        const codeBloecke = (gesamt.match(/<pre[\s\S]{0,200}?<\/pre>/gi) ?? []).slice(0, 2);
        return `Der Code aus dem Fenced Block fehlt im XHTML. Gesucht: ${JSON.stringify(SMOKE_CODE)}. Gefundene pre-Bloecke: ${JSON.stringify(codeBloecke)}`;
      }
      return null;
    },
  },
  {
    id: "T1",
    was: "Ohne Bildgenerator erscheint der Titelbild-Knopf nicht",
    pruefe: async (cdp) => {
      // Der Fall, der im Alltag bricht — ein Knopf, der erscheint und dann nichts
      // kann, ist schlimmer als keiner. Der Zustand wird HERGESTELLT, nicht
      // vorausgesetzt: seit dem Naht-Lauf (`smoke:e2e --setup`) liegt das
      // Nachbarplugin echt im selben Vault, und ein Punkt, der das nur hofft,
      // misst je nach Vorgeschichte etwas anderes.
      await entferneProviderStub(cdp);
      await deaktiviereEchtenAnbieter(cdp);
      await oeffnePanel(cdp);
      await schreibeSmokeBuch(cdp);
      await oeffneUndWarte(cdp, SMOKE_BOOK, `document.querySelector(".epub-sb-chapter")`);
      const da = await cdp.evaluate<boolean>(`
        return !!document.querySelector(".epub-sb-action-cover");
      `);
      await stelleAnbieterWiederHer(cdp);
      if (da) return "Titelbild-Knopf ist sichtbar, obwohl kein Bildgenerator vorhanden ist";
      return null;
    },
  },
  {
    id: "T2",
    was: "Mit Bildgenerator erscheint der Knopf und oeffnet den Dialog",
    pruefe: async (cdp) => {
      // Der Stub ersetzt das NACHBARPLUGIN, nicht unseren Code: geprueft wird
      // unsere Erkennung (Version + Form) und unsere UI gegen echtes DOM. Die
      // fremde Bilderzeugung selbst ist nicht Gegenstand dieses Repos — und ein
      // echter Lauf braeuchte eine GPU und Minuten.
      await setzeProviderStub(cdp);
      await oeffnePanel(cdp);
      await schreibeSmokeBuch(cdp);
      await oeffneUndWarte(cdp, SMOKE_BOOK, `document.querySelector(".epub-sb-chapter")`);
      await requireUntil(cdp, `document.querySelector(".epub-sb-action-cover")`,
        "Titelbild-Knopf erschien nicht, obwohl ein Bildgenerator gemeldet ist");

      await clickReal(cdp, `document.querySelector(".epub-sb-action-cover")`, 200);
      await requireUntil(cdp, `document.querySelector(".epub-cover-modal")`, "Titelbild-Dialog kam nicht");

      const vorbelegt = await cdp.evaluate<string>(`
        const ta = document.querySelector(".epub-cover-modal .epub-cover-prompt");
        return ta ? ta.value : "";
      `);
      await schliesseUeberlagerungen(cdp);
      await stelleAnbieterWiederHer(cdp);
      // Der Titel der Smoke-Notiz muss im Vorschlag stehen: sonst hat der Dialog
      // die Metadaten der Notiz nicht gelesen, sondern irgendetwas Generisches.
      if (!vorbelegt.includes(SMOKE_BOOK_TITLE)) {
        return `Prompt-Vorbelegung nennt den Buchtitel nicht: ${JSON.stringify(vorbelegt)}`;
      }
      return null;
    },
  },
  {
    id: "T3",
    was: "Erzeugtes Titelbild landet im Vault und cover:/cover_prompt: zeigen darauf",
    pruefe: async (cdp) => {
      await setzeProviderStub(cdp);
      await oeffnePanel(cdp);
      await schreibeSmokeBuch(cdp);
      await inDenPapierkorb(cdp, [SMOKE_COVER]);
      await oeffneUndWarte(cdp, SMOKE_BOOK, `document.querySelector(".epub-sb-chapter")`);
      await requireUntil(cdp, `document.querySelector(".epub-sb-action-cover")`, "Titelbild-Knopf fehlt");
      await clickReal(cdp, `document.querySelector(".epub-sb-action-cover")`, 200);
      await requireUntil(cdp, `document.querySelector(".epub-cover-modal")`, "Titelbild-Dialog kam nicht");

      await cdp.evaluate(`
        const ta = document.querySelector(".epub-cover-modal .epub-cover-prompt");
        ta.value = ${JSON.stringify(SMOKE_PROMPT)};
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      `);
      await clickReal(
        cdp,
        `Array.from(document.querySelectorAll(".epub-cover-modal button")).find((b) => b.classList.contains("mod-cta"))`,
        200
      );

      // Am DATEISYSTEM warten, nicht am DOM: der Dialog schliesst sich selbst,
      // und ein Punkt, der nur sein Verschwinden sieht, waere auch dann gruen,
      // wenn gar nichts geschrieben wurde.
      await requireUntil(
        cdp,
        `!!app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_COVER)})`,
        "Titelbild-Datei wurde nicht angelegt"
      );

      const notiz = (await leseDatei(cdp, SMOKE_BOOK)) ?? "";
      await schliesseUeberlagerungen(cdp);
      await stelleAnbieterWiederHer(cdp);

      if (!notiz.includes(`cover: "[[${SMOKE_COVER}]]"`)) {
        const kopf = notiz.split("---")[1] ?? notiz.slice(0, 200);
        return `cover: zeigt nicht auf die erzeugte Datei. Frontmatter: ${JSON.stringify(kopf)}`;
      }
      if (!notiz.includes(SMOKE_PROMPT)) {
        return "Der eingegebene Prompt wurde nicht als cover_prompt: in die Notiz zurueckgeschrieben";
      }
      return null;
    },
  },
  {
    id: "F1",
    was: "„Insert book frontmatter“ ergaenzt die Vorlage, eigene Zeilen (Flow-Liste, Kommentar) bleiben byte-gleich, ein zweiter Lauf aendert nichts",
    pruefe: async (cdp) => {
      await schreibeDatei(cdp, SMOKE_FM_NOTE, SMOKE_FM_VORHER);
      await oeffneUndWarte(cdp, SMOKE_FM_NOTE, `document.querySelector(".markdown-reading-view")`);
      await leereNotices(cdp);
      await cdp.evaluate(`app.commands.executeCommandById("epub-exporter:insert-book-frontmatter"); return true;`);
      // Die Meldung verschwindet nach rund 5 s: gleich nach dem Befehl lesen, nicht erst nach der Cache-Pruefung.
      const ergaenztDa = await pollUntil<boolean>(cdp, `return ${noticeEnthaelt("Book frontmatter added.")};`, 5_000, 200);
      if (!ergaenztDa) return "Die Meldung „Book frontmatter added.“ erschien nach dem ersten Lauf nicht";
      const nachher = await requireDateiWechsel(cdp, SMOKE_FM_NOTE, SMOKE_FM_VORHER);

      if (!nachher.startsWith(`---\n${SMOKE_FM_EIGEN}`)) {
        return `Die eigenen Zeilen blieben nicht byte-gleich am Anfang des Blocks. Block: ${JSON.stringify(nachher.split("---")[1] ?? nachher.slice(0, 200))}`;
      }
      if (!nachher.endsWith("---\nBody\n")) return `Der Rumpf der Notiz hat sich geaendert: ${JSON.stringify(nachher.slice(-40))}`;
      const fehlt = SMOKE_FM_FELDER.filter((k) => !new RegExp(`^${k}:`, "m").test(nachher));
      if (fehlt.length) return `Vorlagenfelder fehlen: ${fehlt.join(", ")}`;
      if (!/^epub: true$/m.test(nachher)) return "epub: steht nicht als Boolean `true` in der Notiz";
      if ((nachher.match(/^title:/gm) ?? []).length !== 1) return "title: steht nicht genau einmal im Block (ueberschrieben oder verdoppelt)";

      // Obsidian selbst muss das Ergebnis so lesen, wie es dasteht: Boolean, die Flow-Liste als Liste.
      await requireUntil(
        cdp,
        `(() => {
          const f = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_FM_NOTE)});
          const fm = f && app.metadataCache.getFileCache(f)?.frontmatter;
          return !!fm && fm.epub === true && JSON.stringify(fm.foo) === '["a","b"]' && fm.title === "Mein Buch";
        })()`,
        "Obsidians Metadaten-Cache liest die ergaenzte Notiz nicht als epub: true / foo: [a, b] / title: Mein Buch",
      );

      // Zweiter Lauf: nichts mehr zu ergaenzen, die Datei bleibt byte-gleich, und die Meldung sagt das.
      await leereNotices(cdp);
      await cdp.evaluate(`app.commands.executeCommandById("epub-exporter:insert-book-frontmatter"); return true;`);
      const vollstaendigDa = await pollUntil<boolean>(cdp, `return ${noticeEnthaelt("Book frontmatter is already complete.")};`, 5_000, 200);
      if (!vollstaendigDa) return "Die Meldung „Book frontmatter is already complete.“ erschien nach dem zweiten Lauf nicht";
      const stehtNoch = await cdp.evaluate<boolean>(`return ${noticeEnthaelt("Book frontmatter added.")};`);
      if (stehtNoch) return "Nach dem zweiten Lauf steht „Book frontmatter added.“ noch (oder wieder) da";
      const zweimal = (await leseDatei(cdp, SMOKE_FM_NOTE)) ?? "";
      if (zweimal !== nachher) return "Ein zweiter Lauf hat die Notiz erneut veraendert (nicht idempotent)";
      return null;
    },
  },
  {
    id: "O1",
    was: "Ordner-Rechtsklick: genau ein Eintrag „Create EPUB“, der Klick oeffnet die Sidebar im Ordnermodus mit der erwarteten Zeilenzahl; Icons und Schliessen-Knopf stehen am echten DOM",
    pruefe: async (cdp) => {
      await legeOrdnerBaumAn(cdp, true);
      await rechtsklickOrdner(cdp, O_ROOT);
      const eintraege = await menueEintraege(cdp);
      const epub = eintraege.filter((e) => /epub|folder as book/i.test(e.titel));
      if (epub.length !== 1 || epub[0]!.titel !== "Create EPUB") {
        return `Das Ordner-Menue fuehrt ${epub.length} EPUB-Eintraege statt genau eines „Create EPUB“: ${JSON.stringify(eintraege.map((e) => e.titel))}`;
      }
      if (!epub[0]!.icon) return "Der Menue-Eintrag „Create EPUB“ hat kein gezeichnetes Icon (kein svg in .menu-item-icon)";
      if (!(await clickReal(cdp, MENUE_EINTRAG("Create EPUB"), 80))) return "Der Menue-Eintrag „Create EPUB“ liess sich nicht klicken";
      { const w = await erwarte(cdp, `app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].folderSelection === ${JSON.stringify(O_ROOT)} && !!document.querySelector(".epub-exporter-sidebar .epub-sb-tree")`, "Der Klick auf „Create EPUB“ zeigte keine Ordner-Vorschau in der Sidebar"); if (w) return w; }

      const zeilen = await leseVorschau(cdp);
      const abweichung = vergleicheZeilen(zeilen, O_ZEILEN);
      if (abweichung) return abweichung;
      const ausgeblendet = await cdp.evaluate<string | null>(`return document.querySelector(".epub-exporter-sidebar .epub-sb-hidden")?.textContent?.trim() ?? null;`);
      if (ausgeblendet !== `${O_AUSGEBLENDET} hidden`) return `Die Zeile der ausgeblendeten Eintraege lautet ${JSON.stringify(ausgeblendet)}, erwartet "${O_AUSGEBLENDET} hidden"`;

      // Icons: ein Name ist erst ein Icon, wenn setIcon etwas zeichnet (UI-STANDARD § 8). Die Kontrolle zeichnet denselben Weg mit einem
      // erfundenen Namen — bleibt der leer und der echte nicht, kann die Messung rot werden.
      const kontrolle = await cdp.evaluate<{ echt: number; erfunden: number }>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const a = p.addRibbonIcon("folder", "smoke", () => {});
        const b = p.addRibbonIcon("epub-smoke-kein-icon", "smoke", () => {});
        const r = { echt: a.innerHTML.length, erfunden: b.innerHTML.length };
        a.remove(); b.remove();
        return r;
      `);
      if (!(kontrolle.echt > 0 && kontrolle.erfunden === 0)) {
        return `Die Icon-Kontrolle taugt nicht: echter Name ${kontrolle.echt} Zeichen, erfundener ${kontrolle.erfunden} (erwartet > 0 und 0)`;
      }
      const icons = await cdp.evaluate<Record<string, { laenge: number; klasse: string } | null>>(`
        const mass = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const svg = el.querySelector("svg");
          return { laenge: el.innerHTML.length, klasse: svg ? [...svg.classList].find((c) => c.startsWith("lucide-")) ?? "svg" : "" };
        };
        return {
          kopf: mass(".epub-exporter-sidebar .epub-sb-icon"),
          ausgeblendet: mass(".epub-exporter-sidebar .epub-sb-hidden-icon"),
          schliessen: mass(".epub-exporter-sidebar .epub-sb-action-close"),
        };
      `);
      const sollIcons: Record<string, string> = { kopf: "lucide-folder", ausgeblendet: "lucide-eye-off", schliessen: "lucide-x" };
      for (const [name, soll] of Object.entries(sollIcons)) {
        const ist = icons[name];
        // „folder“ zeichnet Obsidian 1.15 als lucide-folder-open: gemessen wird der Name als Praefix, nicht eine feste Klasse.
        if (!ist || ist.laenge === 0 || !ist.klasse.startsWith(soll)) return `Icon „${name}“: ${JSON.stringify(ist)}, erwartet ein gezeichnetes ${soll}*`;
      }
      const leer = zeilen.filter((z) => z.icon === "" || z.art === "?");
      if (leer.length) return `Zeilen ohne gezeichnetes folder/file-text-Icon: ${JSON.stringify(leer)}`;

      // Schliessen-Knopf: ein Knopf mit Namen, in der Kopfzeile, neben dem Titel, mit der Tastatur erreichbar.
      // Eine echte Tastengeste vorab: `:focus-visible` gilt nach Tastatur, nicht nach Maus — ohne sie misst ein Skript-Fokus keinen Ring.
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16 });
      const knopf = await cdp.evaluate<{ tag: string; label: string | null; tabIndex: number; breite: number; innen: boolean; frei: boolean; fokus: boolean; sichtbar: boolean; ring: string }>(`
        const c = document.querySelector(".epub-exporter-sidebar .epub-sb-action-close");
        const h = document.querySelector(".epub-exporter-sidebar .epub-sb-header");
        const t = document.querySelector(".epub-exporter-sidebar .epub-sb-title");
        const rc = c.getBoundingClientRect(), rh = h.getBoundingClientRect(), rt = t.getBoundingClientRect();
        c.focus();
        return {
          tag: c.tagName, label: c.getAttribute("aria-label"), tabIndex: c.tabIndex, breite: Math.round(rc.width),
          innen: rc.left >= rh.left && rc.right <= rh.right + 0.5 && rc.top >= rh.top - 0.5 && rc.bottom <= rh.bottom + 0.5,
          frei: rt.right <= rc.left + 0.5,
          fokus: document.activeElement === c,
          sichtbar: c.matches(":focus-visible"),
          ring: (() => { const cs = getComputedStyle(c); return (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 ? "outline " + cs.outlineWidth + " " + cs.outlineStyle : "") + (cs.boxShadow !== "none" ? " shadow " + cs.boxShadow : ""); })(),
        };
      `);
      if (knopf.tag !== "BUTTON" || knopf.label !== "Close folder view" || knopf.tabIndex < 0) return `Schliessen-Knopf: ${JSON.stringify(knopf)}, erwartet ein BUTTON mit aria-label „Close folder view“, per Tab erreichbar`;
      if (knopf.breite <= 0 || !knopf.innen || !knopf.frei) return `Schliessen-Knopf ohne Platz in der Kopfzeile: ${JSON.stringify(knopf)}`;
      if (!knopf.fokus) return "Der Schliessen-Knopf nimmt keinen Fokus an";
      if (!knopf.sichtbar || knopf.ring.trim() === "") return `Der Schliessen-Knopf hat nach einer Tastengeste keinen sichtbaren Fokus: ${JSON.stringify(knopf)}`;
      // Typografie, Einrueckung und Fokusring sieht kein Check: mit EPUB_SMOKE_SHOT=<datei.png> entsteht ein Bild zum Ansehen (kein Teil der Bilanz).
      if (env.EPUB_SMOKE_SHOT) writeFileSync(env.EPUB_SMOKE_SHOT, await capture(cdp));

      // Einrueckung: Klassen und Attribute, nie ein JS-Style; ab Tiefe 6 bleibt sie stehen (Baum mit 9 Ebenen).
      await waehleOrdner(cdp, O_TIEF);
      const tiefe = await cdp.evaluate<Array<{ tiefe: string | null; einzug: number; style: string | null }>>(`
        return [...document.querySelectorAll(".epub-exporter-sidebar .epub-sb-tree > li.epub-sb-row")].map((li) => ({
          tiefe: li.getAttribute("data-depth"),
          einzug: parseFloat(getComputedStyle(li).paddingInlineStart),
          style: li.getAttribute("style"),
        }));
      `);
      if (tiefe.length !== 9) return `Baum mit acht Ordnern und einer Seite: ${tiefe.length} Zeilen, erwartet 9`;
      if (tiefe.some((z) => z.style !== null)) return `Eine Zeile traegt ein style-Attribut: ${JSON.stringify(tiefe.find((z) => z.style !== null))}`;
      const tiefenSoll = ["0", "1", "2", "3", "4", "5", "6", "6", "6"];
      if (JSON.stringify(tiefe.map((z) => z.tiefe)) !== JSON.stringify(tiefenSoll)) return `data-depth ${JSON.stringify(tiefe.map((z) => z.tiefe))}, erwartet ${JSON.stringify(tiefenSoll)}`;
      for (let i = 1; i <= 6; i++) if (!(tiefe[i]!.einzug > tiefe[i - 1]!.einzug)) return `Einzug waechst nicht von Tiefe ${i - 1} zu ${i}: ${JSON.stringify(tiefe.map((z) => z.einzug))}`;
      if (tiefe[7]!.einzug !== tiefe[6]!.einzug || tiefe[8]!.einzug !== tiefe[6]!.einzug) return `Ab Tiefe 6 soll der Einzug stehen bleiben: ${JSON.stringify(tiefe.map((z) => z.einzug))}`;

      // Der Schliessen-Knopf wirkt: echter Klick beendet den Ordnermodus.
      // Erreichbarkeit mit der Bruecke: trifft ein Klick in die Mitte den Knopf selbst? Sie raeumt vorher die Toasts weg, die ein frueherer
      // Punkt hinterlaesst und die sonst ueber dem Knopf liegen (gemessen im Gesamtlauf: das Element unter dem Cursor war eine .notice).
      const schliessen = ".epub-exporter-sidebar .epub-sb-action-close";
      const erreichbar = await messeErreichbarkeit(cdp, { selektoren: [schliessen], erforderlich: [schliessen], scrollen: false, ohneUeberlauf: "die Kopfzeile des Panels hat keinen wachsenden Bereich" });
      if (erreichbar.urteil !== "gruen") return `Der Schliessen-Knopf ist nicht erreichbar (${erreichbar.urteil}): ${erreichbar.detail}`;
      if (!(await clickReal(cdp, `document.querySelector(".epub-exporter-sidebar .epub-sb-action-close")`, 80))) return "Der Schliessen-Knopf liess sich nicht klicken";
      { const w = await erwarte(cdp, `app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].folderSelection === null && !document.querySelector(".epub-exporter-sidebar .epub-sb-source")`, "Der Schliessen-Knopf beendete den Ordnermodus nicht"); if (w) return w; }
      return null;
    },
  },
  {
    id: "O2",
    was: "Eine umbenannte Datei aendert die Vorschau, danach genuegt EIN Klick auf „Export“; die Auswahl folgt dem Umbenennen des Ordners selbst",
    pruefe: async (cdp) => {
      await legeOrdnerBaumAn(cdp);
      await waehleOrdner(cdp, O_ROOT);
      const vorher = await leseVorschau(cdp);
      if (!vorher.some((z) => z.titel === "Namenstitel") || vorher.some((z) => z.titel === "Umbenannt")) {
        return `Vor dem Umbenennen stimmt die Vorschau nicht: ${JSON.stringify(vorher.map((z) => z.titel))}`;
      }
      const alt = `${O_ROOT}/01 - Anfang/03 - Namenstitel.md`;
      const neu = `${O_ROOT}/01 - Anfang/03 - Umbenannt.md`;
      await cdp.evaluate(`await app.fileManager.renameFile(app.vault.getAbstractFileByPath(${JSON.stringify(alt)}), ${JSON.stringify(neu)}); return true;`);
      { const w = await erwarte(cdp, `(() => { const t = [...document.querySelectorAll(".epub-exporter-sidebar .epub-sb-row-title")].map((e) => e.textContent); return t.includes("Umbenannt") && !t.includes("Namenstitel"); })()`, "Die Vorschau folgte dem Umbenennen der Datei nicht"); if (w) return w; }
      const nachher = O_ZEILEN.map((z) => (z.titel === "Namenstitel" ? { ...z, titel: "Umbenannt" } : z));
      const abweichung = vergleicheZeilen(await leseVorschau(cdp), nachher);
      if (abweichung) return `Nach dem Umbenennen: ${abweichung}`;

      // Ein einziger Klick (200 ms Haltedauer, wie S4): ein Rerender, der den Knopf unter dem Cursor zerstoert, liesse ihn ins Leere laufen.
      const dateien = await exportiereOrdner(cdp, O_EPUB);
      if (typeof dateien === "string") return dateien;
      const nav = dateien.get("OEBPS/nav.xhtml") ?? "";
      if (!nav.includes(">Umbenannt<") || nav.includes("Namenstitel")) return "Das EPUB nach dem Umbenennen fuehrt den neuen Titel „Umbenannt“ nicht (oder noch den alten)";

      // Der Ordner selbst wird im Explorer umbenannt: die Auswahl folgt, der Ordnermodus bleibt.
      const neuerOrdner = `${O_DIR}/Handbuch-neu`;
      await cdp.evaluate(`await app.fileManager.renameFile(app.vault.getAbstractFileByPath(${JSON.stringify(O_ROOT)}), ${JSON.stringify(neuerOrdner)}); return true;`);
      { const w = await erwarte(cdp, `app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].folderSelection === ${JSON.stringify(neuerOrdner)} && document.querySelector(".epub-exporter-sidebar .epub-sb-subtitle")?.textContent === "Handbuch-neu" && document.querySelectorAll(".epub-exporter-sidebar .epub-sb-tree > li").length === ${O_ZEILEN.length}`, "Nach dem Umbenennen des Ordners blieb die Sidebar nicht im Ordnermodus des neuen Pfads"); if (w) return w; }
      await cdp.evaluate(`await app.fileManager.renameFile(app.vault.getAbstractFileByPath(${JSON.stringify(neuerOrdner)}), ${JSON.stringify(O_ROOT)}); return true;`);
      { const w = await erwarte(cdp, `app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].folderSelection === ${JSON.stringify(O_ROOT)} && document.querySelector(".epub-exporter-sidebar .epub-sb-subtitle")?.textContent === "Handbuch"`, "Die Auswahl folgte dem Zurueckbenennen des Ordners nicht"); if (w) return w; }
      return null;
    },
  },
  {
    id: "O3",
    was: "Ordner-Export als ZIP: nav.xhtml und toc.ncx verschachtelt, „0 - …“ fehlt, Einleitungsseite vorn, `README.md` fuehrt zur Nachbarseite im selben Ordner",
    pruefe: async (cdp) => {
      await legeOrdnerBaumAn(cdp);
      await waehleOrdner(cdp, O_ROOT);
      const dateien = await exportiereOrdner(cdp, O_EPUB);
      if (typeof dateien === "string") return dateien;
      const nav = dateien.get("OEBPS/nav.xhtml");
      const ncx = dateien.get("OEBPS/toc.ncx");
      if (!nav || !ncx) return `nav.xhtml oder toc.ncx fehlt im Archiv: ${JSON.stringify([...dateien.keys()])}`;

      const eintraege = navEintraege(nav);
      const sollNav = O_ZEILEN.map((z) => `${z.tiefe}:${z.titel}`);
      const istNav = eintraege.map((e) => `${e.tiefe}:${e.titel}`);
      if (JSON.stringify(istNav) !== JSON.stringify(sollNav)) return `nav.xhtml ist ${JSON.stringify(istNav)}, erwartet ${JSON.stringify(sollNav)}`;
      const punkte = ncxPunkte(ncx);
      if (JSON.stringify(punkte.map((p) => p.tiefe)) !== JSON.stringify(O_ZEILEN.map((z) => z.tiefe))) return `toc.ncx: Tiefen ${JSON.stringify(punkte.map((p) => p.tiefe))}, erwartet ${JSON.stringify(O_ZEILEN.map((z) => z.tiefe))}`;
      if (JSON.stringify(punkte.map((p) => p.playOrder)) !== JSON.stringify(O_ZEILEN.map((_, i) => i + 1))) return `toc.ncx: playOrder ${JSON.stringify(punkte.map((p) => p.playOrder))}, erwartet 1 bis ${O_ZEILEN.length} ohne Luecke`;

      const kapitel = [...dateien.keys()].filter((n) => /^OEBPS\/chapter-\d+\.xhtml$/.test(n)).sort();
      if (kapitel.length !== 9) return `${kapitel.length} Kapiteldateien, erwartet 9 (Wurzel-README, Anfang mit 4, Vertiefung mit 3, Lose Seite): ${JSON.stringify(kapitel)}`;
      const dateiMit = (marker: string): string | null => kapitel.find((n) => (dateien.get(n) ?? "").includes(marker))?.replace("OEBPS/", "") ?? null;
      if (!(dateien.get(kapitel[0]!) ?? "").includes("MARKER-WURZEL-INTRO")) return "Die Einleitungsseite der Wurzel steht nicht vorn (chapter-01.xhtml)";
      if (eintraege[0]!.href.split("#")[0] !== kapitel[0]!.replace("OEBPS/", "")) return `Der erste Eintrag zeigt auf ${eintraege[0]!.href}, nicht auf die Einleitungsseite`;
      const verborgen = kapitel.filter((n) => (dateien.get(n) ?? "").includes("MARKER-GEHEIM"));
      if (verborgen.length) return `Ausgeblendetes steht im Buch: ${JSON.stringify(verborgen)}`;
      if (/Entwurf|Geheim|>Notiz</.test(nav)) return "Ausgeblendetes steht im Inhaltsverzeichnis";
      const ziel = (titel: string): string => (eintraege.find((e) => e.titel === titel)?.href ?? "").split("#")[0]!;
      if (!ziel("Tiefer") || ziel("Tiefer") !== ziel("Noch tiefer") || ziel("Tiefer") !== ziel("Ganz unten")) {
        return `Kapitel ohne Einleitungsseite sollen auf ihre erste Seite zeigen: Tiefer ${ziel("Tiefer")}, Noch tiefer ${ziel("Noch tiefer")}, Ganz unten ${ziel("Ganz unten")}`;
      }

      // Die Kernprobe: zwei README.md, ein Link „README.md“ — er gehoert zur Nachbarseite im selben Ordner.
      const anfang = dateiMit("MARKER-ANFANG-INTRO");
      const vertiefung = dateiMit("MARKER-VERTIEFUNG-INTRO");
      const wurzel = dateiMit("MARKER-WURZEL-INTRO");
      if (!anfang || !vertiefung || !wurzel || new Set([anfang, vertiefung, wurzel]).size !== 3) return `Die drei Einleitungsseiten sind nicht drei Dateien: ${anfang}, ${vertiefung}, ${wurzel}`;
      // Der bisherige Weg (Dateiname → zuletzt eingetragene Seite) saehe fuer „README.md“ die letzte README der Lesereihenfolge.
      const letzteReadme = [anfang, vertiefung, wurzel].sort().at(-1)!;
      if (letzteReadme === anfang) return "Der Aufbau taugt nicht als Gegenprobe: der alte Weg liesse „README.md“ auf der Anfang-Seite zufaellig richtig laufen";
      const links = (datei: string | null): Array<{ text: string; href: string }> =>
        [...(dateien.get(`OEBPS/${datei}`) ?? "").matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ text: (m[2] ?? "").replace(/<[^>]+>/g, ""), href: m[1] ?? "" }));
      const erste = links(dateiMit("MARKER-ERSTE"));
      const details = links(dateiMit("MARKER-DETAILS"));
      const hrefVon = (liste: typeof erste, text: string): string | undefined => liste.find((l) => l.text === text)?.href;
      if (hrefVon(erste, "Einleitung") !== anfang) return `„Erste Schritte“: [Einleitung](README.md) zeigt auf ${hrefVon(erste, "Einleitung")}, erwartet ${anfang} (der alte Weg haette ${letzteReadme} gewaehlt)`;
      if (hrefVon(erste, "Start") !== wurzel) return `„Erste Schritte“: [Start](../README.md#start) zeigt auf ${hrefVon(erste, "Start")}, erwartet ${wurzel}`;
      if (hrefVon(erste, "weg") !== undefined) return "„Erste Schritte“: der Link aus dem Buch heraus ([weg](../../Ausserhalb.md)) ist ein Link geblieben";
      if (!(dateien.get(`OEBPS/${dateiMit("MARKER-ERSTE")}`) ?? "").includes("weg")) return "„Erste Schritte“: der Text des Links aus dem Buch heraus ging verloren";
      if (hrefVon(details, "README") !== vertiefung) return `„Details“: [README](README.md) zeigt auf ${hrefVon(details, "README")}, erwartet ${vertiefung}`;
      if (hrefVon(details, "A") !== anfang) return `„Details“: [A](../01%20-%20Anfang/README.md#a) zeigt auf ${hrefVon(details, "A")}, erwartet ${anfang}`;
      return null;
    },
  },
  {
    id: "O4",
    was: "Arbeitskopie: Zustands-Knopf, Abbruch mittendrin hinterlaesst kein Ziel und der zweite Versuch laeuft durch, eine vorhandene Kopie bleibt unberuehrt, Export liest die Kopie, Arbeitsverzeichnis im Ordner meldet den Grund",
    pruefe: async (cdp) => {
      await legeOrdnerBaumAn(cdp);
      await ordnerEinstellungen(cdp, { workDir: O_ARBEIT, useWorkCopy: true });
      await waehleOrdner(cdp, O_ROOT);
      const knopf = (): Promise<{ text: string; gedrueckt: string | null } | null> =>
        cdp.evaluate(`const b = document.querySelector(".epub-exporter-sidebar .epub-sb-action-copy-toggle"); return b ? { text: b.textContent, gedrueckt: b.getAttribute("aria-pressed") } : null;`);
      const anlegen = `document.querySelector(".epub-exporter-sidebar .epub-sb-action-copy-create")`;

      // Zustands-Knopf: der Text nennt den Ist-Zustand, aria-pressed folgt, der Anlegen-Knopf gibt es nur bei „an“.
      let k = await knopf();
      if (!k || k.text !== "Working copy: on" || k.gedrueckt !== "true") return `Zustands-Knopf vor dem Klick: ${JSON.stringify(k)}, erwartet „Working copy: on“ / aria-pressed true`;
      if (!(await cdp.evaluate<boolean>(`return !!${anlegen};`))) return "„Create working copy“ fehlt bei eingeschalteter, noch nicht angelegter Kopie";
      if (!(await clickReal(cdp, `document.querySelector(".epub-exporter-sidebar .epub-sb-action-copy-toggle")`, 200))) return "Der Zustands-Knopf liess sich nicht klicken";
      { const w = await erwarte(cdp, `document.querySelector(".epub-exporter-sidebar .epub-sb-action-copy-toggle")?.getAttribute("aria-pressed") === "false"`, "Ein Klick schaltete die Arbeitskopie nicht aus"); if (w) return w; }
      k = await knopf();
      if (k?.text !== "Working copy: off" || (await cdp.evaluate<boolean>(`return !!${anlegen};`))) return `Nach dem Ausschalten: ${JSON.stringify(k)} (erwartet „Working copy: off“, kein Anlegen-Knopf)`;
      if (!(await clickReal(cdp, `document.querySelector(".epub-exporter-sidebar .epub-sb-action-copy-toggle")`, 200))) return "Der Zustands-Knopf liess sich nicht ein zweites Mal klicken";
      { const w = await erwarte(cdp, `document.querySelector(".epub-exporter-sidebar .epub-sb-action-copy-toggle")?.getAttribute("aria-pressed") === "true" && !!${anlegen}`, "Der zweite Klick schaltete die Arbeitskopie nicht wieder ein"); if (w) return w; }

      // Abbruch mitten im Kopieren (der dritte copy-Aufruf wirft). Der Eingriff ist eine Eigenschaft am vault-Objekt und wird mit `delete`
      // wieder entfernt — danach gilt wieder die Methode des Prototyps, und das wird gemessen.
      await cdp.evaluate(`
        let n = 0;
        const echt = Object.getPrototypeOf(app.vault).copy;
        app.vault.copy = async function (...a) { if (++n === 3) throw new Error("smoke: disk full"); return echt.apply(this, a); };
        return true;
      `);
      let abbruch: string | null = null;
      try {
        await leereNotices(cdp);
        if (!(await clickReal(cdp, anlegen, 150))) abbruch = "„Create working copy“ liess sich nicht klicken";
        else {
          const meldung = await pollUntil<boolean>(cdp, `return ${noticeEnthaelt("Could not create the working copy")};`, 10_000, 200);
          if (!meldung) abbruch = "Der Abbruch mitten im Kopieren wurde nicht gemeldet";
        }
      } finally {
        const noch = await cdp.evaluate<boolean>(`delete app.vault.copy; return Object.prototype.hasOwnProperty.call(app.vault, "copy");`);
        if (noch) abbruch = abbruch ?? "Der Eingriff an vault.copy liess sich nicht zuruecknehmen";
      }
      if (abbruch) return abbruch;
      const nachAbbruch = await cdp.evaluate<{ ziel: boolean; hilfsordner: boolean }>(`return { ziel: !!app.vault.getAbstractFileByPath(${JSON.stringify(O_KOPIE)}), hilfsordner: !!app.vault.getAbstractFileByPath(${JSON.stringify(O_HILFSORDNER)}) };`);
      if (nachAbbruch.ziel) return "Nach dem Abbruch existiert das Ziel der Arbeitskopie (halb angelegt): der naechste Klick fasste sie nicht mehr an";
      if (!nachAbbruch.hilfsordner) return "Nach dem Abbruch fehlt der Hilfsordner — der Abbruch hat den Kopierweg nicht erreicht";
      if (!(await cdp.evaluate<boolean>(`return !!${anlegen};`))) return "Nach dem Abbruch bietet die Sidebar „Create working copy“ nicht wieder an";

      // Zweiter Versuch laeuft durch: Ziel mit allem, kein Hilfsordner mehr.
      await leereNotices(cdp);
      if (!(await clickReal(cdp, anlegen, 150))) return "„Create working copy“ liess sich beim zweiten Versuch nicht klicken";
      if (!(await pollUntil<boolean>(cdp, `return ${noticeEnthaelt("Working copy created")};`, 10_000, 200))) return "Der zweite Versuch meldete keine angelegte Arbeitskopie";
      const erwartet = [...O_BAUM.map((b) => b.pfad), O_PNG].map((p) => `${O_ARBEIT}/${p}`);
      const fehlt = await cdp.evaluate<string[]>(`return ${JSON.stringify(erwartet)}.filter((p) => !app.vault.getAbstractFileByPath(p));`);
      if (fehlt.length) return `Dateien fehlen in der Arbeitskopie: ${JSON.stringify(fehlt)}`;
      if (await cdp.evaluate<boolean>(`return !!app.vault.getAbstractFileByPath(${JSON.stringify(O_HILFSORDNER)});`)) return "Der Hilfsordner des Abbruchs steht nach dem zweiten Versuch noch im Vault";

      // Eine vorhandene Kopie bleibt unberuehrt: geaenderte Seite und eigene neue Seite ueberleben einen weiteren Anlegen-Aufruf.
      const eigene = `${O_KOPIE}/Eigene Seite.md`;
      const geaendert = `${O_KOPIE}/README.md`;
      await schreibeDatei(cdp, geaendert, "# Handbuch Start\n\nGEAENDERT-IN-KOPIE\n");
      await schreibeDatei(cdp, eigene, "# Eigene Seite\n\nMARKER-EIGENE\n");
      await leereNotices(cdp);
      await cdp.evaluate(`await app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].makeBridge().handlers.onFolderCreateWorkCopy(); return true;`);
      if (!(await pollUntil<boolean>(cdp, `return ${noticeEnthaelt("left as it is")};`, 10_000, 200))) return "Ein weiterer Anlegen-Aufruf meldete nicht, dass die Kopie bleibt";
      if ((await leseDatei(cdp, geaendert)) !== "# Handbuch Start\n\nGEAENDERT-IN-KOPIE\n") return "Die vorhandene Arbeitskopie wurde ueberschrieben";
      if ((await leseDatei(cdp, eigene)) === null) return "Die eigene Seite in der Arbeitskopie ging verloren";

      // Vorschau und Export beziehen sich auf die Kopie; das EPUB liegt neben der Kopie (Entscheidung Johannes 2026-10-28).
      const quelle = await cdp.evaluate<string | null>(`return document.querySelector(".epub-exporter-sidebar .epub-sb-source")?.textContent ?? null;`);
      if (quelle !== `Working copy: ${O_KOPIE}`) return `Die Quellzeile lautet ${JSON.stringify(quelle)}, erwartet „Working copy: ${O_KOPIE}“`;
      { const w = await erwarte(cdp, `[...document.querySelectorAll(".epub-exporter-sidebar .epub-sb-row-title")].some((e) => e.textContent === "Eigene Seite")`, "Die Vorschau zeigt die eigene Seite der Arbeitskopie nicht"); if (w) return w; }
      const kopieEpub = `${O_ARBEIT}/${O_DIR}/Handbuch.epub`;
      const dateien = await exportiereOrdner(cdp, kopieEpub);
      if (typeof dateien === "string") return dateien;
      const text = [...dateien.entries()].filter(([n]) => n.startsWith("OEBPS/chapter-")).map(([, t]) => t).join("\n");
      if (!text.includes("GEAENDERT-IN-KOPIE") || text.includes("MARKER-WURZEL-INTRO")) return "Der Export liest nicht die Arbeitskopie (geaenderte Seite fehlt oder die alte steht noch im Buch)";
      if (await cdp.evaluate<boolean>(`return !!app.vault.getAbstractFileByPath(${JSON.stringify(O_EPUB)});`)) return "Das EPUB landete neben dem Original, entschieden ist: neben der Kopie";

      // Arbeitsverzeichnis im Ordner: kein Kopieren in sich selbst, die Sidebar nennt den Grund.
      await ordnerEinstellungen(cdp, { workDir: `${O_ROOT}/Arbeit` });
      { const w = await erwarte(cdp, `!document.querySelector(".epub-exporter-sidebar .epub-sb-action-copy-toggle") && (document.querySelector(".epub-exporter-sidebar .epub-sb-copy-note")?.textContent ?? "").includes("contains the working directory")`, "Mit dem Arbeitsverzeichnis im Ordner nennt die Sidebar den Grund nicht (oder zeigt noch den Schalter)"); if (w) return w; }
      return null;
    },
  },
  {
    id: "O5",
    was: "Form von data-href im gerenderten DOM fuer einen relativen Markdown-Link (../x.md#a): gleich dem Rohtext, den die Linkaufloesung erwartet",
    pruefe: async (cdp) => {
      await legeOrdnerBaumAn(cdp);
      await schreibeDatei(cdp, `${O_PROBE}/x.md`, "# X\n");
      await schreibeDatei(cdp, `${O_PROBE}/my page.md`, "# My page\n");
      const quelle = `${O_PROBE}/a/Quelle.md`;
      await schreibeDatei(cdp, quelle, "[x](../x.md#a)\n\n[y](../my%20page.md)\n\n[z](<../my page.md#h>)\n\n[[x|Alias]]\n");
      if (!(await openExisting(cdp, quelle, "preview"))) return `${quelle} liess sich nicht in der Leseansicht oeffnen`;
      { const w = await erwarte(cdp, `(app.workspace.activeLeaf?.view?.containerEl?.querySelectorAll(".markdown-reading-view a.internal-link").length ?? 0) >= 4`, "Die Leseansicht zeigte nicht vier interne Links"); if (w) return w; }
      const links = await cdp.evaluate<Array<{ text: string; dataHref: string | null; href: string | null }>>(`
        return [...app.workspace.activeLeaf.view.containerEl.querySelectorAll(".markdown-reading-view a.internal-link")].map((a) => ({
          text: a.textContent, dataHref: a.getAttribute("data-href"), href: a.getAttribute("href"),
        }));
      `);
      for (const l of links) console.log(`    O5 ${JSON.stringify(l.text)}: data-href=${JSON.stringify(l.dataHref)} href=${JSON.stringify(l.href)}`);
      const von = (text: string) => links.find((l) => l.text === text);
      if (von("x")?.dataHref !== "../x.md#a") return `BEFUND: data-href von [x](../x.md#a) ist ${JSON.stringify(von("x")?.dataHref)}, nicht der Rohtext — die Linkaufloesung (Aufgabe 4) muss vor dem Weitermachen angepasst werden`;
      // Kontrolle: die Messung unterscheidet Formen — ein Wikilink traegt den Namen ohne Pfad und Anker.
      if (von("Alias")?.dataHref !== "x") return `Kontrolle: der Wikilink [[x|Alias]] hat data-href ${JSON.stringify(von("Alias")?.dataHref)}, erwartet "x"`;
      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// Provider-Stub fuer die Titelbild-Punkte
// ---------------------------------------------------------------------------

/**
 * Setzt ein Stellvertreter-Plugin unter dem Schluessel, unter dem
 * local-image-generator seine API anbietet.
 *
 * Warum ein Stub und kein echter Lauf: die Bilderzeugung gehoert dem
 * Nachbarplugin, braucht eine GPU und dauert im eingebauten Modus Minuten. Was
 * HIER falsch sein kann, ist unsere Seite — Erkennung, Sichtbarkeit, die
 * Reihenfolge von Datei und Notiz. Genau die misst der Stub, und zwar gegen
 * echtes DOM und einen echten Vault.
 *
 * Er wird nach jedem Punkt wieder entfernt: ein liegengebliebener Stub liesse
 * C1 gruen aussehen, waehrend er seinen Gegenstand nicht mehr beruehrt.
 */
async function setzeProviderStub(cdp: Cdp): Promise<void> {
  await deaktiviereEchtenAnbieter(cdp);
  await cdp.evaluate(`
    const reg = app.plugins.plugins;
    if (!reg["local-image-generator"]) {
      window.__epubStubGesetzt = true;
      const zustand = {
        apiVersion: 1,
        engine: "server",
        ready: true,
        reason: null,
        capabilities: {
          negativePrompt: true, cfg: true, maxSteps: 50,
          fixedSize: null, sizes: null, initImage: false,
        },
      };
      reg["local-image-generator"] = {
        api: {
          apiVersion: 1,
          status: () => zustand,
          recheck: async () => zustand,
          generate: async (req) => {
            if (req.onProgress) req.onProgress(50, "generating");
            return { ok: true, image: { base64: ${JSON.stringify(STUB_PNG_BASE64)}, params: { seed: 42 } } };
          },
        },
      };
    }
    return true;
  `);
}

async function entferneProviderStub(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    if (window.__epubStubGesetzt) {
      delete app.plugins.plugins["local-image-generator"];
      delete window.__epubStubGesetzt;
    }
    return true;
  `);
}

/**
 * Ein ECHT installiertes Nachbarplugin fuer die Dauer eines T-Punktes abschalten.
 *
 * Warum das noetig wurde: seit `npm run smoke:e2e -- --setup` (Naht-Lauf, 2026-09-02) liegt
 * `local-image-generator` echt im selben Staging-Vault. Ohne diesen Griff waere **T1 rot**
 * (er entfernt nur den Stub, das echte Plugin bleibt und meldet einen Anbieter) und T2/T3
 * liefen ploetzlich gegen die echte API — die ohne erreichbaren Server keinen Dialog
 * oeffnet. Der GUI-Smoke misst unsere Haelfte und soll das **unabhaengig davon** tun, was
 * sonst im Vault installiert ist; die Naht misst `smoke:e2e`.
 *
 * `disablePlugin` statt eines `delete` auf dem Register: das Register wieder zu fuellen
 * ergaebe ein Plugin-Objekt ohne laufende Instanz. Zurueckgeschaltet wird in
 * `stelleAnbieterWiederHer`, auch nach einem Abbruch (Aufraeumblock am Lauf-Ende).
 */
async function deaktiviereEchtenAnbieter(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    if (app.plugins.enabledPlugins.has("local-image-generator")) {
      await app.plugins.disablePlugin("local-image-generator");
      window.__epubEchterAnbieterAus = true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return true;
  `);
}

/** Stub weg, ein von uns abgeschaltetes echtes Nachbarplugin wieder an. */
async function stelleAnbieterWiederHer(cdp: Cdp): Promise<void> {
  await entferneProviderStub(cdp);
  await cdp.evaluate(`
    if (window.__epubEchterAnbieterAus) {
      await app.plugins.enablePlugin("local-image-generator");
      delete window.__epubEchterAnbieterAus;
      await new Promise((r) => setTimeout(r, 300));
    }
    return true;
  `);
}

// ---------------------------------------------------------------------------
// Helfer der schreibenden Punkte
// ---------------------------------------------------------------------------

/** Die Smoke-Buch-Notiz in den Auslieferungszustand bringen. Jeder schreibende Punkt
 *  stellt seinen Vorzustand selbst her — sonst haengt sein Ergebnis daran, welcher Punkt
 *  vorher lief, und `--only` misst etwas anderes als der Gesamtlauf. */
async function schreibeSmokeBuch(cdp: Cdp): Promise<void> {
  for (const k of SMOKE_CHAPTERS) await schreibeDatei(cdp, k.pfad, k.body);
  await schreibeDatei(cdp, SMOKE_BOOK, SMOKE_BOOK_BODY);
  await cdp.evaluate(`await new Promise((r) => setTimeout(r, 400)); return true;`);
}

/** Die Embed-Zeilen aus einer Buch-Notiz — roh, ohne Normalisierung. */
function spineZeilen(inhalt: string): string[] {
  return inhalt
    .split("\n")
    .map((z) => z.trim())
    .filter((z) => z.startsWith("![["));
}

/** Alt+Pfeil-ab auf dem Kapitel an `index` ausloesen.
 *
 *  Der Handler haengt direkt am `li`, ein dorthin abgesetztes KeyboardEvent genuegt also.
 *  Fokus wird trotzdem gesetzt: die Geste ist im Produkt an ein fokussiertes Element
 *  gebunden, und ein Treiber, der ohne Fokus misst, prueft einen Pfad, den es nicht gibt. */
async function gesteAltAb(cdp: Cdp, index: number): Promise<void> {
  const ok = await cdp.evaluate<boolean>(`
    const wurzel = document.querySelector(".epub-exporter-sidebar");
    if (!wurzel) return false;
    const lis = wurzel.querySelectorAll(".epub-sb-chapters > li.epub-sb-chapter");
    const li = lis[${index}];
    if (!li) return false;
    li.focus();
    li.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowDown", altKey: true, bubbles: true, cancelable: true,
    }));
    return true;
  `);
  if (!ok) throw new Error(`Kapitel an Position ${index + 1} nicht im Panel gefunden`);
}

/** Auf eine tatsaechliche Aenderung des Dateiinhalts warten.
 *
 *  Nicht auf eine feste Wartezeit: der Schreibvorgang laeuft ueber `vault.process`, und
 *  eine Pause, die "meistens reicht", macht den Punkt sporadisch rot — teurer als
 *  dauerhaft rot, weil man den Defekt zuerst im Pruefling sucht. */
async function requireDateiWechsel(cdp: Cdp, pfad: string, vorher: string): Promise<string> {
  await requireUntil(
    cdp,
    `(async () => {
      const f = app.vault.getAbstractFileByPath(${JSON.stringify(pfad)});
      if (!f) return false;
      return (await app.vault.read(f)) !== ${JSON.stringify(vorher)};
    })()`,
    `Der Dateiinhalt von ${pfad} hat sich nicht geaendert — die Geste erreichte die Datei nicht`,
  );
  return (await leseDatei(cdp, pfad)) ?? "";
}

/** Das Smoke-Buch exportieren und die entstandene Datei einlesen. */
async function exportiereSmokeBuch(cdp: Cdp): Promise<Buffer> {
  await schreibeSmokeBuch(cdp);
  await inDenPapierkorb(cdp, [SMOKE_EPUB]);
  await oeffneUndWarte(cdp, SMOKE_BOOK, `document.querySelector(".markdown-reading-view")`);
  await leereNotices(cdp);
  await cdp.evaluate(`
    await app.commands.executeCommandById("epub-exporter:export-epub");
    return true;
  `);
  const fsPfad = await warteAufDatei(cdp, SMOKE_EPUB);
  // Kurz nachfassen: die Datei erscheint im Vault-Index, bevor der Schreibvorgang
  // abgeschlossen ist. Ein Lesen im selben Moment liefert ein abgeschnittenes Archiv —
  // und der Fehlschlag saehe aus wie ein defekter ZIP-Writer.
  let letzte = -1;
  for (let i = 0; i < 25; i++) {
    const groesse = existsSync(fsPfad) ? readFileSync(fsPfad).length : -1;
    if (groesse > 0 && groesse === letzte) break;
    letzte = groesse;
    await new Promise((r) => setTimeout(r, 200));
  }
  return readFileSync(fsPfad);
}

// ---------------------------------------------------------------------------
// Ablaufsteuerung
// ---------------------------------------------------------------------------

function zeigeVertrag(): void {
  console.log(`Pruefpunkte — ${PRUEFPUNKTE.length} (docs/SMOKE.md)\n`);
  for (const p of PRUEFPUNKTE) console.log(`  ${p.id.padEnd(4)} ${p.was}`);
}

function setup(): void {
  const vaultDir = stagingVaultDir(REPO_NAME);
  const log = buildVault({
    repoRoot: REPO_ROOT,
    vaultDir,
    fixtureDir: FIXTURE_DIR,
    pluginId: PLUGIN_ID,
  });
  console.log(`Staging-Vault: ${vaultDir}`);
  for (const zeile of log) console.log(`  ${zeile}`);
  console.log(
    "\nNaechster Schritt: Zweitinstanz mit eigenem Profil und Port auf diesen Vault starten (Dateikopf).\n" +
    "Vertrauensdialog und Restricted Mode erledigt der Treiber selbst.\n" +
    `Danach: npm run smoke:gui -- --port ${PORT}`,
  );
}

async function lauf(nur?: string): Promise<void> {
  const cdp = await attachTo("workspace", PORT, VAULT_NAME);
  if (!cdp) {
    throw new Error(
      `Kein Obsidian-Fenster fuer Vault "${VAULT_NAME}" auf Port ${PORT}. ` +
      "Laeuft die Zweitinstanz (Profil, Port, Vault in obsidian.json — siehe Dateikopf)?",
    );
  }

  const konsole: string[] = [];
  // Teillauf (--only): Soll-Liste ist der gewaehlte Punkt plus die Rahmenpunkte C0/C1.
  const soll = nur ? (["C0", nur, "C1"] as unknown as typeof PUNKTE) : PUNKTE;
  const bilanz = createBilanz({ punkte: soll });
  if (nur) console.log(`Teillauf: ${nur}, ${soll.length} von ${PUNKTE.length} Punkten im Soll`);
  let buchVorher: string | null = null;

  // Die Aufraeumarbeit als eigene Funktion, damit Normalweg (`finally`) und Abbruch denselben Schritt
  // fahren. Ohne Abbruch-Behandlung bliebe der Stub am Plugin-Register haengen (er ueberlebt einen
  // Abbruch mitten in T2/T3 und liesse T1 beim naechsten Lauf gruen aussehen, ohne seinen Gegenstand
  // zu beruehren — derselbe Fall, den der Kommentar bei C1 fuer einen regulaeren Abbruch bereits
  // beschreibt), ebenso die Papierkorb-Dateien.
  const cleanupState = async (): Promise<void> => {
    try {
      await inDenPapierkorb(cdp, [
        FIXTURE_EPUB,
        SMOKE_EPUB,
        SMOKE_COVER,
        SMOKE_BOOK,
        SMOKE_FM_NOTE,
        ...SMOKE_CHAPTERS.map((k) => k.pfad),
        SMOKE_DIR,
        O_DIR,
        O_ARBEIT,
      ]);
      await stelleOrdnerZustandWiederHer(cdp);
      await stelleAnbieterWiederHer(cdp);
      if (buchVorher !== null) {
        const jetzt = await leseDatei(cdp, BOOK);
        if (jetzt === buchVorher) bilanz.record("C1", true, "Buch-Notiz nach dem Lauf: byte-gleich");
        else bilanz.record("C1", false, "die Buch-Notiz hat sich geaendert — der Lauf sollte sie nicht anfassen");
      } else {
        bilanz.unmeasured("C1", "Vorwert der Buch-Notiz wurde nicht gelesen (Lauf endete vorher)");
      }
    } catch (e) {
      bilanz.record("C1", false, `Aufraeumen fehlgeschlagen — ${(e as Error).message}`);
    }
  };

  // Alles, was dieser Lauf am Wirt aendert, raeumt EIN Schritt zurueck: der Normalweg im `finally`
  // (`zustand.schliesse()`) und Ctrl-C/SIGTERM ueber das Abbruch-Modul der Bruecke (Hauptzweig gesperrt,
  // Schritt darf noch senden, danach Bilanz, Exit 130). Idempotent und ohne Warten. Angemeldet VOR der
  // ersten Mutation.
  const zustand = beimAbbruch(cleanupState, "Stub, Smoke-Dateien und Anbieter zurueckstellen, Buch-Notiz pruefen");

  try {
    await cdp.mitschnitt((zeile) => konsole.push(zeile));
    await requireVisible(cdp);
    // Vertrauensdialog, Restricted Mode und Plugin-Ladung erledigt die Bruecke (frisches Profil).
    const instanz = await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID], nurVault: VAULT_NAME, sprache: "en" });
    console.log(`Instanz vorbereitet: ${instanz.hinweis}`);
    await closeExtraLeaves(cdp);

    const neu = await ladePluginNeu(cdp, PLUGIN_ID, { repoMainJs: join(REPO_ROOT, "main.js") });
    if (!neu.geladen) throw new Error(`Plugin ${PLUGIN_ID} nicht aktiv — ${neu.hinweis}`);
    if (!neu.aktuell) throw new Error(neu.hinweis);
    console.log(`${neu.hinweis}\n`);

    // `window.__epubStubGesetzt` haengt am Plugin-Register, nicht an einer Datei — es
    // ueberlebt einen per SIGINT/SIGTERM abgebrochenen frueheren Lauf, BEVOR dieser Lauf
    // selbst einen Stub setzt. Ohne diesen Punkt liest T1 den Rest als "echter Anbieter
    // installiert" und faellt still durch, statt den Rest zu melden.
    await bilanz.punkt("C0", async () => {
      const leftoverStub = await cdp.evaluate<boolean>(`return !!window.__epubStubGesetzt;`);
      if (leftoverStub) {
        await stelleAnbieterWiederHer(cdp);
        bilanz.record("C0", false, "Stub gefunden und entfernt (vermutlich Ctrl-C/Crash im vorigen Lauf vor dessen Aufraeumen; dieser Lauf faehrt normal weiter)");
      } else {
        bilanz.record("C0", true, "kein liegen gebliebener Stub aus einem abgebrochenen frueheren Lauf");
      }
    });

    // Vorwert AUSSERHALB des try-Blocks der Pruefpunkte festhalten — C1 vergleicht dagegen.
    buchVorher = await leseDatei(cdp, BOOK);

    for (const punkt of PRUEFPUNKTE) {
      if (nur && punkt.id !== nur) continue;
      const id = punkt.id as PunktId;
      await bilanz.punkt(id, async () => {
        await schliesseUeberlagerungen(cdp);
        const grund = await punkt.pruefe(cdp);
        bilanz.record(id, grund === null, grund ?? punkt.was);
      });
    }
  } finally {
    // C1: Aufraeumen und das Ergebnis PROTOKOLLIEREN, nicht ihm vertrauen. Derselbe Schritt wie im
    // Abbruch (`zustand`) — kein Doppelcode.
    await zustand.schliesse();
    if (istAbgebrochen()) return;
    cdp.close();
  }

  if (konsole.length) {
    console.log(`\nKonsole des Prueflings (${konsole.length}):`);
    for (const z of konsole.slice(0, 20)) console.log(`  ${z}`);
  }

  bilanz.abschluss();
}

async function main(): Promise<void> {
  const args = parseArgs(argv.slice(2));
  if (args.has("list")) return zeigeVertrag();

  const portText = args.value("port") ?? env.CDP_PORT;
  if (!portText || !Number.isInteger(Number(portText))) {
    throw new Error("--port <port> fehlt (oder CDP_PORT). Kein Default: 9222 ist die regulaere Instanz.");
  }
  PORT = Number(portText);

  if (args.has("setup")) return setup();

  if (!existsSync(join(REPO_ROOT, "main.js"))) {
    throw new Error("main.js fehlt — erst `npm run build`.");
  }
  const nur = args.value("only");
  if (nur && !PRUEFPUNKTE.some((p) => p.id === nur)) {
    throw new Error(`Unbekannter Pruefpunkt: ${nur}\nBekannt: ${PRUEFPUNKTE.map((p) => p.id).join(", ")}`);
  }
  await lauf(nur);
}

runDriver(main);
