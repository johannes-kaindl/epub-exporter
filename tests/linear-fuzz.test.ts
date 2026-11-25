/**
 * Linearität der Funktionen, die Kapitelinhalt zerlegen (ReDoS-Konvention, CORE-TEST-26 (b)): der erschöpfende Fuzz `pruefeLinearFuzz` aus dem Kit-Testmodul.
 * Gemessen wird ein Quotient t(50 000)/t(10 000), keine Millisekunden.
 *
 * Geprüft sind die Wege, auf denen der Notiztext eines Kapitels ankommt: Codeblöcke herausnehmen und zurücksetzen (`extractCodeBlocks`, `restoreCodeBlocks`),
 * Bildverweise lesen und umschreiben (`extractImageRefs`, `rewriteImageRefs`), Frontmatter trennen und schreiben (`splitFrontmatter`, `setCoverPrompt`) und
 * die Kapitelzeilen des Buchs (`parseEmbedSpine`).
 *
 * Nicht Gegenstand: `domToXhtml` (läuft auf einem DOM, kein Text) und `buildEpub` (Archiv, kein Text-Parser). Die Gegenprobe (eine absichtlich quadratische
 * Fassung wird rot) steht am Ende dieser Datei.
 */
import { describe, expect, it } from "vitest";
import { lastGeschuetzt, type LinearProbeSkipKontext } from "./vendor/kit/linear-probe";
import { extractCodeBlocks, restoreCodeBlocks } from "../src/core/code-blocks";
import { extractImageRefs, rewriteImageRefs } from "../src/core/image-refs";
import { setCoverPrompt } from "../src/core/frontmatter";
import { splitFrontmatter } from "../src/vendor/kit/frontmatter";
import { parseEmbedSpine } from "../src/core/spine-parser";

const FUZZ_MS = 180_000;

/** Befund als lesbarer Text, damit eine rote Zeile ohne Nachlesen verständlich ist (CORE-TEST-14). */
const befund = (r: { verdaechtig: ReadonlyArray<{ message: string }> }): string => r.verdaechtig.map((v) => v.message).join("\n");

// Unter zu hoher Rechnerlast misst die Probe nichts; lastGeschuetzt macht daraus ein Übersprungen statt eines roten Tests.
function fuzz(ctx: LinearProbeSkipKontext, fn: (s: string) => unknown, alphabet: string[]): void {
  const f = lastGeschuetzt(ctx).pruefeLinearFuzz(fn, { alphabet, maxLaenge: 3 });
  expect(f.linear, befund(f)).toBe(true);
  expect(f.gemessen, "der Fuzz hat Eingaben gemessen").toBeGreaterThan(20);
}

describe("Codeblöcke", () => {
  it("extractCodeBlocks: Fuzz über Zäune mit und ohne Sprachwort, Tilde und Zeilenumbruch", (ctx) => {
    // Ganze Zaunzeilen als Einträge: ein Zaun mit Sprachwort schließt nie mit einem Zaun mit Sprachwort, die Suche nach dem Schluss läuft dann bis zum Textende.
    fuzz(ctx, (s) => extractCodeBlocks(s), ["```js\n", "```\n", "~~~py\n", "~~~\n", "````\n", "x\n"]);
  }, FUZZ_MS);

  it("restoreCodeBlocks: Fuzz über Platzhalter-Absatz, Tags und Zeilenumbruch", (ctx) => {
    const codes = [{ lang: "js", text: "a" }];
    fuzz(ctx, (s) => restoreCodeBlocks(s, codes), ["<p>EPUBEXPORTERCODE0</p>", "<p>", "</p>", "EPUBEXPORTERCODE", "0", "\n"]);
  }, FUZZ_MS);
});

describe("Bildverweise", () => {
  it("extractImageRefs: Fuzz über Einbettungs- und Markdown-Klammern", (ctx) => {
    fuzz(ctx, (s) => extractImageRefs(s), ["![[", "]]", "![", "](", ")", "x"]);
  }, FUZZ_MS);

  it("rewriteImageRefs: Fuzz über Einbettungs- und Markdown-Klammern", (ctx) => {
    const umschreiben = [{ from: "a.png", to: "b.png" }];
    fuzz(ctx, (s) => rewriteImageRefs(s, umschreiben), ["![[", "]]", "![", "](", ")", "x"]);
  }, FUZZ_MS);
});

describe("Frontmatter und Kapitelzeilen", () => {
  it("splitFrontmatter und setCoverPrompt: Fuzz über Zaun, Schlüsselzeile und Zeilenumbruch", (ctx) => {
    const alphabet = ["---\n", "\n", "\r\n", "cover:", " ", "x"];
    fuzz(ctx, (s) => splitFrontmatter(s), alphabet);
    fuzz(ctx, (s) => setCoverPrompt(s, "p"), alphabet);
  }, FUZZ_MS);

  it("parseEmbedSpine: Fuzz über Einbettung, Leerraum und Zeilenumbruch", (ctx) => {
    fuzz(ctx, (s) => parseEmbedSpine(s), ["![[", "]]", "x", " ", "\n", "\r\n"]);
  }, FUZZ_MS);

  it("feste Eingaben: viele offene Zäune, Klammern und Zeilen bleiben linear", (ctx) => {
    const feste: Array<[string, (s: string) => unknown, (n: number) => string]> = [
      ["extractCodeBlocks, offene Zäune mit Sprachwort", extractCodeBlocks, (n) => "```js\n".repeat(Math.ceil(n / 6))],
      ["extractImageRefs, offene Klammern", extractImageRefs, (n) => "![](".repeat(Math.ceil(n / 4))],
      ["extractImageRefs, offene Einbettungen", extractImageRefs, (n) => "![[".repeat(Math.ceil(n / 3))],
      ["rewriteImageRefs, offene Klammern", (s) => rewriteImageRefs(s, [{ from: "a", to: "b" }]), (n) => "![](".repeat(Math.ceil(n / 4))],
    ];
    for (const [name, fn, make] of feste) {
      const r = lastGeschuetzt(ctx).pruefeLinear(fn, make);
      expect(r.linear, `${name}: ${r.message}`).toBe(true);
    }
  });
});

describe("Gegenprobe: der Fuzz kann rot werden (CORE-TEST-01)", () => {
  /** Absichtlich quadratisch: dieselbe Form wie `body.replace(/\n*$/, …)` auf dem Kapiteltext. */
  const quadratisch = (s: string): string => s.replace(/\n*$/, "\n\n");

  it("pruefeLinearFuzz meldet die quadratische Form als Verdacht", (ctx) => {
    const f = lastGeschuetzt(ctx).pruefeLinearFuzz((s) => quadratisch(`Rumpf\n${s}\nSchluss`), { alphabet: ["\n", "x"], maxLaenge: 1, verschachtelt: false });
    expect(f.linear).toBe(false);
    expect(f.verdaechtig.map((v) => v.einheit)).toContain("\n");
  }, FUZZ_MS);
});
