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
 * ```bash
 * npm run build
 * npm run smoke:gui -- --setup            # Staging-Vault aus dem Fixture herstellen
 * #   ... Vault-Fenster oeffnen (siehe unten), einmalig als vertrauenswuerdig markieren
 * npm run smoke:gui -- --vault epub-exporter
 * npm run smoke:gui -- --only S4          # einen Punkt nachziehen
 * npm run smoke:gui -- --list             # Vertrag anzeigen
 * ```
 *
 * ## ⚠️ Obsidian ist Single-Instance — NIEMALS blind beenden
 *
 * An derselben Maschine arbeiten mehrere Sessions an **einer** Obsidian-Instanz. Ein
 * `quit` trifft sie alle und zerstoert Zustand, der nur im Speicher steht (offene Fenster,
 * laufende Indizierung, eine Messreihe). Der eigene Lauf ist danach sauber gruen — der
 * Schaden entsteht woanders und faellt nicht auf.
 *
 * Richtig ist Mitnutzen:
 *   1. Laeuft schon eines mit offenem Debug-Port? Dann diesen Port benutzen.
 *   2. Eigenes Fenster auf den Staging-Vault per IPC:
 *      `ipcRenderer.send("vault-open", "<vaultDir>")` — `--setup` gibt den Pfad aus.
 *   3. `attachTo("workspace", PORT, VAULT_NAME)` waehlt ueber den **Vault-Namen**, nicht
 *      ueber die Reihenfolge der Targets.
 *
 * Seit 2026-08-30 regelt das zusaetzlich ein Lock, nicht mehr die Absprache allein:
 * `python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label <name> --intent <text>`,
 * danach `release`. Wer ihn vergisst, wird von einem PreToolUse-Hook geblockt.
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
 *    kein Symlink; ein veralteter Build maskiert sich als Code-Bug. `ladePluginNeu()` holt
 *    das nach — inklusive `loadManifests`, sonst bleibt die Versionsangabe der Stand vom
 *    App-Start (json_viewer, 2026-08-22).
 * 5. **Schreibende Pruefpunkte fassen die Fixture-Buch-Notiz nicht an.** R1–R3 und E1–E3
 *    laufen gegen eine eigene, zur Laufzeit angelegte Smoke-Buch-Notiz. Sonst waeren die
 *    README-Bilder an das Aufraeumen dieses Treibers gekoppelt — zwei Werkzeuge, ein
 *    Fixture, und der Fehlschlag des einen beschaedigt still das andere.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, env, exit } from "node:process";

import {
  attachTo,
  Cdp,
  clickReal,
  closeExtraLeaves,
  openExisting,
  requireUntil,
  requireVisible,
} from "../../tools/obsidian-cdp/cdp.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "epub-exporter";
const PLUGIN_ID = "epub-exporter";
/** Vault-Name = Repo-Name. Der Filter in `attachTo` haengt daran. */
const VAULT_NAME = REPO_NAME;
const PORT = Number(env.CDP_PORT ?? 9222);

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

/**
 * Plugin neu laden, ohne Obsidian anzufassen.
 *
 * `loadManifests` gehoert dazu: Obsidian liest die Manifeste beim **App-Start**, und
 * `enablePlugin` allein laedt zwar `main.js` neu, aber nicht die Versionsangabe. Ein
 * Treiber, der `plugin.manifest.version` meldet, meldet sonst den Stand von vorhin — eine
 * Zahl, die genau dann irrefuehrt, wenn man ihr glaubt (json_viewer, 2026-08-22).
 */
async function ladePluginNeu(cdp: Cdp): Promise<string> {
  return cdp.evaluate<string>(`
    const id = ${JSON.stringify(PLUGIN_ID)};
    await app.plugins.disablePlugin(id);
    await app.plugins.loadManifests();
    await app.plugins.enablePlugin(id);
    await new Promise((r) => setTimeout(r, 500));
    // Die Version aus der DEPLOYTEN Datei lesen, nicht aus dem Manifest im Speicher.
    const pfad = app.vault.configDir + "/plugins/" + id + "/manifest.json";
    const roh = await app.vault.adapter.read(pfad);
    return JSON.parse(roh).version;
  `);
}

/** Alle Overlays schliessen — vor jedem Punkt, nicht nur nach dem, der eines geoeffnet hat.
 *  Ein stehengebliebenes Modal laesst den NAECHSTEN Punkt scheitern, und der Fehlschlag
 *  zeigt dann auf den falschen Pruefpunkt. */
async function schliesseUeberlagerungen(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    document.querySelectorAll(".modal-close-button").forEach((b) => b.click());
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
  await cdp.evaluate(`
    const docs = new Set([document]);
    if (typeof activeDocument !== "undefined" && activeDocument) docs.add(activeDocument);
    for (const d of docs) d.querySelectorAll(".notice").forEach((n) => n.remove());
    return true;
  `);
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
        return "UEBERSPRUNGEN: XHTML liegt komprimiert vor, dieser Punkt liest nur unkomprimierte Eintraege";
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
    "\nJetzt den Vault oeffnen — NICHT Obsidian beenden, falls es laeuft (Single-Instance,\n" +
    "siehe Dateikopf). Zweites Fenster per IPC:\n" +
    `  ipcRenderer.send("vault-open", ${JSON.stringify(vaultDir)})\n` +
    "Ein frisch geoeffnetes Fenster fragt einmalig nach Vertrauen und beantwortet bis zum\n" +
    "Wegklicken KEINEN Aufruf — das sieht wie ein haengender Renderer aus.\n" +
    "Danach: npm run smoke:gui",
  );
}

async function lauf(nur?: string): Promise<number> {
  const cdp = await attachTo("workspace", PORT, VAULT_NAME);
  if (!cdp) {
    console.error(
      `Kein Obsidian-Fenster fuer Vault "${VAULT_NAME}" auf Port ${PORT}.\n` +
      "Laeuft Obsidian mit offenem Debug-Port, und ist der Staging-Vault als Fenster offen?\n" +
      "Siehe Dateikopf: der Vault wird per IPC geoeffnet, nicht durch einen Neustart.",
    );
    return 1;
  }

  const konsole: string[] = [];
  let gruen = 0;
  const rot: string[] = [];
  let buchVorher: string | null = null;

  // Dieselbe Aufraeumarbeit wie im `finally` unten — als eigene Funktion, damit der
  // SIGINT/SIGTERM-Handler sie aufrufen kann, ohne Code zu duplizieren. Ein Ctrl-C mitten
  // im Lauf ueberspringt das `finally` NICHT (try/catch-Semantik), sondern beendet den
  // Node-Prozess sofort — ohne eigenen Handler bleibt der Stub am Plugin-Register haengen
  // (er ueberlebt einen Abbruch mitten in T2/T3 und liesse T1 beim naechsten Lauf gruen
  // aussehen, ohne seinen Gegenstand zu beruehren — derselbe Fall, den der Kommentar bei
  // C1 fuer einen regulaeren Abbruch bereits beschreibt), ebenso die Papierkorb-Dateien.
  const cleanupState = async (): Promise<void> => {
    try {
      await inDenPapierkorb(cdp, [
        FIXTURE_EPUB,
        SMOKE_EPUB,
        SMOKE_COVER,
        SMOKE_BOOK,
        ...SMOKE_CHAPTERS.map((k) => k.pfad),
        SMOKE_DIR,
      ]);
      await stelleAnbieterWiederHer(cdp);
      if (buchVorher !== null) {
        const jetzt = await leseDatei(cdp, BOOK);
        console.log(
          jetzt === buchVorher
            ? `\nC1   Buch-Notiz nach dem Lauf: byte-gleich`
            : `\nC1   ABWEICHUNG — die Buch-Notiz hat sich geaendert. Der Lauf sollte sie nicht anfassen.`,
        );
        if (jetzt !== buchVorher) rot.push("C1: Buch-Notiz nach dem Lauf nicht byte-gleich");
      }
    } catch (e) {
      console.log(`\nC1   Aufraeumen fehlgeschlagen: ${(e as Error).message}`);
      rot.push(`C1: Aufraeumen fehlgeschlagen — ${(e as Error).message}`);
    }
  };

  let signalCleanupRunning = false;
  const onAbortSignal = (signal: NodeJS.Signals) => {
    if (signalCleanupRunning) return;
    signalCleanupRunning = true;
    void (async () => {
      console.log(`\n\nAbbruch durch ${signal} — raeume Smoke-Zustand auf...`);
      await cleanupState();
      cdp.close();
      process.exit(130);
    })();
  };
  process.on("SIGINT", onAbortSignal);
  process.on("SIGTERM", onAbortSignal);

  try {
    await cdp.mitschnitt((zeile) => konsole.push(zeile));
    await requireVisible(cdp);
    await closeExtraLeaves(cdp);

    const version = await ladePluginNeu(cdp);
    console.log(`Plugin ${PLUGIN_ID} ${version} (aus der deployten manifest.json)\n`);

    // `window.__epubStubGesetzt` haengt am Plugin-Register, nicht an einer Datei — es
    // ueberlebt einen per SIGINT/SIGTERM abgebrochenen frueheren Lauf, BEVOR dieser Lauf
    // selbst einen Stub setzt. Ohne diesen Punkt liest T1 den Rest als "echter Anbieter
    // installiert" und faellt still durch, statt den Rest zu melden.
    process.stdout.write("C0   Kein liegen gebliebener Stub aus einem abgebrochenen frueheren Lauf … ");
    const leftoverStub = await cdp.evaluate<boolean>(`return !!window.__epubStubGesetzt;`);
    if (leftoverStub) {
      await stelleAnbieterWiederHer(cdp);
      console.log("ROT — Stub gefunden und entfernt (vermutlich Ctrl-C/Crash im vorigen Lauf vor dessen Aufraeumen; dieser Lauf faehrt normal weiter)");
      rot.push("C0: liegen gebliebener Provider-Stub aus einem abgebrochenen frueheren Lauf");
    } else {
      console.log("ok");
      gruen++;
    }

    // Vorwert AUSSERHALB des try-Blocks der Pruefpunkte festhalten — C1 vergleicht dagegen.
    buchVorher = await leseDatei(cdp, BOOK);

    for (const punkt of PRUEFPUNKTE) {
      if (nur && punkt.id !== nur) continue;
      process.stdout.write(`${punkt.id.padEnd(4)} ${punkt.was} … `);
      try {
        await schliesseUeberlagerungen(cdp);
        const grund = await punkt.pruefe(cdp);
        if (grund === null) {
          console.log("ok");
          gruen++;
        } else if (grund.startsWith("UEBERSPRUNGEN")) {
          console.log(grund);
        } else {
          console.log(`ROT — ${grund}`);
          rot.push(`${punkt.id}: ${grund}`);
        }
      } catch (e) {
        console.log(`FEHLER — ${(e as Error).message}`);
        rot.push(`${punkt.id}: ${(e as Error).message}`);
      }
    }
  } finally {
    // C1: Aufraeumen und das Ergebnis PROTOKOLLIEREN, nicht ihm vertrauen. Dieselbe Funktion
    // wie der SIGINT/SIGTERM-Handler oben — kein Doppelcode.
    process.off("SIGINT", onAbortSignal);
    process.off("SIGTERM", onAbortSignal);
    await cleanupState();
    cdp.close();
  }

  if (konsole.length) {
    console.log(`\nKonsole des Prueflings (${konsole.length}):`);
    for (const z of konsole.slice(0, 20)) console.log(`  ${z}`);
  }

  // +1 fuer C0 (der Leftover-Stub-Check laeuft immer, ausserhalb von PRUEFPUNKTE, und nie
  // unter --only — der ist an einen bestimmten Punkt gebunden, nicht an den Lauf-Anfang).
  const gefahren = (nur ? 1 : PRUEFPUNKTE.length) + 1;
  console.log(`\n${gruen}/${gefahren} gruen`);
  if (rot.length) {
    console.log("\nRot:");
    for (const z of rot) console.log(`  ${z}`);
    console.log(
      "\nJeden roten Punkt EINZELN auseinandernehmen, nicht die Summe als Befundlage lesen.\n" +
      "Beim ersten Lauf sind erfahrungsgemaess die meisten roten Punkte Treiberfehler,\n" +
      "keine Produktfehler — das ist die eigentliche Leistung des ersten Laufs.",
    );
  }
  return rot.length === 0 ? 0 : 1;
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  if (args.includes("--list")) return zeigeVertrag();
  if (args.includes("--setup")) return setup();

  if (!existsSync(join(REPO_ROOT, "main.js"))) {
    console.error("main.js fehlt — erst `npm run build`.");
    exit(1);
  }
  const nurIdx = args.indexOf("--only");
  const nur = nurIdx >= 0 ? args[nurIdx + 1] : undefined;
  if (nur && !PRUEFPUNKTE.some((p) => p.id === nur)) {
    console.error(`Unbekannter Pruefpunkt: ${nur}\nBekannt: ${PRUEFPUNKTE.map((p) => p.id).join(", ")}`);
    exit(1);
  }
  exit(await lauf(nur));
}

void main();
