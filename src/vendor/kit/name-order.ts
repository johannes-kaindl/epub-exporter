// vendored from code-kit@0.43.0, src/ts/pure/name-order.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** The naming rule that turns a file or folder name into an order, a title and a hidden flag: `01 - Intro` is chapter 1 titled
 *  "Intro", `1.10 Foo` sorts behind `1.2 Foo`, `0 - Notes` is hidden. String logic only; the caller strips the extension and
 *  decides whether the rule is on at all (a setting) — with it off, the full name is the title and the order is the caller's own.
 *
 *  Origin: the "folder as book" design of epub-exporter (`_SDD/2026-10-27-epub-exporter-ordner-als-buch-design.md` § 5.1), written
 *  here from the first use (Bibliothek ab Eins) so that the preview and the export of one consumer, and a second one later, read a
 *  name the same way.
 *
 *  The rule: the **prefix** is the start of the name up to the first letter (`\p{L}`): digits, spaces, punctuation, emoji. The rest
 *  is the **title**. The **key** is the list of the numbers of the digit runs in the prefix, in order of appearance. Two refinements:
 *  - digits that stand directly before a letter belong to the title, not the prefix (`3D Grafik`, `2FA einrichten`; `1 3D Grafik` is
 *    key `[1]`, title "3D Grafik");
 *  - a name with nothing left after the prefix (`01`, `01 -`) keeps its full name as the title.
 *
 *  A name is **hidden** when its key is not empty and every value in it is 0 (`0`, `00`, `0.0`; `0.5` and `01` are not).
 *
 *  A digit run is read as a `Number`; beyond about 1e308 it is `Infinity`, and two such numbers compare equal. Digits are ASCII
 *  `0-9`; other decimal digits (`٣`) are not letters, so they sit in the prefix and give no key.
 *
 *  Order ({@link compareOrderedNames}): by key value by value, a shorter key before a longer one with the same start; names with a
 *  key before names without; equal keys by title in natural order (digit runs by value, anything else lower-cased and compared by
 *  code point — not `localeCompare`, whose result depends on the host's locale and ICU build). Pure, no I/O. */

export interface OrderedName {
  /** The numbers of the prefix, in order. Empty when the name has no number before its first letter. */
  key: number[];
  /** The name without its prefix, or the full name when nothing else is left. */
  title: string;
  /** The key is not empty and all of it is 0. */
  hidden: boolean;
}

/** Everything up to the first letter. A name without a letter is all prefix. */
const PREFIX = /^\P{L}*/u;
const TRAILING_DIGITS = /\d+$/;
const DIGIT_RUN = /\d+/g;

/** Reads the name (without extension) by the rule in the module header. */
export function parseOrderedName(name: string): OrderedName {
  let prefixEnd = (PREFIX.exec(name)?.[0] ?? "").length;
  // Digits that stand right before a letter are part of the title (`3D`, `2FA`) — only when a letter follows at all.
  if (prefixEnd < name.length) {
    const tail = TRAILING_DIGITS.exec(name.slice(0, prefixEnd));
    if (tail) prefixEnd -= tail[0].length;
  }
  const prefix = name.slice(0, prefixEnd);
  const rest = name.slice(prefixEnd).trim();
  const key = (prefix.match(DIGIT_RUN) ?? []).map(Number);
  return {
    key,
    title: rest === "" ? name : rest,
    hidden: key.length > 0 && key.every((n) => n === 0),
  };
}

/** Orders two parsed names: a negative number if `a` comes first, positive if `b` does, `0` if neither does. Antisymmetric
 *  (`compare(a, b) === -compare(b, a)`, with `0` for both). Does not look at `hidden`; the caller drops hidden names first. */
export function compareOrderedNames(a: OrderedName, b: OrderedName): number {
  if (a.key.length === 0 && b.key.length > 0) return 1;
  if (b.key.length === 0 && a.key.length > 0) return -1;
  const byKey = compareKeys(a.key, b.key);
  return byKey !== 0 ? byKey : compareNatural(a.title, b.title);
}

function compareKeys(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** Digit runs by value (so `2` before `10`, at any size), other text lower-cased and compared by code point. */
function compareNatural(a: string, b: string): number {
  const ta = a.match(/\d+|\D+/g) ?? [];
  const tb = b.match(/\d+|\D+/g) ?? [];
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const x = ta[i] ?? "";
    const y = tb[i] ?? "";
    const bothDigits = /^\d/.test(x) && /^\d/.test(y);
    const c = bothDigits ? compareDigitRuns(x, y) : compareCodePoints(x.toLowerCase(), y.toLowerCase());
    if (c !== 0) return c;
  }
  return ta.length === tb.length ? 0 : ta.length < tb.length ? -1 : 1;
}

/** By value without a conversion: no leading zeros, then the longer run is the bigger number, then digit by digit. */
function compareDigitRuns(a: string, b: string): number {
  const x = a.replace(/^0+/, "");
  const y = b.replace(/^0+/, "");
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  return x === y ? 0 : x < y ? -1 : 1;
}

function compareCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i) ?? 0;
    const y = b.codePointAt(j) ?? 0;
    if (x !== y) return x < y ? -1 : 1;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  return i < a.length ? 1 : j < b.length ? -1 : 0;
}
