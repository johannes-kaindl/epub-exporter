// vendored from obsidian-kit@0.89.0, src/pure/frontmatter-patch.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// frontmatter-patch.ts — eigene Frontmatter-Felder setzen, fremde Zeilen byte-gleich lassen. Kein obsidian-Import.
//
// Zusammengeführt aus zwei unabhängigen Fassungen desselben Vorgangs (Diachronic wäre die dritte):
//   · finance-ledger `src/core/notes/frontmatter.ts:56` `patchFrontmatter` — zeilenweise, `set`/`ensure`, `created` geschützt,
//     eine Notiz ohne Block bleibt unverändert, Listen abgelehnt, Fehler werfen.
//   · mailstone `src/core/merge/merge.ts:209` `setFrontmatterField` — ersetzt einen Schlüssel samt Fortsetzungszeilen (Listen),
//     serialisiert über `serializeFrontmatter` (Quoting), legt einen fehlenden Block an, meldet Block-Skalare als Wert.
// Der Ablauf ist mailstones (Einträge mit Fortsetzungszeilen, ein Schlüssel über das Kit serialisiert, Zeilenende aus dem Block);
// dazu kommen `ensure`, `protect`, `create` und `onlyExisting`. Unterschiede zu den Vorgängern und ihr Grund:
//   · Fehler sind Werte (`ok: false`), nie ein Wurf — Kit-Konvention (`marker-zone`, `tool-provider`).
//   · Eine Notiz OHNE Block bleibt unverändert, solange `create` nicht gesetzt ist: eine fremde Notiz bekommt keinen Block,
//     eine eigene Notiz (mailstone) schon — beide Fälle sind begründet, der sichere ist der Default.
//   · Listen gehen als Flow-Liste (`[a, b]`) und ersetzen eine bestehende Blockliste samt ihren Zeilen. Obsidians
//     Eigenschaften-Editor schreibt sie beim nächsten Bearbeiten als Blockliste um, Bases liest beide gleich.
//   · Werte sind typisiert (`string | number | string[]`) und laufen durch `serializeFrontmatter` (quotet `"1"`, `true`, `a, b`);
//     finance-ledger übergab fertiges YAML und verlagerte das Quoting auf jeden Aufrufer.
//   · `protect` (Default `["created"]`) verweigert ein `set` — finance-ledgers Grund (ein Lauf setzte `created` jedes Mal neu) gilt allgemein.
//   · Beim Anhängen an einen CRLF-Block bleibt das Zeilenende CRLF; finance-ledger schrieb dort `\n` vor die angehängte Zeile und
//     ein doppeltes `\r` dahinter (`neu: x\r\r\n---`, gemessen 2026-10-21 an der Referenzkopie).
//   · Ein leerer Block (`---` / `---`) ist ein Block; mailstone meldete ihn als nicht lesbar.
//   · Zusätzlich verweigert: ein Wert mit Zeilenumbruch (er bräche den Block, `serializeFrontmatter` quotet ihn nicht) und
//     ein Schlüssel, den der Block-Leser nicht als Schlüssel erkennt (`invalid-key`).
//   · Ein Literal (`{ literal: "53240.00" }`) wird unverändert geschrieben, nie gequotet — für Aufrufer, die fertige Skalare haben
//     (finance-ledger: `saldo_eur` aus `Money.toFixed(2)`, `anfangssaldo_eur: null`). `FmValue` kann das nicht: ein `number` verliert
//     die endende Null (`12.50` → `12.5`), ein `string` bekommt Anführungszeichen (`"null"`, `"53240.00"`). Zugelassen sind genau diese
//     Formen (`null`, `true`, `false`, Dezimalzahl, einzeiliger doppelt gequoteter Text); alles andere ist `invalid-value`, damit kein Umbruch, Kommentar oder Fremd-YAML
//     durch die Hintertür kommt. Der gequotete Text ist für Aufrufer, deren Wert im Bestand schon so steht (finance-ledger `glaeubiger_id`:
//     `"DE98ZZZ00000000001"`); `isFmLiteralText` gibt die Prüfung heraus, damit kein Konsument die Regex kopiert. Die Regex ist enger als die in `needsQuoting` (`-.5` und `+.5` liest js-yaml als Text, Obsidian als Zahl: die Menge
//     hier ist die gemeinsame). Gemessen 2026-10-25 in Obsidian 1.14.5 (`pilot/literal-formen.ts`): `parseYaml`, `metadataCache` und der gerenderte
//     Eigenschaften-Editor (Zahlenfeld) lesen `5.`, `+5`, `-0` und `007` als Zahl mit demselben Wert wie js-yaml 4.2.0 (5, 5, 7); nur `-0` bleibt bei Obsidian
//     ein `-0` (js-yaml: `0`), das Feld zeigt `0`, aus dem Cache einer unveränderten Notiz liest man `0`.
//     Bases gemessen (Obsidian 1.14.5, `pilot/bases-literale.ts`, Tabellenansicht mit der Formel `x + 1` und einer Sortierung nach `x`): `5.`, `+5`, `-0` und `007` sind Zahlen (Zelle `5`, `5`, `0`, `7`;
//     `x + 1` ergibt `6`, `6`, `1`, `8`, nie eine Verkettung wie `5.1`; `12.50` zeigt `12.5`), die Sortierung ist numerisch (`0`, `5`, `5`, `7`, `12.5`), `"DE98"` bleibt Text. Dieselbe Lesart wie js-yaml und Obsidian: die Regex bleibt.
// Grenzen, bewusst wie im Kit-Parser: ein Schlüssel muss `[A-Za-z0-9_][\w .-]*` sein (ein Schlüssel mit Umlaut wird nicht gefunden,
// also angehängt, nicht ersetzt — `invalid-key` fängt ihn deshalb schon beim Setzen ab); Kommentare auf der Zeile eines gesetzten
// Schlüssels gehen mit der Zeile verloren; ein Block-Skalar (`|`, `>`, auch hinter Tag oder Anker: `!!str |`, `&z >`) wird gemeldet, nicht ersetzt.
//
// Das Ende eines Werts bestimmt der Leser selbst (Welle 34, Paket 12; vorher beendete die erste nicht eingerückte Zeile den Wert und `set`/`remove` schnitten Listen mit Leerzeile oder Kommentar an, gemessen: 16 von 22 Formen
// gegen js-yaml falsch): ein einfacher oder leerer Wert reicht über alle eingerückten Zeilen; Leerzeilen und Kommentare auf Spalte 0 gehören dazu, wenn danach eine Fortsetzung folgt (sonst stehen sie vor dem nächsten Schlüssel);
// bei leerem Wert zählen auch Listenpunkte auf Spalte 0. Ein gequoteter Wert reicht bis zur schließenden Quote, ein Flow-Wert (`[`, `{`) bis zur schließenden Klammer, beides über Zeilen hinweg (Quotes und Kommentare in der Klammer
// werden übersprungen, ein `'` öffnet nur am Tokenanfang). Schließt eine Quote oder Klammer bis zum Blockende nicht, ist das Ende nicht bestimmbar: der Schlüssel wird verweigert (`unparseable` mit `key`), die übrigen Schlüssel
// bleiben bearbeitbar. Gequotete Schlüssel (`"t":`, `'t':`) sind der Schlüssel `t`. Maßstab ist js-yaml als Orakel im Test (`tests/frontmatter-patch-yaml.test.ts`), die Wahrheit ist Obsidian (Pilot `frontmatter-leser`).
//
// `remove` (Welle 34, Paket 5; Wunsch finance-ledger, `scripts/migrate-note-schema.ts`): entfernt je Schlüssel ALLE seine Vorkommen samt Fortsetzungszeilen (Blockliste, eingerückte Folgezeilen) — dieselbe Zeilengruppe, die `set` ersetzt,
// nur ohne Ersatz. Ein fehlender Schlüssel ist kein Fehler; `protect` gilt auch hier; derselbe Schlüssel in `remove` und in `set`/`ensure` ist `conflict` (nie raten, welcher gewinnt). Fällt der letzte Schlüssel, bleibt der leere Block
// (`---` und `---`) stehen. Ein Schlüssel mit Leerzeichen am Ende ist auch beim Entfernen `invalid-key` (gemessen 2026-11-14: der Leser trimmt den Schlüssel, `a : x` steht als `a` im Block, also entfernt `remove: ["a"]` diese Zeile; eine Ausnahme ist nicht nötig).
//
// Diese Datei muss unter `noUncheckedIndexedAccess` fehlerfrei sein — siehe npm-Skript `check:index-strict`.

import { quoteScalar, serializeFrontmatter, type FmValue } from "./frontmatter";

/**
 * Ein fertig geschriebener YAML-Skalar, der unverändert in die Zeile geht (`key: <literal>`). Nur `null`, `true`, `false` (klein
 * geschrieben), Dezimalzahlen wie `12.50`, `-0`, `.5`, `5.` und ein einzeiliger doppelt gequoteter Text ohne `"` und `\` darin
 * (`"DE98ZZZ00000000001"`); alles andere meldet `patchFrontmatter` als `invalid-value`. Vorab prüfen: `isFmLiteralText`.
 */
export interface FmLiteral { literal: string }

export interface FrontmatterPatchSpec {
  /** Setzen oder anhängen. */
  set?: Record<string, FmValue | FmLiteral>;
  /** Nur anhängen, wenn der Schlüssel fehlt (auch nach `set`). */
  ensure?: Record<string, FmValue | FmLiteral>;
  /** Schlüssel, die ein `set` verweigert. Default `["created"]`. */
  protect?: readonly string[];
  /** Eine Notiz ohne Block bekommt einen. Default `false`: sie bleibt unverändert. */
  create?: boolean;
  /** Nur Schlüssel in `set` schreiben, die schon da sind. Default `false`. Betrifft `ensure` nicht. */
  onlyExisting?: boolean;
  /** Schlüssel entfernen (seit Welle 34): alle Vorkommen samt Fortsetzungszeilen. Fehlt ein Schlüssel, geschieht für ihn nichts. `protect` gilt auch hier; derselbe Schlüssel in `set` oder `ensure` ist `conflict`. */
  remove?: readonly string[];
  /** Wie eine `string[]` geschrieben wird (seit 0.71.0): `"flow"` (Default) als `key: [a, b]`, `"block"` als Blockliste (`key:` und je Eintrag `  - a`, zwei Leerzeichen eingerückt). Gilt für `set`, `ensure`
   *  und `create`; die Einträge laufen durch dieselbe Quotierung wie in der Flow-Liste, ein leerer Eintrag steht als `""`. Eine **leere** Liste bleibt `key: []` (es gibt keine leere Blockliste; wer `key: null`
   *  will, übergibt `{ literal: "null" }`). Skalare und Zahlen betrifft die Option nicht. Für Notizen, deren Bestand Blocklisten trägt (finance-ledger: Parität mit dem Python-Importer); Obsidian liest
   *  beide Formen gleich (Cache, Eigenschaften-Editor und Bases, gemessen 2026-10-25, `pilot/bases-listen.ts`). */
  listStyle?: "flow" | "block";
}

export type FrontmatterPatchResult =
  | { ok: true; content: string; changed: boolean }
  | { ok: false; reason: "unparseable" | "block-scalar" | "protected" | "invalid-value" | "invalid-key" | "conflict"; key?: string };

// Gruppen: öffnender Zaun / Rohtext / schließender Zaun samt Zeilenende, damit beide Zäune unverändert zurückgehen.
const FM_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---[ \t]*\r?\n?)/;
// Ein Block ohne eine Zeile dazwischen: `---` direkt auf `---`.
const EMPTY_RE = /^(---\r?\n)(---[ \t]*(?:\r?\n|$))/;
// Schlüsselzeile: Schlüssel am Zeilenanfang (nie eingerückt) — dieselbe Form wie im Kit-Parser.
const KEY_RE = /^([A-Za-z0-9_][\w .-]*?):[ \t]*(.*)$/;
// Kein Leerzeichen am Ende: `patchFrontmatter` schrieb `a : x`, der Leser (`scanEntries`) trimmt den Schlüssel auf `a`, findet `a ` nie wieder, und das zweite `set` hängte eine
// Dublette an (Befund kitok4-w28, 2026-10-27). Ein Leerzeichen in der Mitte bleibt erlaubt, am Ende stehen Wortzeichen, Punkt oder Bindestrich.
const KEY_NAME_RE = /^[A-Za-z0-9_](?:[\w .-]*[\w.-])?$/;
// Gequotete Schlüssel (`"t": 5`, `'t': 5`) und jede andere Zeile auf Spalte 0, die wie `name:` aussieht (Umlaut, Sonderzeichen): sie sind Schlüssel des Blocks und begrenzen den Wert davor, auch wenn `patchFrontmatter`
// sie nie setzt (`invalid-key`). Ohne sie wäre die Folgezeile eines mehrzeiligen Werts eines solchen Schlüssels ein „Schlüssel“.
const DQ_KEY_RE = /^"((?:[^"\\]|\\.)*)"[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/;
const SQ_KEY_RE = /^'((?:[^']|'')*)'[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/;
const ANY_KEY_RE = /^([^\s#\-[\]{}&*!|>'"%@`][^:]*?):(?:[ \t]+(.*)|[ \t]*)$/;

/** `ok`: Ende des Werts bestimmt; `block-scalar`: Wert ist ein Blockskalar (`|`, `>`, auch hinter Tag oder Anker), wird nie angefasst; `unclear`: das Ende des Werts ist nicht bestimmbar (offene Quote, offene Flow-Klammer), wird nie angefasst. */
type EntryKind = "ok" | "block-scalar" | "unclear";
interface Entry { start: number; end: number; rest: string; kind: EntryKind }
interface Doc { open: string; close: string; lines: string[]; entries: Map<string, Entry>; eol: "\n" | "\r\n"; empty: boolean }

/** Der Schlüssel einer Zeile auf Spalte 0 und der Rest dahinter, sonst `null`. Gequotete Schlüssel liefern den Namen ohne Quotes (`"t": 5` ist der Schlüssel `t`). */
function keyOf(line: string): { key: string; rest: string } | null {
  const plain = KEY_RE.exec(line);
  if (plain) return { key: (plain[1] ?? "").trim(), rest: plain[2] ?? "" };
  const dq = DQ_KEY_RE.exec(line);
  if (dq) {
    let name = dq[1] ?? "";
    try { name = JSON.parse(`"${name}"`) as string; } catch { /* der Rohname genügt: ein solcher Schlüssel wird nie gesetzt */ }
    return { key: name.trim(), rest: dq[2] ?? "" };
  }
  const sq = SQ_KEY_RE.exec(line);
  if (sq) return { key: (sq[1] ?? "").replace(/''/g, "'").trim(), rest: sq[2] ?? "" };
  const any = ANY_KEY_RE.exec(line);
  if (any) return { key: (any[1] ?? "").trim(), rest: any[2] ?? "" };
  return null;
}

/** Der Wert hinter Tags und Ankern (`!!str |` → `|`, `&z [a` → `[a`). */
function valueText(rest: string): string {
  let v = rest.trimStart();
  for (let m = /^[!&]\S*[ \t]+/.exec(v); m; m = /^[!&]\S*[ \t]+/.exec(v)) v = v.slice(m[0].length).trimStart();
  return v;
}

interface Cursor { ln: number; s: string; p: number }

/** Hinter die schließende Quote `q` (Position `p` liegt hinter der öffnenden), auch über Zeilen hinweg; `null`, wenn der Block vorher endet. `\` maskiert in `"`, `''` in `'`. */
function skipQuoted(lines: string[], c: Cursor, q: '"' | "'"): Cursor | null {
  let { ln, s, p } = c;
  for (;;) {
    while (p < s.length) {
      const ch = s[p];
      if (q === '"' && ch === "\\") { p += 2; continue; }
      if (ch === q) {
        if (q === "'" && s[p + 1] === "'") { p += 2; continue; }
        return { ln, s, p: p + 1 };
      }
      p++;
    }
    ln++;
    if (ln >= lines.length) return null;
    s = lines[ln] ?? "";
    p = 0;
  }
}

/** Beginnt an Position `p` ein Token (davor nur Leerraum oder `[ { , :`)? Nur dort öffnet ein `'` oder `"` eine Quote; `don't` im Flow-Text tut es nicht. */
function tokenStart(s: string, p: number): boolean {
  let i = p - 1;
  while (i >= 0 && (s[i] === " " || s[i] === "\t")) i--;
  return i < 0 || "[{,:".includes(s[i] ?? "");
}

/** Letzte Zeile eines Werts, der mit `[` oder `{` beginnt (Klammern gezählt, Quotes und Kommentare übersprungen); `null`, wenn der Block vorher endet. */
function flowEnd(lines: string[], i: number, v: string): number | null {
  let c: Cursor = { ln: i, s: v, p: 0 };
  let depth = 0;
  for (;;) {
    while (c.p < c.s.length) {
      const ch = c.s[c.p];
      if (ch === "#" && (c.p === 0 || c.s[c.p - 1] === " " || c.s[c.p - 1] === "\t")) break;
      if ((ch === '"' || ch === "'") && tokenStart(c.s, c.p)) {
        const n = skipQuoted(lines, { ln: c.ln, s: c.s, p: c.p + 1 }, ch);
        if (!n) return null;
        c = n;
        continue;
      }
      if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") { depth--; if (depth === 0) return c.ln; }
      c.p++;
    }
    const next = c.ln + 1;
    if (next >= lines.length) return null;
    c = { ln: next, s: lines[next] ?? "", p: 0 };
  }
}

/** Ende (exklusiv) eines einfachen oder leeren Werts: eingerückte Zeilen gehören dazu, Leerzeilen und Kommentare auf Spalte 0 nur, wenn danach eine Fortsetzung folgt (sonst stehen sie vor dem nächsten Schlüssel);
 *  bei leerem Wert (`key:` oder nur Kommentar) auch Listenpunkte auf Spalte 0. */
function plainEnd(lines: string[], i: number, emptyValue: boolean): number {
  let last = i;
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j] ?? "";
    if (l.trim() === "") continue;
    if (l.startsWith(" ") || l.startsWith("\t")) { last = j; continue; }
    if (l.startsWith("#")) continue;
    if (emptyValue && /^-(?:[ \t]|$)/.test(l)) { last = j; continue; }
    break;
  }
  return last + 1;
}

/** Alle Zeilenbereiche in Reihenfolge, mit dem Schlüssel wie ihn der Leser kennt (getrimmt, gequotete ohne Quotes). Das Ende eines Werts bestimmt der Leser selbst: einfach oder leer (`plainEnd`), gequotet über Zeilen
 *  hinweg, Flow-Klammer gezählt; ein Blockskalar ist `block-scalar`, ein Wert, dessen Ende nicht bestimmbar ist (Quote oder Klammer nie geschlossen), `unclear` — beide fasst `patchFrontmatter` nicht an. */
function scanAll(lines: string[]): Array<Entry & { key: string }> {
  const out: Array<Entry & { key: string }> = [];
  let i = 0;
  while (i < lines.length) {
    const kv = keyOf(lines[i] ?? "");
    if (!kv) { i++; continue; }
    const v = valueText(kv.rest);
    let kind: EntryKind = "ok";
    let end: number;
    if (/^[|>]/.test(v)) { kind = "block-scalar"; end = plainEnd(lines, i, false); }
    else if (v.startsWith('"') || v.startsWith("'")) {
      const e = skipQuoted(lines, { ln: i, s: v, p: 1 }, v.startsWith('"') ? '"' : "'");
      if (e) end = e.ln + 1; else { kind = "unclear"; end = i + 1; }
    } else if (v.startsWith("[") || v.startsWith("{")) {
      const e = flowEnd(lines, i, v);
      if (e !== null) end = e + 1; else { kind = "unclear"; end = i + 1; }
    } else end = plainEnd(lines, i, v === "" || v.startsWith("#"));
    out.push({ key: kv.key, start: i, end, rest: kv.rest.trim(), kind });
    i = end;
  }
  return out;
}

/** Zeilenbereiche je Schlüssel. Der erste Treffer gewinnt, spätere Dubletten bleiben unberührt (`set`); `remove` nimmt alle (`scanAll`). */
function scanEntries(lines: string[]): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const { key, ...e } of scanAll(lines)) if (!out.has(key)) out.set(key, e);
  return out;
}

function readDoc(text: string): { doc: Doc; bodyFrom: number } | null {
  const m = FM_RE.exec(text);
  if (m) {
    const open = m[1] ?? "", raw = m[2] ?? "", close = m[3] ?? "";
    const lines = raw.split(/\r?\n/);
    return {
      doc: { open, close, lines, entries: scanEntries(lines), eol: raw.includes("\r\n") || open.includes("\r\n") ? "\r\n" : "\n", empty: false },
      bodyFrom: m[0].length,
    };
  }
  const e = EMPTY_RE.exec(text);
  if (!e) return null;
  const open = e[1] ?? "";
  return {
    doc: { open, close: e[2] ?? "", lines: [], entries: new Map(), eol: open.includes("\r\n") ? "\r\n" : "\n", empty: true },
    bodyFrom: e[0].length,
  };
}

// Genau die Formen, die ein Literal haben darf — die EINZIGE Quelle (`badValue` und `isFmLiteralText`). Nicht die Regex aus `needsQuoting`
// (sie lässt `-.5` und `+.5` durch, die js-yaml als Text liest). Die gequotete Form hält Anführungszeichen und Rückstrich draußen; Zeilenumbruch
// und Steuerzeichen (ein NUL lehnt js-yaml ab) fängt `hasControl` ab, weil eine Zeichenklasse mit Steuerzeichen die Kernregel
// `no-control-regex` auslöst (Konsumenten-Lint, 0.69.0).
const LITERAL_RE = /^(?:null|true|false)$|^[+-]?\d+(\.\d*)?$|^\.\d+$|^"[^"\\]*"$/;

/** Enthält `text` ein Zeichen unter 0x20 außer dem Tabulator? (Zeilenumbruch, NUL und die übrigen Steuerzeichen; DEL und Nicht-ASCII bleiben erlaubt.) */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 && c !== 0x09) return true;
  }
  return false;
}

/** Ist `text` ein gültiges Literal für `{ literal }`? Dieselbe Prüfung wie in `patchFrontmatter` (`invalid-value`); wirft nie, Nicht-Text ist `false`.
 *  @example
 *  isFmLiteralText("53240.00") // → true
 *  isFmLiteralText('"DE98"')   // → true
 *  isFmLiteralText("DE98")     // → false */
export function isFmLiteralText(text: string): boolean {
  return typeof text === "string" && LITERAL_RE.test(text) && !hasControl(text);
}

/** Ist `name` ein Schlüsselname, den der Block-Leser des Kits als Schlüssel erkennt? Dieselbe Prüfung wie in `patchFrontmatter` (`invalid-key`); wirft nie, Nicht-Text ist `false`.
 *  Ungemessen: `yes`, `no`, `on`, `off` und `null` bestehen sie, sind aber in YAML 1.1 keine sicheren Schlüssel (kein Sonderfall gebaut).
 *  @example
 *  isFrontmatterKeyName("diachronic-round") // → true
 *  isFrontmatterKeyName("Größe")            // → false (Umlaut: der Leser findet die Zeile nicht)
 *  isFrontmatterKeyName("a: b")             // → false
 *  isFrontmatterKeyName("a ")               // → false (Leerzeichen am Ende: der Leser trimmt, das zweite set legte eine Dublette an) */
export function isFrontmatterKeyName(name: string): boolean {
  return typeof name === "string" && KEY_NAME_RE.test(name);
}

function isLiteral(v: FmValue | FmLiteral): v is FmLiteral {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Die Zeilen EINES Schlüssels: ein Literal unverändert, alles andere über das Kit serialisiert (ohne die beiden Zäune); eine nicht leere Liste mit `listStyle: "block"` als Blockliste. */
function keyLines(key: string, value: FmValue | FmLiteral, listStyle: "flow" | "block" = "flow"): string[] {
  if (isLiteral(value)) return [`${key}: ${value.literal}`];
  if (listStyle === "block" && Array.isArray(value) && value.length > 0) return [`${key}:`, ...value.map((item) => `  - ${item === "" ? '""' : quoteScalar(item)}`)];
  const lines = serializeFrontmatter({ [key]: value }, [key]).split("\n");
  return lines.slice(1, lines.length - 2);
}

function badValue(v: FmValue | FmLiteral): boolean {
  if (isLiteral(v)) return !isFmLiteralText(v.literal);
  if (typeof v === "number") return !Number.isFinite(v);
  const parts = Array.isArray(v) ? v : [v];
  return parts.some((s) => /[\r\n]/.test(s));
}

/**
 * Setzt Felder im Frontmatter einer Notiz, ohne den Rest anzufassen. Wirft nie.
 *
 * `set` ersetzt den Schlüssel (samt Fortsetzungszeilen) oder hängt ihn an, `ensure` hängt nur an, wenn er fehlt. Jede nicht
 * betroffene Zeile, der Body und das Zeilenende bleiben byte-gleich; `changed` ist `false`, wenn der Text danach derselbe ist.
 * Verweigert wird mit einem Grund statt zu raten: Schlüssel in `protect` (`protected`), ein Block-Skalar am Zielschlüssel
 * (`block-scalar`), ein Block, der nicht schließt (`unparseable`), ein Wert mit Zeilenumbruch (`invalid-value`) und ein Schlüssel,
 * den der Block-Leser nicht erkennt (`invalid-key`).
 *
 * Ein fertiger Skalar geht als `{ literal }` unquotet in die Zeile (`null`, `true`, `false`, Dezimalzahl); ein anderer Wert ist `invalid-value`.
 *
 * @example
 * patchFrontmatter("---\ntitle: A\n---\nText\n", { set: { "diachronic-round": 2 } })
 * // → { ok: true, changed: true, content: "---\ntitle: A\ndiachronic-round: 2\n---\nText\n" }
 * @example
 * patchFrontmatter("---\ntitle: A\n---\n", { set: { saldo_eur: { literal: "53240.00" } }, ensure: { stand: { literal: "null" } } })
 * // → { ok: true, changed: true, content: "---\ntitle: A\nsaldo_eur: 53240.00\nstand: null\n---\n" }
 */
export function patchFrontmatter(text: string, spec: FrontmatterPatchSpec): FrontmatterPatchResult {
  const protect = new Set(spec.protect ?? ["created"]);
  const setEntries = Object.entries(spec.set ?? {});
  const ensureEntries = Object.entries(spec.ensure ?? {});
  const removeKeys = [...new Set(spec.remove ?? [])];

  for (const [key, value] of [...setEntries, ...ensureEntries]) {
    if (!isFrontmatterKeyName(key)) return { ok: false, reason: "invalid-key", key };
    if (badValue(value)) return { ok: false, reason: "invalid-value", key };
  }
  for (const key of removeKeys) {
    if (!isFrontmatterKeyName(key)) return { ok: false, reason: "invalid-key", key };
  }
  for (const [key] of setEntries) {
    if (protect.has(key)) return { ok: false, reason: "protected", key };
  }
  for (const key of removeKeys) {
    if (protect.has(key)) return { ok: false, reason: "protected", key };
  }
  for (const key of removeKeys) {
    if (key in (spec.set ?? {}) || key in (spec.ensure ?? {})) return { ok: false, reason: "conflict", key };
  }

  const read = readDoc(text);
  if (!read) {
    // Beginnt der Text mit einem Zaun, der nie schließt, ist das kein „Notiz ohne Block“, sondern ein Block, den wir nicht lesen können.
    if (text.startsWith("---")) return { ok: false, reason: "unparseable" };
    if (!spec.create) return { ok: true, content: text, changed: false };
    const writes = collect(setEntries, ensureEntries, () => false, spec.onlyExisting === true);
    if (writes.length === 0) return { ok: true, content: text, changed: false };
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    // Jeder Eintrag über `keyLines`, damit ein Literal hier denselben Weg nimmt wie in einem vorhandenen Block.
    const block = ["---", ...writes.flatMap(([k, v]) => keyLines(k, v, spec.listStyle)), "---", ""].join(eol);
    return { ok: true, content: `${block}${text}`, changed: true };
  }

  const { doc, bodyFrom } = read;
  const writes = collect(setEntries, ensureEntries, (k) => doc.entries.has(k), spec.onlyExisting === true);

  const replaced = new Map<number, string[]>();
  const dropped = new Set<number>();
  const appended: string[] = [];
  // `remove`: alle Vorkommen jedes Schlüssels, samt Fortsetzungszeilen. Ein Block-Skalar am Schlüssel wird wie bei `set` gemeldet, nicht angefasst.
  if (removeKeys.length > 0) {
    const weg = new Set(removeKeys);
    for (const e of scanAll(doc.lines)) {
      if (!weg.has(e.key)) continue;
      if (e.kind === "block-scalar") return { ok: false, reason: "block-scalar", key: e.key };
      if (e.kind === "unclear") return { ok: false, reason: "unparseable", key: e.key };
      for (let i = e.start; i < e.end; i++) dropped.add(i);
    }
  }
  for (const [key, value] of writes) {
    const lines = keyLines(key, value, spec.listStyle);
    const e = doc.entries.get(key);
    if (!e) { appended.push(...lines); continue; }
    if (e.kind === "block-scalar") return { ok: false, reason: "block-scalar", key };
    if (e.kind === "unclear") return { ok: false, reason: "unparseable", key };
    replaced.set(e.start, lines);
    for (let i = e.start; i < e.end; i++) dropped.add(i);
  }
  const out: string[] = [];
  for (let i = 0; i < doc.lines.length; i++) {
    const neu = replaced.get(i);
    if (neu) out.push(...neu);
    else if (!dropped.has(i)) out.push(doc.lines[i] ?? "");
  }
  out.push(...appended);
  // Ein leerer Block hat keine Zeile, an die ein Zeilenende anschließt: die Schlusszeile bekommt es hier.
  const raw = doc.empty ? (out.length > 0 ? out.join(doc.eol) + doc.eol : "") : out.join(doc.eol);
  // Fiel der letzte Schlüssel eines Blocks mit Zeilen, bleibt der leere Block (`---` direkt auf `---`): der schließende Zaun trägt sein Zeilenende vorn und verlöre sonst nicht die Leerzeile.
  const leerNachRemove = !doc.empty && out.length === 0;
  const content = `${doc.open}${raw}${leerNachRemove ? doc.close.replace(/^\r?\n/, "") : doc.close}${text.slice(bodyFrom)}`;
  return { ok: true, content, changed: content !== text };
}

/** Die Schreibvorgänge in Reihenfolge: erst `set`, dann `ensure` (nur wo der Schlüssel fehlt und `set` ihn nicht schon schreibt). */
function collect(
  setEntries: Array<[string, FmValue | FmLiteral]>,
  ensureEntries: Array<[string, FmValue | FmLiteral]>,
  has: (key: string) => boolean,
  onlyExisting: boolean,
): Array<[string, FmValue | FmLiteral]> {
  const out: Array<[string, FmValue | FmLiteral]> = [];
  const written = new Set<string>();
  for (const [k, v] of setEntries) {
    if (onlyExisting && !has(k)) continue;
    out.push([k, v]);
    written.add(k);
  }
  for (const [k, v] of ensureEntries) {
    if (has(k) || written.has(k)) continue;
    out.push([k, v]);
    written.add(k);
  }
  return out;
}
