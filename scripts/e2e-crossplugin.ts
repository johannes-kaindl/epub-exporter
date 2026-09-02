/**
 * Ende-zu-Ende-Beleg ueber die PLUGIN-GRENZE — epub-exporter → local-image-generator → Vault.
 *
 * **Warum das nicht in `gui-smoke.ts` gehoert und kein Teil von `npm run gate` ist:**
 * Unsere Titelbild-Pruefpunkte T1–T3 fahren gegen einen **Stub**, den der Treiber selbst ins
 * Plugin-Register setzt; der Smoke des Nachbarn ruft seine eigene API selbst auf. Beides ist je
 * fuer sich richtig — CORE-TEST-02 (b) verlangt die Verdrahtung getrackt im Repo, das sie
 * besitzt, und kein Treiber soll an eine fremde Installation gebunden sein. Die Folge ist aber,
 * dass **beide** Treiber genau die Naht ueberspringen: wo zwei Repos je ihre Haelfte pruefen,
 * prueft niemand die Verbindung (REGISTRY, Zeile „Eine Faehigkeit fuer andere Obsidian-Plugins
 * bereitstellen"; an llm-lab 0.3.0 gemessen). Dieses Skript prueft nur sie — und setzt deshalb
 * ausdruecklich voraus, was der Smoke ausdruecklich nicht voraussetzt: **beide Plugins echt
 * installiert im selben Vault**.
 *
 * **Was hier echt ist und was nicht — die Grenze bitte nicht verschieben.** Echt sind: das
 * installierte Nachbarplugin, sein `api`-Objekt, unsere Erkennung, jeder Aufruf ueber die
 * Grenze, die zurueckgereichten Bytes, unsere Schreibreihenfolge. **Ersetzt ist nur das
 * Rechnen dahinter** — `scripts/mock-a1111.mjs` aus dem Nachbar-Repo antwortet als
 * A1111-kompatibler Server, damit ein Lauf Sekunden statt Minuten dauert und keine GPU
 * braucht. Der Mock sitzt HINTER dem Nachbarplugin, nicht zwischen ihm und uns: die Naht,
 * um die es geht, ist vollstaendig im Spiel. Was ein Mock-Backend nicht belegen kann, ist die
 * Bildqualitaet — die ist auch nicht Gegenstand dieses Repos.
 *
 * Der Spy auf `api.generate` **wrappt und reicht durch** — er ersetzt nichts, sonst pruefte
 * man wieder nur die eigene Haelfte (REGISTRY, ebenda). Das gilt bis in den Callback hinein:
 * `onProgress` wird umhuellt, nicht ausgetauscht, sonst naehme der Pruefstand der Oberflaeche
 * genau das Signal weg, das er messen soll. Am Ende wird er **zurueckgebaut**; N8 misst das
 * mit, weil ein stehengebliebener Wrapper still jeden spaeteren Lauf im selben Fenster
 * verfaelscht.
 *
 * ```bash
 * npm run smoke:e2e -- --setup   # Staging-Vault + BEIDE Plugins installieren
 * npm run smoke:e2e              # Vault epub-exporter, Port 9222 (CDP_PORT), Mock auf 7861
 * ```
 *
 * Der Mock wird vom Treiber selbst gestartet, wenn auf `MOCK_PORT` keiner antwortet, und dann
 * am Ende auch selbst beendet — beendet wird ausdruecklich **nur ein selbst gestarteter**:
 * laeuft dort schon einer (etwa aus dem Smoke des Nachbarn), ist er fremdes Eigentum.
 *
 * **Zur vierten Kategorie** (Hinweis aus der obsidian-transmute-Session, 2026-09-02): eine
 * Bilanz kann „N/N gruen" melden und „alles, was ich geschafft habe" meinen, wenn Pruefpunkte
 * waehrend des Laufs entstehen und ein Absturz die restlichen nie anlegt. Hier nachgemessen,
 * nicht abgehakt: die Punktliste ist **statisch deklariert** (`PRUEFPUNKTE`), jeder Punkt
 * liegt einzeln in `try/catch` — ein abgestuerzter Punkt wird rot, keiner verschwindet. Und
 * die Bilanzzeile steht **hinter** dem `finally`: wirft etwas vor der Schleife (Mock kommt
 * nicht hoch, kein Fenster), gibt es gar keine Bilanz statt einer schmeichelhaften.
 *
 * Durchlauf-Vermerke: `docs/SMOKE.md` § Ende-zu-Ende ueber die Plugin-Grenze.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, env, exit } from "node:process";
import {
  attachTo,
  clickReal,
  closeExtraLeaves,
  openExisting,
  requireUntil,
  requireVisible,
  type Cdp,
} from "../../tools/obsidian-cdp/cdp.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "epub-exporter";
const PLUGIN_ID = "epub-exporter";
const VAULT_NAME = REPO_NAME;
const PORT = Number(env.CDP_PORT ?? 9222);

const REPO_ROOT = cwd();
const FIXTURE_DIR = join(REPO_ROOT, "docs", "images", "fixture");

/** Das Nachbarplugin — Anbieter der Provider-API v1. */
const LIG_ID = "local-image-generator";
const LIG_REPO = join(REPO_ROOT, "..", LIG_ID);
const MOCK_PORT = Number(env.MOCK_PORT ?? 7861);
const ENDPOINT = `http://127.0.0.1:${MOCK_PORT}`;

/** Eigenes Pruefmaterial — beruehrt weder das Bild-Fixture noch den `_smoke`-Ordner des
 *  GUI-Smokes, damit ein Abbruch hier keinen anderen Treiber beschaedigt. */
const E2E_DIR = "_e2e";
const E2E_BOOK = `${E2E_DIR}/Crossplugin Book.md`;
const E2E_BOOK_TITLE = "Crossplugin Book";
const E2E_COVER = `${E2E_DIR}/Crossplugin Book cover.png`;
const E2E_PROMPT = "a crossplugin cover, grey pebble on white paper";
const E2E_CHAPTER = `${E2E_DIR}/C1 Erstes.md`;
const E2E_BOOK_BODY =
  "---\n" +
  "epub: true\n" +
  `title: ${E2E_BOOK_TITLE}\n` +
  "author: E2E\n" +
  "language: en\n" +
  "---\n\n" +
  `# ${E2E_BOOK_TITLE}\n\n` +
  "![[C1 Erstes]]\n";

interface Pruefpunkt {
  id: string;
  was: string;
  /** Braucht echte Diffusion auf dieser Maschine — laeuft nur mit `--gpu`. Ein Pruefstand,
   *  der Minuten kostet, wird sonst nicht mehr gefahren, und dann misst er gar nichts. */
  nurMitGpu?: boolean;
  /** `null` bei Erfolg, sonst der Grund im Klartext — eine Bilanzzeile ohne Eingabe und
   *  Antwort blockiert die Fehlersuche (CORE-TEST-14). */
  pruefe: (cdp: Cdp) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

async function schreibeDatei(cdp: Cdp, pfad: string, inhalt: string): Promise<void> {
  await cdp.evaluate(`
    const p = ${JSON.stringify(pfad)};
    const ordner = p.split("/").slice(0, -1).join("/");
    if (ordner && !app.vault.getAbstractFileByPath(ordner)) await app.vault.createFolder(ordner);
    const f = app.vault.getAbstractFileByPath(p);
    if (f) await app.vault.modify(f, ${JSON.stringify(inhalt)});
    else await app.vault.create(p, ${JSON.stringify(inhalt)});
    return true;
  `);
}

async function leseDatei(cdp: Cdp, pfad: string): Promise<string | null> {
  return cdp.evaluate<string | null>(`
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(pfad)});
    return f ? await app.vault.read(f) : null;
  `);
}

/** Base64 einer Vault-Datei — fuer den Byte-Vergleich gegen das, was der Anbieter lieferte. */
async function leseBinaerBase64(cdp: Cdp, pfad: string): Promise<string | null> {
  return cdp.evaluate<string | null>(`
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(pfad)});
    if (!f) return null;
    const bytes = new Uint8Array(await app.vault.readBinary(f));
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  `);
}

async function inDenPapierkorb(cdp: Cdp, pfade: string[]): Promise<void> {
  await cdp.evaluate(`
    for (const p of ${JSON.stringify(pfade)}) {
      const f = app.vault.getAbstractFileByPath(p);
      if (f) await app.fileManager.trashFile(f);
    }
    return true;
  `);
}

/** Buch-Notiz und Kapitel in den Auslieferungszustand bringen; jeder Punkt stellt seinen
 *  Vorzustand selbst her, sonst misst `--only` etwas anderes als der Gesamtlauf. */
async function schreibeE2EBuch(cdp: Cdp): Promise<void> {
  await schreibeDatei(cdp, E2E_CHAPTER, "# Erstes\n\nEin Absatz.\n");
  await schreibeDatei(cdp, E2E_BOOK, E2E_BOOK_BODY);
  await cdp.evaluate(`await new Promise((r) => setTimeout(r, 400)); return true;`);
}

async function oeffnePanel(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    if (app.workspace.getLeavesOfType("epub-exporter-hub").length === 0) {
      await app.commands.executeCommandById("epub-exporter:open-sidebar");
    }
    return true;
  `);
  await requireUntil(cdp, `document.querySelector(".epub-sb-header")`, "Panel erschien nicht");
}

async function oeffneBuch(cdp: Cdp): Promise<void> {
  const ok = await openExisting(cdp, E2E_BOOK, "preview");
  if (!ok) throw new Error(`Notiz ${E2E_BOOK} liess sich nicht oeffnen`);
  await requireUntil(
    cdp,
    `document.querySelector(".epub-sb-chapter")`,
    "Panel uebernahm den Kontext der Buch-Notiz nicht",
  );
}

async function schliesseUeberlagerungen(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    for (const el of document.querySelectorAll(".modal-container")) el.remove();
    for (const el of document.querySelectorAll(".notice")) el.remove();
    return true;
  `);
}

/** Beide Plugins neu laden — der Hash-Guard sagt nichts darueber, was geladen IST. Nach
 *  einer Settings-Aenderung am Nachbarn ist es ausserdem der einzige Weg, der auch seinen
 *  Laufzeitzustand (`readiness()`) neu rechnen laesst. */
async function ladeBeideNeu(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    for (const id of [${JSON.stringify(LIG_ID)}, ${JSON.stringify(PLUGIN_ID)}]) {
      await app.plugins.disablePlugin(id);
      await app.plugins.enablePlugin(id);
    }
    await new Promise((r) => setTimeout(r, 1200));
    return "reloaded";
  `);
}

/** Einstellungen des NACHBARN setzen und ihn damit neu starten. Bewusst ueber seine
 *  `saveData` + Neuladen statt ueber einen Griff in seinen Laufzeitzustand: was hier
 *  geprueft wird, ist sein echtes Verhalten in einer echten Konfiguration. */
async function setzeLigModus(
  cdp: Cdp,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return cdp.evaluate<Record<string, unknown>>(`
    const p = app.plugins.plugins[${JSON.stringify(LIG_ID)}];
    Object.assign(p.settings, ${JSON.stringify(patch)});
    await p.saveData(p.settings);
    await app.plugins.disablePlugin(${JSON.stringify(LIG_ID)});
    await app.plugins.enablePlugin(${JSON.stringify(LIG_ID)});
    await new Promise((r) => setTimeout(r, 800));
    return app.plugins.plugins[${JSON.stringify(LIG_ID)}].api.status();
  `);
}

/**
 * Spy auf `api.generate` — wrappt und reicht durch, einschliesslich `onProgress`.
 *
 * Zwei Sicherungen, weil sie verschiedene Faelle decken: `__e2eOrig` haelt das Original fuer
 * den Aufraeumblock, und der Wrapper prueft `window.__e2e` trotzdem selbst — der
 * Aufraeumblock laeuft NICHT, wenn der Treiber vorher abbricht, und eine tote Closure wuerde
 * danach jeden Titelbild-Lauf im Fenster verfaelschen.
 */
async function setzeSpy(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    window.__e2e = { calls: [], progress: [] };
    const api = app.plugins.plugins[${JSON.stringify(LIG_ID)}].api;
    if (!api.__wrapped) {
      const orig = api.generate.bind(api);
      api.__e2eOrig = orig;
      api.generate = async (req) => {
        const durchgereicht = {
          ...req,
          onProgress: (pct, phase) => {
            if (window.__e2e) window.__e2e.progress.push([pct, phase]);
            return req.onProgress ? req.onProgress(pct, phase) : undefined;
          },
        };
        const res = await orig(durchgereicht);
        if (window.__e2e) {
          window.__e2e.calls.push({
            prompt: req.prompt,
            width: req.width ?? null,
            height: req.height ?? null,
            hatCallback: typeof req.onProgress === "function",
            ok: !!res.ok,
            reason: res.ok ? null : res.reason,
            message: res.ok ? null : (res.message ?? null),
            base64: res.ok ? res.image.base64 : null,
            seed: res.ok ? res.image.params.seed : null,
          });
        }
        return res;
      };
      api.__wrapped = true;
    }
    return true;
  `);
}

interface SpyCall {
  prompt: string;
  width: number | null;
  height: number | null;
  hatCallback: boolean;
  ok: boolean;
  reason: string | null;
  message: string | null;
  base64: string | null;
  seed: number | null;
}

async function leseSpy(cdp: Cdp): Promise<{ calls: SpyCall[]; progress: [number | null, string][] }> {
  return cdp.evaluate(`return window.__e2e ?? { calls: [], progress: [] };`);
}

async function baueSpyZurueck(cdp: Cdp): Promise<string> {
  return cdp.evaluate<string>(`
    const p = app.plugins.plugins[${JSON.stringify(LIG_ID)}];
    if (!p) return "kein Anbieter";
    const api = p.api;
    if (api.__e2eOrig) { api.generate = api.__e2eOrig; delete api.__e2eOrig; }
    delete api.__wrapped;
    delete window.__e2e;
    return api.__wrapped === undefined && typeof api.generate === "function" ? "clean" : "dirty";
  `);
}

/** Titelbild-Dialog ueber die Oberflaeche oeffnen: Knopf im Panel, echter Mausklick.
 *  Die Haltedauer ist Pflicht — ohne sie geht der Klick schneller raus als der
 *  asynchrone Rerender der Sidebar (AGENTS.md § Gotchas). */
async function klickeTitelbildKnopf(cdp: Cdp): Promise<void> {
  await requireUntil(
    cdp,
    `document.querySelector(".epub-sb-action-cover")`,
    "Titelbild-Knopf fehlt, obwohl der Anbieter installiert ist",
  );
  await clickReal(cdp, `document.querySelector(".epub-sb-action-cover")`, 200);
}

async function tippePromptUndErzeuge(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    const ta = document.querySelector(".epub-cover-modal .epub-cover-prompt");
    ta.value = ${JSON.stringify(E2E_PROMPT)};
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  `);
  await clickReal(
    cdp,
    `Array.from(document.querySelectorAll(".epub-cover-modal button")).find((b) => b.classList.contains("mod-cta"))`,
    200,
  );
}

// ---------------------------------------------------------------------------
// Mock-Backend (haengt HINTER dem Nachbarplugin, nicht zwischen ihm und uns)
// ---------------------------------------------------------------------------

/** Juengste mtime unter einem Verzeichnisbaum — fuer den Build-Guard des Nachbarn. */
function juengsteAenderung(wurzel: string): number {
  let neueste = 0;
  for (const e of readdirSync(wurzel, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const m = statSync(join(e.parentPath ?? wurzel, e.name)).mtimeMs;
    if (m > neueste) neueste = m;
  }
  return neueste;
}

let mockProzess: ChildProcess | null = null;

async function mockAntwortet(): Promise<boolean> {
  try {
    const r = await fetch(`${ENDPOINT}/mock/fail?on=0`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function starteMockFallsNoetig(): Promise<void> {
  if (await mockAntwortet()) {
    console.log(`  Mock-Backend antwortet bereits auf ${ENDPOINT} (fremdes Eigentum, bleibt stehen)`);
    return;
  }
  const skript = join(LIG_REPO, "scripts", "mock-a1111.mjs");
  if (!existsSync(skript)) {
    throw new Error(
      `Mock-Backend nicht gefunden: ${skript}\n` +
        "Dieses Skript setzt das Nachbar-Repo neben diesem voraus (es liefert Plugin UND Mock).",
    );
  }
  mockProzess = spawn("node", [skript], {
    cwd: LIG_REPO,
    env: { ...env, MOCK_PORT: String(MOCK_PORT), MOCK_DELAY_MS: env.MOCK_DELAY_MS ?? "1500" },
    stdio: "ignore",
    detached: false,
  });
  for (let i = 0; i < 40; i++) {
    if (await mockAntwortet()) {
      console.log(`  Mock-Backend gestartet auf ${ENDPOINT}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Mock-Backend kam auf ${ENDPOINT} nicht hoch`);
}

async function mockFehlermodus(an: boolean): Promise<void> {
  const r = await fetch(`${ENDPOINT}/mock/fail?on=${an ? 1 : 0}`, { signal: AbortSignal.timeout(2000) });
  if (!r.ok) throw new Error(`Mock-Fehlermodus liess sich nicht schalten (HTTP ${r.status})`);
}

// ---------------------------------------------------------------------------
// Pruefpunkte
// ---------------------------------------------------------------------------

const PRUEFPUNKTE: Pruefpunkt[] = [
  {
    id: "N1",
    was: "Das ECHT installierte Nachbarplugin wird als Anbieter erkannt",
    pruefe: async (cdp) => {
      // Kein Stub im Spiel: was hier antwortet, ist das geladene Plugin. Geprueft wird
      // beides — die Zusage des Anbieters (apiVersion, Form) und unsere Wirkung daraus
      // (der Knopf erscheint). Der Stub kann nur die zweite Haelfte belegen.
      const stubDa = await cdp.evaluate<boolean>(`return !!window.__epubStubGesetzt;`);
      if (stubDa) return "Ein Stub aus dem GUI-Smoke steht noch im Register — dieser Lauf waere wertlos";

      const info = await cdp.evaluate<{
        installiert: boolean;
        aktiv: boolean;
        apiVersion: unknown;
        hatStatus: boolean;
        hatGenerate: boolean;
        hatRecheck: boolean;
        version: string | null;
      }>(`
        const p = app.plugins.plugins[${JSON.stringify(LIG_ID)}];
        return {
          installiert: !!p,
          aktiv: app.plugins.enabledPlugins.has(${JSON.stringify(LIG_ID)}),
          apiVersion: p?.api?.apiVersion ?? null,
          hatStatus: typeof p?.api?.status === "function",
          hatGenerate: typeof p?.api?.generate === "function",
          hatRecheck: typeof p?.api?.recheck === "function",
          version: app.plugins.manifests[${JSON.stringify(LIG_ID)}]?.version ?? null,
        };
      `);
      if (!info.installiert || !info.aktiv) {
        return `Nachbarplugin nicht aktiv installiert (installiert=${info.installiert}, aktiv=${info.aktiv}) — erst \`npm run smoke:e2e -- --setup\``;
      }
      if (info.apiVersion !== 1 || !info.hatStatus || !info.hatGenerate) {
        return `Anbieter meldet eine andere Form als erwartet: ${JSON.stringify(info)}`;
      }

      await oeffnePanel(cdp);
      await schreibeE2EBuch(cdp);
      await oeffneBuch(cdp);
      const knopf = await cdp.evaluate<boolean>(`return !!document.querySelector(".epub-sb-action-cover");`);
      if (!knopf) {
        return `Anbieter ist da (LIG ${info.version}, apiVersion ${String(info.apiVersion)}), aber unser Titelbild-Knopf erscheint nicht`;
      }
      console.log(`    (LIG ${info.version}, apiVersion ${String(info.apiVersion)}, recheck ${info.hatRecheck ? "vorhanden" : "FEHLT"})`);
      return null;
    },
  },
  {
    id: "N2",
    was: "recheck() heilt den erst spaeter erreichbaren Server — und wir nutzen das",
    pruefe: async (cdp) => {
      // Genau der Grund, warum `ensureImageApiReady` existiert. Gegen den Stub ist er nicht
      // pruefbar: der meldet immer `ready`. Hergestellt wird der Fall mit einem Endpunkt,
      // auf dem nichts horcht — dann zurueck auf den Mock.
      const tot = `http://127.0.0.1:${MOCK_PORT + 7}`;
      const nachTot = await setzeLigModus(cdp, { engine: "server", endpoint: tot });
      if (nachTot.ready !== false || nachTot.reason !== "unreachable") {
        await setzeLigModus(cdp, { endpoint: ENDPOINT });
        return `Toter Endpunkt wird nicht als unreachable gemeldet: ${JSON.stringify(nachTot)}`;
      }

      // Endpunkt zurueckstellen OHNE Neuladen: genau die Lage, in der ein Server erst nach
      // Obsidian hochkam. `status()` darf sie per Vertrag nicht bemerken, `recheck()` muss.
      const vergleich = await cdp.evaluate<{ vorher: unknown; nachher: unknown }>(`
        const p = app.plugins.plugins[${JSON.stringify(LIG_ID)}];
        p.settings.endpoint = ${JSON.stringify(ENDPOINT)};
        await p.saveData(p.settings);
        const vorher = p.api.status();
        const nachher = await p.api.recheck();
        return { vorher, nachher };
      `);
      const vorher = vergleich.vorher as { ready: boolean; reason: string | null };
      const nachher = vergleich.nachher as { ready: boolean; reason: string | null };
      if (nachher.ready !== true) {
        return `recheck() heilte den Zustand nicht: ${JSON.stringify(nachher)}`;
      }
      if (vorher.ready === true) {
        return "status() meldete den neuen Endpunkt schon vor recheck() — dann ist es nicht netzfrei, und unsere Sonderbehandlung steht auf einer falschen Annahme";
      }

      // Zweite Haelfte, und erst sie macht den Punkt zu einem NAHT-Punkt: dass WIR die
      // Zusage nutzen. `ensureImageApiReady` ruft `recheck()` genau bei `unreachable` —
      // ohne diesen Zweig meldete der Klick jetzt „Server nicht erreichbar", obwohl der
      // Server laeuft. Hergestellt wird der veraltete Zustand noch einmal, weil das
      // `recheck()` eine Zeile weiter oben ihn bereits geheilt hat.
      const tot2 = await setzeLigModus(cdp, { engine: "server", endpoint: tot });
      if (tot2.reason !== "unreachable") return `Vorzustand liess sich nicht herstellen: ${JSON.stringify(tot2)}`;
      await cdp.evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(LIG_ID)}];
        p.settings.endpoint = ${JSON.stringify(ENDPOINT)};
        await p.saveData(p.settings);
        return p.api.status().reason;
      `);
      await oeffnePanel(cdp);
      await schreibeE2EBuch(cdp);
      await oeffneBuch(cdp);
      await klickeTitelbildKnopf(cdp);
      await cdp.evaluate(`await new Promise((r) => setTimeout(r, 1500)); return true;`);
      const dialogDa = await cdp.evaluate<boolean>(`return !!document.querySelector(".epub-cover-modal");`);
      const meldung = await cdp.evaluate<string>(`
        return Array.from(document.querySelectorAll(".notice")).map((e) => e.textContent).join(" | ");
      `);
      await schliesseUeberlagerungen(cdp);
      await setzeLigModus(cdp, { engine: "server", endpoint: ENDPOINT });
      if (!dialogDa) {
        return `Der Dialog blieb zu, obwohl der Server laeuft — der veraltete Zustand wurde nicht neu ermittelt. Meldung: ${JSON.stringify(meldung)}`;
      }
      return null;
    },
  },
  {
    id: "N3",
    was: "Voller Weg ueber die Oberflaeche: Bytes des Anbieters landen als Titelbild im Vault",
    pruefe: async (cdp) => {
      await setzeLigModus(cdp, { engine: "server", endpoint: ENDPOINT });
      await setzeSpy(cdp);
      await oeffnePanel(cdp);
      await schreibeE2EBuch(cdp);
      await inDenPapierkorb(cdp, [E2E_COVER]);
      await oeffneBuch(cdp);
      await klickeTitelbildKnopf(cdp);
      await requireUntil(cdp, `document.querySelector(".epub-cover-modal")`, "Titelbild-Dialog kam nicht");
      await tippePromptUndErzeuge(cdp);

      // Am DATEISYSTEM warten, nicht am DOM: der Dialog schliesst sich selbst, und ein
      // Punkt, der nur sein Verschwinden sieht, waere auch dann gruen, wenn nichts
      // geschrieben wurde. 90 s, weil hier ein echter Anbieter mit echtem HTTP rechnet.
      await requireUntil(
        cdp,
        `!!app.vault.getAbstractFileByPath(${JSON.stringify(E2E_COVER)})`,
        "Titelbild-Datei wurde nicht angelegt",
        90_000,
      );

      const spy = await leseSpy(cdp);
      const notiz = (await leseDatei(cdp, E2E_BOOK)) ?? "";
      const datei = await leseBinaerBase64(cdp, E2E_COVER);
      await schliesseUeberlagerungen(cdp);

      if (spy.calls.length !== 1) {
        return `Erwartet genau EIN generate() ueber die Grenze, gezaehlt: ${spy.calls.length}`;
      }
      const call = spy.calls[0]!;
      if (!call.ok || !call.base64) {
        return `Der Anbieter meldete einen Fehlschlag: ${JSON.stringify({ reason: call.reason, message: call.message })}`;
      }
      if (call.prompt !== E2E_PROMPT) {
        return `Der getippte Prompt kam nicht ueber die Grenze: ${JSON.stringify(call.prompt)}`;
      }
      if (datei !== call.base64) {
        return `Die Datei im Vault traegt nicht die Bytes des Anbieters (Anbieter ${call.base64.length} Base64-Zeichen, Datei ${datei?.length ?? 0})`;
      }
      if (!notiz.includes(`cover: "[[${E2E_COVER}]]"`)) {
        return `cover: zeigt nicht auf die erzeugte Datei. Frontmatter: ${JSON.stringify(notiz.split("---")[1] ?? "")}`;
      }
      if (!notiz.includes(E2E_PROMPT)) {
        return "Der eingegebene Prompt wurde nicht als cover_prompt: zurueckgeschrieben";
      }
      console.log(`    (Seed ${String(call.seed)}, ${call.width}x${call.height}, ${call.base64.length} Base64-Zeichen)`);
      return null;
    },
  },
  {
    id: "N4",
    was: "Der Fortschritts-Callback wird vom echten Anbieter ueber die Grenze gerufen",
    pruefe: async (cdp) => {
      // Was der Stub nicht belegen kann: DASS der echte Anbieter unseren Callback ruft.
      // Unser Dialog haengt daran — ohne ihn steht er stumm, waehrend gerechnet wird.
      const spy = await leseSpy(cdp);
      if (spy.calls.length === 0) return "Kein generate()-Lauf im Fenster — N4 setzt N3 voraus (nicht mit --only fahren)";
      if (!spy.calls[0]!.hatCallback) {
        return "Unser Aufruf gab gar keinen onProgress mit — dann ist der Dialog per Konstruktion stumm";
      }
      if (spy.progress.length === 0) {
        return "Der Anbieter rief den mitgegebenen onProgress kein einziges Mal (Server-Modus: /progress liefert beim Mock 404)";
      }
      const phasen = [...new Set(spy.progress.map((p) => p[1]))];
      console.log(`    (${spy.progress.length} Meldungen, Phasen: ${phasen.join(", ")})`);
      return null;
    },
  },
  {
    id: "N5",
    was: "Ein echter Backend-Fehlschlag kommt als WERT zurueck und steht im Dialog",
    pruefe: async (cdp) => {
      // Der Vertrag fuehrt erwartbare Zustaende als Werte statt als Ausnahmen. Ob das im
      // Ernstfall haelt, sieht nur ein echter Fehlschlag — der Stub liefert immer ok.
      await setzeLigModus(cdp, { engine: "server", endpoint: ENDPOINT });
      await setzeSpy(cdp);
      await oeffnePanel(cdp);
      await schreibeE2EBuch(cdp);
      await inDenPapierkorb(cdp, [E2E_COVER]);
      await oeffneBuch(cdp);
      await klickeTitelbildKnopf(cdp);
      await requireUntil(cdp, `document.querySelector(".epub-cover-modal")`, "Titelbild-Dialog kam nicht");

      await mockFehlermodus(true);
      try {
        await tippePromptUndErzeuge(cdp);
        await requireUntil(
          cdp,
          `!!document.querySelector(".epub-cover-modal .epub-cover-status.is-error")`,
          "Der Dialog zeigte keinen Fehlerzustand",
          90_000,
        );
      } finally {
        await mockFehlermodus(false);
      }

      const meldung = await cdp.evaluate<string>(`
        const el = document.querySelector(".epub-cover-modal .epub-cover-status-text");
        return el ? el.textContent : "";
      `);
      const knopfWiederDa = await cdp.evaluate<boolean>(`
        const b = Array.from(document.querySelectorAll(".epub-cover-modal button")).find((b) => b.classList.contains("mod-cta"));
        return !!b && !b.hasAttribute("disabled");
      `);
      const spy = await leseSpy(cdp);
      const dateiDa = await cdp.evaluate<boolean>(
        `return !!app.vault.getAbstractFileByPath(${JSON.stringify(E2E_COVER)});`,
      );
      const notiz = (await leseDatei(cdp, E2E_BOOK)) ?? "";
      await schliesseUeberlagerungen(cdp);

      const call = spy.calls[spy.calls.length - 1];
      if (!call || call.ok) return `Der Anbieter meldete keinen Fehlschlag: ${JSON.stringify(call ?? null)}`;
      if (call.reason !== "failed") {
        return `Erwartet reason "failed" (rohe Backend-Meldung), bekommen: ${JSON.stringify({ reason: call.reason, message: call.message })}`;
      }
      if (dateiDa) return "Trotz Fehlschlag wurde eine Titelbild-Datei angelegt";
      if (notiz.includes("cover:")) return "Trotz Fehlschlag zeigt cover: auf etwas";
      if (!meldung) return "Der Dialog zeigt keinen Fehlertext";
      if (!knopfWiederDa) return "Nach dem Fehlschlag bleibt der Erzeugen-Knopf gesperrt — der Nutzer kann nicht erneut versuchen";
      console.log(`    (Dialogtext: ${JSON.stringify(meldung)}, Backend-Meldung: ${JSON.stringify(call.message)})`);
      return null;
    },
  },
  {
    id: "N6",
    was: "Im builtin-Modus meldet der echte Anbieter GENAU eine Groesse (512x512)",
    pruefe: async (cdp) => {
      // Unsere Groessen-Auswahl entfaellt bei genau einer erlaubten Groesse — ein Dropdown
      // mit einem Eintrag waere eine Attrappe. Diese Verzweigung ist unit-getestet, aber die
      // ANNAHME dahinter ist eine Zusage des Nachbarn, und die pruefte bisher niemand: der
      // Stub meldet `sizes: null` (Server-Modus), also lief nur der andere Zweig.
      const status = await setzeLigModus(cdp, { engine: "builtin", builtinModel: "sd-turbo" });
      const caps = (status.capabilities ?? {}) as {
        sizes: { width: number; height: number }[] | null;
        fixedSize: { width: number; height: number } | null;
      };
      if (!Array.isArray(caps.sizes) || caps.sizes.length !== 1) {
        return `capabilities.sizes ist nicht genau ein Eintrag: ${JSON.stringify(caps.sizes)}`;
      }
      const s = caps.sizes[0]!;
      if (s.width !== 512 || s.height !== 512) {
        return `Erwartet 512x512, gemeldet: ${s.width}x${s.height}`;
      }
      console.log(`    (engine=${String(status.engine)}, sizes=[${s.width}x${s.height}], fixedSize=${JSON.stringify(caps.fixedSize)})`);
      return null;
    },
  },
  {
    id: "N7",
    was: "Eine einzige erlaubte Groesse ist eine Tatsache: der Dialog zeigt KEIN Dropdown",
    pruefe: async (cdp) => {
      // Die Verzweigung, die der Stub per Konstruktion nie erreicht: er meldet `sizes: null`
      // (Server-Modus), also lief bisher immer der Zweig MIT Auswahl. Im builtin-Modus mit
      // sd-turbo gibt es genau 512x512 — ein Dropdown mit einem Eintrag waere eine Attrappe.
      const status = await setzeLigModus(cdp, { engine: "builtin", builtinModel: "sd-turbo" });
      if (status.ready !== true) {
        await setzeLigModus(cdp, { engine: "server", endpoint: ENDPOINT });
        return `Der builtin-Modus ist hier nicht bereit (${String(status.reason)}) — dieser Punkt braucht die heruntergeladenen Assets im Profil`;
      }
      await oeffnePanel(cdp);
      await schreibeE2EBuch(cdp);
      await oeffneBuch(cdp);
      await klickeTitelbildKnopf(cdp);
      await requireUntil(cdp, `document.querySelector(".epub-cover-modal")`, "Titelbild-Dialog kam nicht");

      // Die Dialoge werden MITGEZAEHLT, nicht vorausgesetzt: stuende ein Rest eines
      // frueheren Punktes im DOM, summierte ein `querySelectorAll` ueber beide — und der
      // Punkt waere gruen oder rot aus einem Grund, der mit seinem Gegenstand nichts zu
      // tun hat. Aufgefallen an der Gegenprobe, die "2 Auswahlfelder" meldete, wo genau
      // eines entstehen kann.
      const dialog = await cdp.evaluate<{ dialoge: number; dropdowns: number; knopf: boolean; status: string }>(`
        const alle = document.querySelectorAll(".epub-cover-modal");
        const m = alle[alle.length - 1];
        return {
          dialoge: alle.length,
          dropdowns: m ? m.querySelectorAll("select").length : -1,
          knopf: !!m && !!Array.from(m.querySelectorAll("button")).find((b) => b.classList.contains("mod-cta")),
          status: (m && m.querySelector(".epub-cover-status-text") || {}).textContent || "",
        };
      `);
      if (dialog.dialoge !== 1) {
        await schliesseUeberlagerungen(cdp);
        await setzeLigModus(cdp, { engine: "server", endpoint: ENDPOINT });
        return `${dialog.dialoge} Titelbild-Dialoge stehen im DOM — dieser Punkt misst dann nicht, was er behauptet`;
      }
      // ABBRECHEN, nicht erzeugen: ein echter builtin-Lauf gehoert hinter --gpu, nicht in
      // jeden Durchgang.
      await schliesseUeberlagerungen(cdp);
      await setzeLigModus(cdp, { engine: "server", endpoint: ENDPOINT });

      if (dialog.dropdowns !== 0) {
        return `Der Dialog zeigt ${dialog.dropdowns} Auswahlfeld(er), obwohl der Anbieter nur eine Groesse erlaubt`;
      }
      if (!dialog.knopf) return "Der Erzeugen-Knopf fehlt im Dialog";
      console.log(`    (engine=builtin, Statuszeile: ${JSON.stringify(dialog.status)})`);
      return null;
    },
  },
  {
    id: "N8",
    was: "Nicht bereit: kein Dialog, eine Meldung, nichts geschrieben",
    pruefe: async (cdp) => {
      // Readiness wird VOR dem Dialog aufgeloest (main.ts): jemanden erst einen Prompt
      // tippen zu lassen und dann zu sagen, dass nichts rechnen kann, waere die
      // schlechteste Stelle dafuer. Gegen den Stub ist dieser Zweig unerreichbar — er
      // meldet immer `ready`. Hergestellt wird er ueber einen Server-Modus OHNE Endpunkt,
      // was der Anbieter als `not-configured` fuehrt.
      const status = await setzeLigModus(cdp, { engine: "server", endpoint: "" });
      if (status.ready !== false || status.reason !== "not-configured") {
        await setzeLigModus(cdp, { engine: "server", endpoint: ENDPOINT });
        return `Erwartet not-configured, gemeldet: ${JSON.stringify(status)}`;
      }
      await oeffnePanel(cdp);
      await schreibeE2EBuch(cdp);
      await inDenPapierkorb(cdp, [E2E_COVER]);
      await oeffneBuch(cdp);
      await klickeTitelbildKnopf(cdp);
      await cdp.evaluate(`await new Promise((r) => setTimeout(r, 1500)); return true;`);

      const dialogDa = await cdp.evaluate<boolean>(`return !!document.querySelector(".epub-cover-modal");`);
      const meldung = await cdp.evaluate<string>(`
        return Array.from(document.querySelectorAll(".notice")).map((e) => e.textContent).join(" | ");
      `);
      const dateiDa = await cdp.evaluate<boolean>(
        `return !!app.vault.getAbstractFileByPath(${JSON.stringify(E2E_COVER)});`,
      );
      await schliesseUeberlagerungen(cdp);
      await setzeLigModus(cdp, { engine: "server", endpoint: ENDPOINT });

      if (dialogDa) return `Der Dialog oeffnete, obwohl der Anbieter nicht bereit ist (reason ${String(status.reason)})`;
      if (dateiDa) return "Es wurde eine Titelbild-Datei angelegt, obwohl nichts rechnen konnte";
      if (!meldung) return `Kein Hinweis an den Nutzer — der Klick blieb wirkungslos und stumm (reason ${String(status.reason)})`;
      console.log(`    (reason=${String(status.reason)}, Meldung: ${JSON.stringify(meldung)})`);
      return null;
    },
  },
  {
    id: "G1",
    nurMitGpu: true,
    was: "Ohne jeden Ersatz: builtin-Engine rechnet auf der GPU, das Bild landet im Vault",
    pruefe: async (cdp) => {
      // Der Lauf, in dem NICHTS mehr ersetzt ist — kein Stub, kein Mock-Backend, echte
      // Diffusion auf dieser Maschine. Was er ueber N3 hinaus belegt: dass unser
      // `onProgress` auch die Phase `loading-model` sieht (die es im Server-Modus per
      // Konstruktion nicht gibt — dort meldet der Mock nur `generating`) und dass die
      // 512x512-Zusage im Ernstfall auch das ist, was gerechnet wird.
      //
      // Warum trotzdem hinter `--gpu`: nicht wegen der Dauer. Gemessen am 2026-09-02 mit
      // warmem Modell **6–7 s** (sd-turbo, 4 Steps) — kalt nicht gemessen. Der Grund ist
      // die Voraussetzung: der Punkt braucht die heruntergeladenen Modell-Assets, und die
      // liegen im Cache Storage des Obsidian-PROFILS, nicht im Vault — ein frischer
      // Rechner hat sie nicht, und `--setup` kann sie nicht herstellen.
      const status = await setzeLigModus(cdp, { engine: "builtin", builtinModel: "sd-turbo" });
      if (status.ready !== true) {
        await setzeLigModus(cdp, { engine: "server", endpoint: ENDPOINT });
        return `builtin ist nicht bereit: ${String(status.reason)}`;
      }
      await setzeSpy(cdp);
      await oeffnePanel(cdp);
      await schreibeE2EBuch(cdp);
      await inDenPapierkorb(cdp, [E2E_COVER]);
      await oeffneBuch(cdp);
      await klickeTitelbildKnopf(cdp);
      await requireUntil(cdp, `document.querySelector(".epub-cover-modal")`, "Titelbild-Dialog kam nicht");
      await tippePromptUndErzeuge(cdp);

      const start = Date.now();
      await requireUntil(
        cdp,
        `!!app.vault.getAbstractFileByPath(${JSON.stringify(E2E_COVER)})`,
        "Titelbild-Datei wurde nicht angelegt",
        900_000,
        2_000,
      );
      const dauer = Math.round((Date.now() - start) / 1000);

      const spy = await leseSpy(cdp);
      const datei = await leseBinaerBase64(cdp, E2E_COVER);
      const notiz = (await leseDatei(cdp, E2E_BOOK)) ?? "";
      await schliesseUeberlagerungen(cdp);
      await setzeLigModus(cdp, { engine: "server", endpoint: ENDPOINT });

      const call = spy.calls[spy.calls.length - 1];
      if (!call || !call.ok || !call.base64) {
        return `Der builtin-Lauf lieferte kein Bild: ${JSON.stringify(call ?? null)}`;
      }
      if (datei !== call.base64) {
        return `Die Datei traegt nicht die gerechneten Bytes (Anbieter ${call.base64.length}, Datei ${datei?.length ?? 0})`;
      }
      if (call.width !== 512 || call.height !== 512) {
        return `Angefragt wurden ${call.width}x${call.height}, obwohl der Anbieter nur 512x512 erlaubt`;
      }
      if (!notiz.includes(`cover: "[[${E2E_COVER}]]"`)) return "cover: zeigt nicht auf die erzeugte Datei";
      const phasen = [...new Set(spy.progress.map((p) => p[1]))];
      console.log(`    (${dauer}s, Seed ${String(call.seed)}, Phasen: ${phasen.join(", ") || "keine"})`);
      return null;
    },
  },
  {
    id: "N9",
    was: "Aufraeumen: der Spy ist zurueckgebaut, kein toter Wrapper bleibt stehen",
    pruefe: async (cdp) => {
      // Ein stehengebliebener Wrapper verfaelscht still jeden spaeteren Lauf im selben
      // Fenster — und weil der Konsument Fehler wegfaengt, saehe das wie ein Produktfehler
      // aus. Die Gegenprobe dazu ist, `npm run smoke:e2e` zweimal hintereinander zu fahren.
      const stand = await baueSpyZurueck(cdp);
      if (stand !== "clean") return `Aufraeumen unvollstaendig: ${stand}`;
      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// Ablaufsteuerung
// ---------------------------------------------------------------------------

function zeigeVertrag(): void {
  console.log(`Pruefpunkte — ${PRUEFPUNKTE.length} (docs/SMOKE.md § Ende-zu-Ende)\n`);
  for (const p of PRUEFPUNKTE) {
    console.log(`  ${p.id.padEnd(4)} ${p.was}${p.nurMitGpu ? "   [--gpu]" : ""}`);
  }
}

/**
 * Staging-Vault herstellen und BEIDE Plugins installieren.
 *
 * Der Nachbar wird aus seinem Repo deployt, nicht aus dem Store: geprueft werden soll die
 * Naht zum aktuellen Stand, nicht zu dem, der zufaellig installiert ist. Seine Einstellungen
 * setzt das Setup mit — ein Anbieter ohne Endpunkt meldet `not-configured`, und der Lauf
 * scheiterte an einer Konfiguration statt an der Sache.
 */
function setup(): void {
  // Der Build des NACHBARN gegen seinen Quellstand pruefen, nicht nur seine Existenz.
  // Ein veralteter Fremd-Build ist hier teurer als im eigenen Repo: er sieht aus wie ein
  // Vertragsbruch des Nachbarn, und gesucht wird dann in dessen Code statt an seiner
  // `main.js`. Der Hinweis kam aus der local-image-generator-Session (2026-09-02), die
  // denselben Guard fuer ihren eigenen Smoke gebaut hat — dieselbe Falle, andere Richtung.
  const neuesteQuelle = juengsteAenderung(join(LIG_REPO, "src"));
  const gebaut = statSync(join(LIG_REPO, "main.js")).mtimeMs;
  if (neuesteQuelle > gebaut) {
    console.error(
      `\nDer Build des Nachbarn ist AELTER als sein Quellstand ` +
        `(main.js ${new Date(gebaut).toLocaleTimeString()}, src/ ${new Date(neuesteQuelle).toLocaleTimeString()}).\n` +
        `Im Nachbar-Repo \`npm run build\` fahren, sonst misst der Naht-Lauf einen Stand, den niemand kennt.`,
    );
    exit(1);
  }

  const vaultDir = stagingVaultDir(REPO_NAME);
  const log = buildVault({ repoRoot: REPO_ROOT, vaultDir, fixtureDir: FIXTURE_DIR, pluginId: PLUGIN_ID });
  console.log(`Staging-Vault: ${vaultDir}`);
  for (const zeile of log) console.log(`  ${zeile}`);

  const ligDir = join(vaultDir, ".obsidian", "plugins", LIG_ID);
  mkdirSync(ligDir, { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css"]) {
    const quelle = join(LIG_REPO, f);
    if (!existsSync(quelle)) {
      console.error(`\nFEHLT: ${quelle}\nErst im Nachbar-Repo \`npm run build\` fahren.`);
      exit(1);
    }
    cpSync(quelle, join(ligDir, f));
  }
  // Server-Modus auf den Mock. `createMode: "image"` haelt seinen Ergebnis-Notizen-Pfad aus
  // unserem Vault heraus — wir rufen `save()` ohnehin nicht, aber ein Fehlgriff soll nicht
  // stillschweigend Notizen anlegen.
  writeFileSync(
    join(ligDir, "data.json"),
    JSON.stringify(
      { engine: "server", endpoint: ENDPOINT, defaultSteps: 4, createMode: "image", outputFolder: "_lig", noteFolder: "_lig" },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(vaultDir, ".obsidian", "community-plugins.json"),
    JSON.stringify([PLUGIN_ID, LIG_ID], null, 2) + "\n",
  );
  console.log(`  Nachbarplugin nach .obsidian/plugins/${LIG_ID}/ deployt (Server-Modus auf ${ENDPOINT})`);
  console.log(
    "\nJetzt den Vault oeffnen — NICHT Obsidian beenden, falls es laeuft (Single-Instance).\n" +
      "Zweites Fenster per IPC:\n" +
      `  ipcRenderer.send("vault-open", ${JSON.stringify(vaultDir)})\n` +
      "Danach: npm run smoke:e2e",
  );
}

async function lauf(nur?: string, mitGpu = false): Promise<number> {
  const cdp = await attachTo("workspace", PORT, VAULT_NAME);
  if (!cdp) {
    console.error(
      `Kein Obsidian-Fenster fuer Vault "${VAULT_NAME}" auf Port ${PORT}.\n` +
        "Laeuft Obsidian mit offenem Debug-Port, und ist der Staging-Vault als Fenster offen?",
    );
    return 1;
  }

  console.log("\nEnde-zu-Ende: epub-exporter → Plugin-Grenze → local-image-generator\n");
  const konsole: string[] = [];
  let gruen = 0;
  const rot: string[] = [];

  try {
    await starteMockFallsNoetig();
    await cdp.mitschnitt((zeile) => konsole.push(zeile));
    await requireVisible(cdp);
    await closeExtraLeaves(cdp);
    await ladeBeideNeu(cdp);

    for (const punkt of PRUEFPUNKTE) {
      if (nur && punkt.id !== nur) continue;
      if (punkt.nurMitGpu && !mitGpu && !nur) {
        console.log(`${punkt.id.padEnd(4)} ${punkt.was} … uebersprungen (--gpu)`);
        continue;
      }
      process.stdout.write(`${punkt.id.padEnd(4)} ${punkt.was} … `);
      try {
        const grund = await punkt.pruefe(cdp);
        if (grund === null) {
          console.log("✓");
          gruen++;
        } else {
          console.log("✗");
          rot.push(`${punkt.id}: ${grund}`);
        }
      } catch (e) {
        console.log("✗");
        rot.push(`${punkt.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    // Aufraeumen auch nach einem Abbruch: der Spy haengt am Plugin-Objekt und ueberlebt
    // jeden Treiberfehler, der Mock ist ein Prozess.
    await baueSpyZurueck(cdp).catch(() => "");
    await setzeLigModus(cdp, { engine: "server", endpoint: ENDPOINT }).catch(() => ({}));
    await inDenPapierkorb(cdp, [E2E_COVER, E2E_BOOK, E2E_CHAPTER]).catch(() => undefined);
    if (mockProzess) {
      mockProzess.kill();
      mockProzess = null;
    }
  }

  console.log(`\n${gruen}/${gruen + rot.length} Pruefpunkte gruen`);
  if (rot.length) {
    console.log("\nOffen:");
    for (const r of rot) console.log(`  ✗ ${r}`);
    const fehler = konsole.filter((z) => /error|uncaught/i.test(z)).slice(0, 5);
    if (fehler.length) {
      console.log("\nKonsole (gefiltert):");
      for (const z of fehler) console.log(`  ${z}`);
    }
    console.log(
      "\nJeden roten Punkt EINZELN auseinandernehmen. Beim ersten Lauf sind die meisten\n" +
        "roten Punkte Treiberfehler, keine Produktfehler — das ist die Leistung des ersten Laufs.",
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
  exit(await lauf(nur, args.includes("--gpu")));
}

void main();
