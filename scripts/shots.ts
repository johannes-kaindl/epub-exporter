/**
 * Aufnahme-Treiber fuer die README-Bilder — faehrt den Vertrag aus `docs/images/README.md`
 * gegen ein **laufendes** Obsidian, statt die Bilder von Hand zu klicken.
 *
 * Warum getrackt: ein Werkzeug, das nur einmal im Scratchpad existiert, ist keine Praxis.
 * Bruecke, Aufnahme-Primitive und Fixture→Vault liegen zentral im Dach
 * (`obsidian-plugins/tools/obsidian-cdp/`); dieser Treiber importiert sie von dort und
 * vendort nichts. Im Repo bleiben nur Rezept, Fixture und Vertrag.
 *
 * ## Ablauf
 *
 * ```bash
 * npm run build && npm run shots -- --setup   # Vault aus dem Fixture bauen
 * #   ... Aufnahme-Vault oeffnen (siehe unten), einmalig als vertrauenswuerdig markieren
 * npm run shots                                # alles aufnehmen
 * npm run shots -- --only hero.png             # ein Bild nachziehen
 * npm run shots -- --list                      # Vertrag anzeigen
 * ```
 *
 * ## ⚠️ Obsidian ist Single-Instance — NIEMALS blind `quit` vor der Aufnahme
 *
 * Laeuft bereits ein Obsidian, laesst sich **kein zweiter Prozess** mit eigenem Debug-Port
 * starten: `open -a Obsidian --args --remote-debugging-port=9223` ignoriert die Argumente
 * und fokussiert bloss das bestehende Fenster.
 *
 * Die naheliegende Abhilfe — Obsidian beenden und mit Port neu starten — ist in diesem
 * Workspace **destruktiv**: an derselben Maschine arbeiten mehrere Sessions, und ein
 * Nachbar-Plugin kann einen stundenlangen Indexlauf in seinem Obsidian halten, dessen
 * Fortschritt nur im Speicher steht. Am 2026-08-30 waeren das zwei Stunden Rechenzeit
 * gewesen. Der Aufnahme-Vertrag anderer Repos beschreibt den Fall, dass sonst niemand
 * Obsidian benutzt; dieser Vorbehalt steht dort nicht dabei.
 *
 * Richtig ist:
 *   1. Laeuft schon ein Obsidian mit `--remote-debugging-port=9222`? Dann diesen Port
 *      mitbenutzen — und **vorher die Session fragen, der er gehoert**:
 *
 *      ```bash
 *      lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null && echo "belegt — erst fragen, wem"
 *      ```
 *
 *      ⚠️ Die Pruefung ersetzt die Frage nicht: sie zeigt aktive CDP-Treiber, aber nicht,
 *      wer ein Fenster offen haelt oder auf den Port wartet.
 *   2. Den Aufnahme-Vault per IPC oeffnen: in `obsidian.json` eintragen, dann
 *      `ipcRenderer.send("vault-open", <pfad>)` aus einem beliebigen Renderer. Das erzeugt
 *      ein zweites **Fenster im selben Prozess**. Weder `open -a Obsidian` noch
 *      `obsidian://open?path=` tun das.
 *   3. Dieser Treiber waehlt sein Fenster ueber den Vault-Namen (`VAULT_NAME`) und trifft
 *      fremde Fenster nicht.
 *   4. Laeuft GAR KEIN Obsidian, ist der klassische Weg zulaessig:
 *      `open -a Obsidian --args --remote-debugging-port=9222`.
 *
 * ## Fallstricke, die Zeit kosten, wenn man sie nicht kennt
 *
 * 1. **`openNote` UEBERSCHREIBT die Zieldatei** mit dem uebergebenen Body. Fuer vorhandene
 *    Fixture-Notizen `openExisting` — sonst stehen die Kapitel hinterher auf 0 Bytes, und
 *    ausgerechnet dieses Plugin lebt von seinen Kapiteln.
 * 2. **Chromium drosselt nicht-fokussierte Fenster.** `capture()` ruft deshalb selbst
 *    `Page.bringToFront` auf.
 * 3. **Die Einstellungen sind ein EIGENES Fenster** mit URL `about:blank`, und
 *    `attachTo("settings", …)` filtert **nicht** nach Vault: der Vault-Filter ist fuer
 *    `settings` per Kurzschluss abgeschaltet (`cdp.ts:466`), es gewinnt der erste Treffer.
 *    Bei zwei offenen Einstellungen-Fenstern ist die Wahl ein Muenzwurf — dieses Rezept
 *    waehlt sein Fenster deshalb ueber die HERKUNFT (s. u. beim settings-Shot).
 * 4. **Live Preview / Lesemodus bleiben zwischen Bildern stehen.** Jeder Shot stellt seine
 *    Voraussetzungen selbst her, statt sich auf den Vorgaenger zu verlassen.
 * 5. **HTML5-Drag laesst sich nicht synthetisieren.** Die Kapitel-Liste benutzt echtes
 *    `draggable`/`dragstart`; synthetische Mausereignisse loesen das in Chromium nicht aus.
 *    Das Umsortieren wird deshalb ueber `Alt+↓` gezeigt — dieselbe Funktion, zweiter Weg.
 * 6. **Das Ordner-Kontextmenue ist von aussen gar nicht zu oeffnen** — vier Wege gemessen,
 *    alle scheitern lautlos. Deshalb fehlt `folder-menu.png`; die Einzelheiten stehen im
 *    Vertrag unter "Nicht aufnehmbar". Wer es erneut versucht: dort nachlesen, nicht neu
 *    durchprobieren.
 * 7. **Ein Einstellungen-Fenster laesst sich nicht wieder schliessen.** `app.setting.close()`
 *    schliesst die Ansicht, nicht das Target, und `/json/close` meldet zwar
 *    "Target is closing", aendert an der Liste aber nichts (unabhaengig nachgemessen von
 *    der vault-rag-Session am 2026-08-30, an ihrem eigenen Fenster). Jeder Lauf mit
 *    `settings.png` hinterlaesst also ein `about:blank`-Target, und weil `attachTo`
 *    ("settings", …) nicht nach Vault filtern kann, macht das den naechsten Attach —
 *    auch den einer FREMDEN Session — mehrdeutig. Einziger bekannter Weg: das
 *    Vault-Fenster schliessen. Deshalb: **nach dem Aufnehmen das Aufnahme-Fenster zumachen.**
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, env, exit } from "node:process";

import {
  attachTo,
  Cdp,
  closeExtraLeaves,
  openExisting,
  requireUntil,
  setAppConfig,
} from "../../tools/obsidian-cdp/cdp.js";
import {
  boxAround,
  boxOf,
  capture,
  framesToGif,
  setWindowSize,
  writeShot,
  type Rect,
  type ShotOptions,
} from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "epub-exporter";
const PLUGIN_ID = "epub-exporter";
/** Vault-Name = Repo-Name. Der Filter in `attachTo` haengt daran. */
const VAULT_NAME = REPO_NAME;
const PORT = Number(env.CDP_PORT ?? 9222);

const REPO_ROOT = cwd();
const OUT_DIR = join(REPO_ROOT, "docs", "images");
const FIXTURE_DIR = join(OUT_DIR, "fixture");

/** Aus `_docs/readme/readme-spec.json`, Block `images`. Hier gespiegelt, weil der Treiber
 *  ohne den maintainer-lokalen `_docs`-Ordner laufen koennen muss; geprueft wird gegen die
 *  Quelle per `npm run shots:check`. */
const CAPTURE_WIDTH = 1200;
const THUMB_WIDTH = 380;
const WINDOW = { width: 1440, height: 900 };

/** Die Fixture-Pfade, wie sie IM VAULT liegen (buildVault kopiert `fixture/notes/` flach
 *  in die Vault-Wurzel). */
const BOOK = "Notes from the Salt Marsh.md";
const CHAPTER_DIR = "Chapters";
/** Der Spine im Auslieferungszustand — `reorder.gif` stellt ihn danach wieder her.
 *  Muss zur Buch-Notiz in `docs/images/fixture/notes/` passen. */
const SPINE = [
  "# Notes from the Salt Marsh",
  "",
  "![[01 - The Tide Line]]",
  "",
  "![[02 - Grey Weather]]",
  "",
  "![[03 - The Heron]]",
  "",
  "![[04 - Low Water]]",
  "",
  "![[05 - Going Back]]",
  "",
].join("\n");

interface Shot {
  name: string;
  klasse: "hero" | "feature" | "detail";
  zeigt: string;
  nimm: (cdp: Cdp) => Promise<{ png: Buffer; thumb?: boolean } | null>;
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

/** Panel oeffnen und auf gerenderten Inhalt warten. Der Aufruf ist idempotent. */
async function openPanel(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    const vorhanden = app.workspace.getLeavesOfType("epub-exporter-hub");
    if (vorhanden.length === 0) {
      await app.commands.executeCommandById("epub-exporter:open-sidebar");
    }
    return true;
  `);
  await requireUntil(cdp, `!!document.querySelector(".epub-sb-header")`, "Panel erschien nicht");
}

/** Buch-Notiz im Lesemodus oeffnen — die Voraussetzung fuer jedes Bild, das das Buch zeigt. */
async function openBook(cdp: Cdp, mode: "preview" | "source" = "preview"): Promise<void> {
  const ok = await openExisting(cdp, BOOK, mode);
  if (!ok) throw new Error(`Buch-Notiz ${BOOK} liess sich nicht oeffnen (gerendert?)`);
  // Das Panel folgt dem aktiven Blatt ueber `active-leaf-change`; ohne diese Wartephase
  // zeigt es beim ersten Bild noch den vorherigen Kontext.
  await requireUntil(
    cdp,
    `!!document.querySelector(".epub-sb-title") && !!document.querySelector(".epub-sb-chapter")`,
    "Panel zeigte die Kapitel des Buchs nicht",
  );
}

/**
 * Alle offenen Modals und Menues schliessen — **vor** jedem Bild, nicht nur nach dem, das
 * eines geoeffnet hat.
 *
 * Gemessen im zweiten Lauf (2026-08-30): das Konsolidieren-Modal blieb stehen, weil der
 * Klick auf "Abbrechen" es nicht zuverlaessig schliesst, und das naechste Bild
 * (`folder-menu.png`) scheiterte an einem Kontextmenue, das hinter dem Modal nie aufging.
 * Der Fehlschlag zeigte auf das falsche Bild: nicht das Kontextmenue war kaputt, sondern
 * sein Vorgaenger hatte aufgeraeumt, was er nicht aufraeumte.
 */
async function schliesseUeberlagerungen(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    // Obsidians eigener Weg zuerst — er raeumt auch den internen Stapel auf.
    while (app.workspace.activeEditor?.app?.modal) break;
    document.querySelectorAll(".modal-close-button").forEach((b) => b.click());
    document.querySelectorAll(".menu").forEach((m) => m.remove());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    return true;
  `);
}

/**
 * Fenster-Umgebung fuer die Aufnahme herstellen. Meldet `false`, wenn ein Neustart des
 * Laufs noetig ist (Sprachwechsel braucht ein Reload).
 *
 * **Warum die Sprache hierher gehoert:** `README.md` ist die kanonische Fassung und ist
 * englisch — Bilder mit deutscher Oberflaeche widersprechen ihr. Obsidian haelt die
 * Sprache in `localStorage.language`, nicht in `.obsidian/app.json`; sie laesst sich also
 * nicht ins Fixture legen und muss zur Laufzeit gesetzt werden. Der erste Lauf lieferte
 * sechs Bilder mit "BUCH-NOTIZ" und "Als EPUB exportieren" statt der englischen Strings,
 * und keine Messung haette das gezeigt.
 */
async function bereiteFensterVor(cdp: Cdp): Promise<boolean> {
  // Vertrauensdialog: `app.plugins.setEnable(true)` hebt den eingeschraenkten Modus auf,
  // schliesst aber den DIALOG nicht — er stand im ersten Lauf mitten im hero-Bild.
  await cdp.evaluate(`
    const knopf = [...document.querySelectorAll(".modal button")]
      .find((b) => /vertrauen|trust/i.test(b.textContent || ""));
    if (knopf) knopf.click();
    return true;
  `);
  await schliesseUeberlagerungen(cdp);

  const sprache = await cdp.evaluate<string>(`return document.documentElement.lang || (window.localStorage && localStorage.getItem("language")) || "en";`);
  if (sprache !== "en") {
    await cdp.evaluate(`localStorage.setItem("language", "en"); return true;`);
    // Reload nur im EIGENEN Fenster — nie im Fenster einer anderen Session.
    await cdp.evaluate(`setTimeout(() => location.reload(), 50); return true;`).catch(() => undefined);
    return false;
  }
  return true;
}

/**
 * Box um den **tatsaechlichen Inhalt** eines Containers, nicht um den Container.
 *
 * Obsidian-Panels und Tab-Inhalte sind Volle-Hoehe-Flex-Elemente: ein Bild ihrer
 * Bounding-Box besteht zum guten Teil aus leerer Flaeche unter dem letzten Element.
 * Gemessen 2026-08-30: `sidebar-book.png` war 1200x3163, davon rund zwei Drittel leer.
 * Deshalb wird die Box aus den Kind-Elementen gerechnet — oberste Kante des ersten,
 * unterste des letzten mit echter Ausdehnung.
 */
async function inhaltsBox(
  cdp: Cdp,
  kindSelektor: string,
  rand = 16,
): Promise<Rect | null> {
  const roh = await cdp.evaluate<string | null>(`
    const teile = [...document.querySelectorAll(${JSON.stringify(kindSelektor)})]
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 1 && r.height > 1);
    if (!teile.length) return null;
    const x = Math.min(...teile.map((r) => r.x));
    const y = Math.min(...teile.map((r) => r.y));
    const rechts = Math.max(...teile.map((r) => r.right));
    const unten = Math.max(...teile.map((r) => r.bottom));
    return JSON.stringify({ x, y, width: rechts - x, height: unten - y });
  `);
  if (!roh) return null;
  const r = JSON.parse(roh) as Rect;
  return {
    x: Math.max(0, r.x - rand),
    y: Math.max(0, r.y - rand),
    width: r.width + rand * 2,
    height: r.height + rand * 2,
  };
}

/** Warten, bis Obsidian die Ansicht wirklich gemalt hat. */
async function ruhe(ms = 400): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Der Vertrag, ausfuehrbar
// ---------------------------------------------------------------------------

const SHOTS: Shot[] = [
  {
    name: "hero.png",
    klasse: "hero",
    zeigt: "Buch-Notiz im Lesemodus, daneben das Panel mit der Kapitelliste",
    async nimm(cdp) {
      await closeExtraLeaves(cdp);
      await openPanel(cdp);
      await openBook(cdp, "preview");
      await ruhe(600);
      // Ganzes Fenster: die Aussage ist das Nebeneinander von Buch und Panel, nicht eines
      // von beiden. Querformat ist damit automatisch erfuellt (1440x900).
      return { png: await capture(cdp) };
    },
  },
  {
    name: "sidebar-book.png",
    klasse: "detail",
    zeigt: "Panel im Buch-Kontext: Kapitel, Ziehhinweis, drei Schaltflaechen",
    async nimm(cdp) {
      await openPanel(cdp);
      await openBook(cdp, "preview");
      await ruhe();
      // Alle sichtbaren Teile des Panels — Kopf, Kapitelliste, Schaltflaechen.
      const box = await inhaltsBox(
        cdp,
        ".epub-sb-header, .epub-sb-subtitle, .epub-sb-chapters-label, .epub-sb-chapters, .epub-sb-btn",
        14,
      );
      if (!box) return null;
      // scale 2: der Ausschnitt ist schmaler als CAPTURE_WIDTH, ohne Supersampling
      // begrenzt der Lint die Anzeigebreite auf die halbe Dateibreite.
      return { png: await capture(cdp, box, 2) };
    },
  },
  {
    name: "reorder.gif",
    klasse: "detail",
    zeigt: "Alt+↓ verschiebt ein Kapitel — die Embed-Zeile in der Notiz wandert mit",
    async nimm(cdp) {
      await openPanel(cdp);
      // Quelltext, nicht Lesemodus: die zweite Haelfte der Aussage ist, dass sich die
      // Embed-ZEILE in der Notiz bewegt. Im Lesemodus waere davon nichts zu sehen.
      await openBook(cdp, "source");
      await ruhe(600);

      const frameDir = join(OUT_DIR, ".frames");
      rmSync(frameDir, { recursive: true, force: true });
      mkdirSync(frameDir, { recursive: true });

      // Inhaltsbewusst, sonst besteht das GIF zu zwei Dritteln aus leerer Sidebar
      // (gemessen: 820x1774 bei ~650 px Inhalt). Panel-Teile UND Lesefläche zusammen —
      // die Aussage braucht beide Hälften.
      const box = await inhaltsBox(
        cdp,
        ".epub-sb-header, .epub-sb-chapters, .epub-sb-btn, .markdown-preview-sizer, .cm-content",
        10,
      );
      if (!box) return null;

      let n = 0;
      const frame = async (): Promise<void> => {
        const png = await capture(cdp, box, 1);
        writeFileSync(join(frameDir, `frame-${String(++n).padStart(3, "0")}.png`), png);
      };

      // Zweites Kapitel fokussieren, dann zweimal Alt+↓ — mit Bildern davor, dazwischen
      // und danach, damit die Bewegung im GIF lesbar ist statt zu springen.
      await cdp.evaluate(`
        const kapitel = [...document.querySelectorAll(".epub-sb-chapter")]
          .filter((e) => e.getBoundingClientRect().height > 1);
        kapitel[1]?.focus();
        return true;
      `);
      await ruhe(300);
      for (let i = 0; i < 3; i++) await frame();

      for (let schritt = 0; schritt < 2; schritt++) {
        await cdp.evaluate(`
          const el = document.activeElement;
          el?.dispatchEvent(new KeyboardEvent("keydown", {
            key: "ArrowDown", altKey: true, bubbles: true, cancelable: true,
          }));
          return true;
        `);
        await ruhe(700);
        for (let i = 0; i < 3; i++) await frame();
      }
      for (let i = 0; i < 4; i++) await frame();

      const meldung = framesToGif(frameDir, join(OUT_DIR, "reorder.gif"), { fps: 6, width: 820 });
      console.log(`   ${meldung}`);
      rmSync(frameDir, { recursive: true, force: true });

      // ⚠️ ZUSTAND ZURUECKSETZEN — dieser Shot ist der einzige, der den Pruefling
      // WIRKLICH veraendert: `Alt+↓` schreibt die neue Reihenfolge atomar in die
      // Buch-Notiz. Ohne das Zuruecksetzen zeigt jedes spaetere Bild die verwuerfelte
      // Reihenfolge, und zwar dauerhaft — der naechste Lauf beginnt dort, wo dieser
      // aufhoerte, und schiebt sie weiter. Gemessen 2026-08-30: hero.png zeigte
      // "01, 03, 04, 02, 05", und kein Messwert haette das gemeldet; nur das Bild.
      await cdp.evaluate(`
        const datei = app.vault.getAbstractFileByPath(${JSON.stringify(BOOK)});
        const text = await app.vault.read(datei);
        const kopf = text.slice(0, text.indexOf("# "));
        await app.vault.modify(datei, kopf + ${JSON.stringify(SPINE)});
        await new Promise((r) => setTimeout(r, 500));
        return true;
      `);
      // Das GIF schreibt framesToGif selbst — kein png fuer writeShot.
      return null;
    },
  },
  {
    name: "consolidate-modal.png",
    klasse: "feature",
    zeigt: "Bestaetigungs-Modal mit beiden Auswahlgruppen (Kopieren/Verschieben, Bilder)",
    async nimm(cdp) {
      await openPanel(cdp);
      await openBook(cdp, "preview");
      await ruhe();
      await cdp.evaluate(`
        const btn = [...document.querySelectorAll(".epub-sb-action-consolidate")]
          .find((e) => e.getBoundingClientRect().height > 1);
        btn?.click();
        return true;
      `);
      await requireUntil(cdp, `!!document.querySelector(".epub-consolidate-modal")`, "Modal kam nicht");
      await ruhe(400);
      const box = await boxOf(cdp, ".modal-container .modal", 0);
      const png = box ? await capture(cdp, box, 2) : await capture(cdp);
      // Wieder schliessen — ein offenes Modal wuerde jedes Folgebild verdecken.
      await cdp.evaluate(`
        const abbruch = [...document.querySelectorAll(".modal button")]
          .find((b) => b.getBoundingClientRect().height > 1 && !b.classList.contains("mod-cta"));
        abbruch?.click();
        return true;
      `);
      await ruhe(300);
      return { png };
    },
  },
  {
    name: "settings.png",
    klasse: "detail",
    zeigt: "Einstellungen-Tab, alle sechs Einstellungen",
    async nimm(cdp) {
      // Das Einstellungen-Fenster ueber seine HERKUNFT identifizieren, nicht ueber
      // `attachTo("settings", …)`.
      //
      // Grund: Das Settings-Fenster traegt kein `window.app` (`cdp.ts:449`), ein Filter
      // ueber den VAULT-NAMEN aus dem Renderer ist dort also unmoeglich — bei zwei offenen
      // Fenstern waehlt die Bruecke das erstbeste und warnt nur. In einem Workspace, in dem
      // mehrere Sessions am selben Obsidian arbeiten, ist das ein Muenzwurf mit fremden
      // Fenstern.
      //
      // ⚠️ „Unmoeglich" gilt nur fuer den Weg ueber `window.app`, nicht generell: der
      // Fenstertitel traegt den Vault-Namen und steht bereits in `/json/list`, also VOR dem
      // WebSocket-Connect. Das Dach baut daraus gerade einen Filter (Stand 2026-08-30).
      //
      // Zwei Praezisierungen, damit ihn niemand ueberdehnt:
      //   * Der Titel trennt den VAULT, nicht die ART. `"Settings - epub-exporter - …"` und
      //     `"Notes from the Salt Marsh - epub-exporter - …"` tragen denselben Teilstring;
      //     ob ein Fenster die Einstellungen sind, entscheidet weiterhin `window.app`.
      //   * Stabil ist nur `" - <vault> - Obsidian"`. Das erste Wort ist lokalisiert und
      //     wechselt sogar INNERHALB einer Sitzung — dieses Rezept stellt die UI-Sprache um,
      //     danach standen `Settings -` und `Einstellungen -` fuer denselben Vault
      //     gleichzeitig in der Liste (gemessen 2026-08-30).
      // Bis der Filter da ist, bleibt die Herkunfts-Methode unten der verlaessliche Weg.
      //
      // Die Bruecke nennt den richtigen Weg in ihrem eigenen Kommentar als noch nicht
      // gebaut: `/json/list` vor und nach `app.setting.open()` vergleichen — das NEU
      // hinzugekommene Target ist unseres. Genau das passiert hier. Nebenertrag: wir
      // koennen es am Ende gezielt schliessen, was `app.setting.close()` nicht tut (es
      // schliesst die Ansicht, nicht das Target — drei verwaiste Fenster in vier Laeufen,
      // gemessen 2026-08-30).
      const ziele = async (): Promise<Set<string>> => {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        const l = (await r.json()) as { id: string; type: string; url: string }[];
        return new Set(l.filter((t) => t.type === "page" && t.url === "about:blank").map((t) => t.id));
      };

      const vorher = await ziele();
      await cdp.evaluate(`
        app.setting.open();
        app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
        return true;
      `);
      await ruhe(1200);

      const neueIds = [...(await ziele())].filter((id) => !vorher.has(id));
      if (neueIds.length !== 1) {
        throw new Error(
          `Erwartet: genau EIN neues Einstellungen-Fenster, gefunden: ${neueIds.length}. ` +
          "Bei 0 hat sich das Fenster nicht geoeffnet; bei mehreren laesst sich unseres " +
          "nicht bestimmen — dann lieber abbrechen als ein fremdes Fenster fotografieren.",
        );
      }
      const meineId = neueIds[0] as string;

      const liste = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as
        { id: string; webSocketDebuggerUrl?: string }[];
      const url = liste.find((t) => t.id === meineId)?.webSocketDebuggerUrl;
      if (!url) throw new Error("Einstellungen-Fenster ohne Debugger-URL");

      const s = await Cdp.connect(url);
      try {
        await requireUntil(s, `!!document.querySelector(".setting-item")`, "Tab kam nicht");
        await ruhe(400);
        // Inhaltsbewusster Zuschnitt: der Tab-Container ist ein Volle-Hoehe-Flex-Element.
        const box = await inhaltsBox(s, ".setting-item", 20);
        const png = box ? await capture(s, box, 2) : await capture(s);
        return { png, thumb: true };
      } finally {
        s.close();
        // Versuch, DAS Target zu schliessen, das wir geoeffnet haben — nie pauschal alle
        // `about:blank`-Fenster: eines davon koennte einer anderen Session gehoeren.
        //
        // ⚠️ Das schlaegt fehl, und zwar still: `/json/close` antwortet "Target is closing",
        // die Liste bleibt danach unveraendert (zweimal mit Wartezeit nachgeprueft, und
        // unabhaengig von der vault-rag-Session an ihrem eigenen Fenster bestaetigt).
        // Der Aufruf bleibt trotzdem stehen — er kostet nichts und wird richtig, sobald
        // Electron/Obsidian das Target freigibt. Verlass dich nicht darauf: nach dem Lauf
        // das Aufnahme-FENSTER schliessen, das ist der einzige Weg, der wirklich raeumt.
        await fetch(`http://127.0.0.1:${PORT}/json/close/${meineId}`).catch(() => undefined);
        await ruhe(300);
      }
    },
  },
];

// ---------------------------------------------------------------------------
// Ablaufsteuerung
// ---------------------------------------------------------------------------

function zeigeVertrag(): void {
  console.log(`Aufnahme-Vertrag — ${SHOTS.length} Bilder (docs/images/README.md)\n`);
  for (const s of SHOTS) {
    console.log(`  ${s.name.padEnd(24)} [${s.klasse}]  ${s.zeigt}`);
  }
}

function setup(): void {
  const vaultDir = stagingVaultDir(REPO_NAME);
  const log = buildVault({
    repoRoot: REPO_ROOT,
    vaultDir,
    fixtureDir: FIXTURE_DIR,
    pluginId: PLUGIN_ID,
  });
  console.log(`Aufnahme-Vault: ${vaultDir}`);
  for (const zeile of log) console.log(`  ${zeile}`);
  console.log(
    "\nJetzt den Vault oeffnen — NICHT Obsidian beenden, falls es laeuft (Single-Instance,\n" +
    "siehe Dateikopf). Zweites Fenster per IPC:\n" +
    `  ipcRenderer.send("vault-open", ${JSON.stringify(vaultDir)})\n` +
    "Danach: npm run shots",
  );
}

async function aufnehmen(nur?: string): Promise<number> {
  const cdp = await attachTo("workspace", PORT, VAULT_NAME);
  if (!cdp) {
    console.error(
      `Kein Obsidian-Fenster fuer Vault "${VAULT_NAME}" auf Port ${PORT}.\n` +
      "Laeuft Obsidian mit --remote-debugging-port, und ist der Aufnahme-Vault offen?\n" +
      "Siehe Dateikopf: der Vault wird per IPC geoeffnet, nicht durch einen Neustart.",
    );
    return 1;
  }

  let fehler = 0;
  try {
    if (!(await bereiteFensterVor(cdp))) {
      console.log(
        "Oberflaechensprache auf Englisch umgestellt — das Fenster laedt neu.\n" +
        "Die kanonische README ist englisch; deutsche Screenshots widersprechen ihr.\n" +
        "Bitte `npm run shots` gleich noch einmal starten.",
      );
      return 0;
    }
    await setWindowSize(cdp, WINDOW.width, WINDOW.height);
    // Der Inline-Titel wuerde die H1 der Buch-Notiz doppeln; zur Laufzeit setzen, weil
    // `.obsidian/app.json` bei laufendem Obsidian nicht mehr gelesen wird.
    await setAppConfig(cdp, "showInlineTitle", false);
    await setAppConfig(cdp, "readableLineLength", true);
    // NICHT `showFrontmatter` — das ist der Quelltext-Editor. Im Lesemodus heisst der
    // Schluessel `propertiesInDocument`, und mit "visible" fuellte die Eigenschaften-
    // Tabelle die obere Haelfte von hero.png, waehrend das Buch erst darunter anfing
    // (gemessen 2026-08-30). Die Aussage des Bildes ist der Fliesstext, nicht das YAML.
    await setAppConfig(cdp, "propertiesInDocument", "hidden");

    const opts: ShotOptions = {
      outDir: OUT_DIR,
      captureWidth: CAPTURE_WIDTH,
      thumbWidth: THUMB_WIDTH,
    };

    for (const shot of SHOTS) {
      if (nur && shot.name !== nur) continue;
      process.stdout.write(`${shot.name} … `);
      try {
        await schliesseUeberlagerungen(cdp);
        const ergebnis = await shot.nimm(cdp);
        if (!ergebnis) {
          // reorder.gif schreibt selbst; alles andere ist ein Fehlschlag.
          console.log(shot.name.endsWith(".gif") ? "ok" : "KEIN BILD (Zustand kam nicht zustande)");
          if (!shot.name.endsWith(".gif")) fehler++;
          continue;
        }
        const hinweis = await writeShot(cdp, shot.name, ergebnis.png, {
          ...opts,
          thumb: ergebnis.thumb ?? shot.klasse === "detail",
        });
        console.log(hinweis);
      } catch (e) {
        console.log(`FEHLER: ${(e as Error).message}`);
        fehler++;
      }
    }
  } finally {
    cdp.close();
  }

  console.log(
    fehler === 0
      ? "\nAlle Bilder geschrieben. JETZT ANSEHEN — jedes einzeln, ganzes Fenster.\n" +
        "Ein misslungener Lauf hinterlaesst schlechtere Bilder an derselben Stelle,\n" +
        "ohne dass etwas fehlschlaegt. Danach: npm run shots:check"
      : `\n${fehler} Bild(er) fehlgeschlagen.`,
  );
  return fehler === 0 ? 0 : 1;
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
  if (nur && !SHOTS.some((s) => s.name === nur)) {
    console.error(`Unbekanntes Bild: ${nur}\nBekannt: ${SHOTS.map((s) => s.name).join(", ")}`);
    exit(1);
  }
  exit(await aufnehmen(nur));
}

void main();
