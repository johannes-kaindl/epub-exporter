#!/bin/sh
# Vendort Kit-Module byte-identisch aus dem Schwester-Repo obsidian-kit (Dach-AGENTS.md, Kit-first).
# Nie von Hand editieren — Skript neu laufen lassen.
#
# CORE-META-22: Gelesen wird aus einer festen Git-Ref, NICHT aus dem Arbeitsstand des
# Nachbar-Repos. Ein `cat ../obsidian-kit/src/...` liefert je nach dessen HEAD etwas anderes
# oder gar nichts, waehrend die Herkunftsangabe in VENDOR.json einen Pin behauptet — zwei
# Messungen, die auseinanderlaufen, ohne dass es jemand sieht. `git show <ref>:<pfad>` ist
# reproduzierbar, an den Pin gebunden und stoert keine parallele Session im Nachbar-Repo
# (kein `checkout`).
#
# ZWEI REFS, und das ist Absicht: dieses Repo haelt die beiden Vendor-Ordner bewusst auf
# verschiedenen Staenden. `src/vendor/kit` steht auf 0.27.0 (dort kam vault-path.ts dazu),
# `src/vendor/kit-obsidian` auf 0.25.0. Beide auf denselben Stand zu heben, waere eine
# INHALTLICHE Aenderung an vendoriertem Code und gehoert getestet — nicht in ein Skript, das
# nur den Leseweg geradezieht. Wer hebt, setzt KIT_OBS_REF und faehrt danach `npm run gate`.
#
# Zweiter Lauf darf keinen Diff erzeugen — das ist die Probe darauf, dass Header und
# VENDOR.json deterministisch sind (deshalb steht hier KEIN Datum: es wuerde jeden Lauf einen
# Diff erzeugen).
set -e
KIT=../obsidian-kit
KIT_REF=${KIT_REF:-0.27.0}
KIT_OBS_REF=${KIT_OBS_REF:-0.25.0}
# Dritter Pin, ebenfalls Absicht: help-setting.ts (Hilfe-Zeile, UI-STANDARD 8) kam mit Kit 0.43.0 und
# haengt an keinem anderen Modul — die beiden anderen kit-obsidian-Module bleiben auf ihrem Stand.
KIT_HELP_REF=${KIT_HELP_REF:-0.43.0}

# Der Tag-Commit, nicht der Kit-HEAD — und `^{commit}` ist Pflicht, nicht Kosmetik: obsidian-kit
# taggt annotiert, ohne die Peelung landet das Tag-OBJEKT in VENDOR.json. Diese SHA kommt in
# `git log --all` null mal vor, und der Pin zeigt dann auf etwas, das niemand wiederfindet
# (gemessen 2026-09-02 an obsidian-kit selbst, Nachtrag zur CORE-META-22-Dach-Task).
sha_von() { git -C "$KIT" rev-parse --short "$1^{commit}"; }
ver_von() { git -C "$KIT" describe --tags --abbrev=0 "$1"; }

for ref in "$KIT_REF" "$KIT_OBS_REF" "$KIT_HELP_REF"; do
  git -C "$KIT" rev-parse --verify --quiet "$ref^{commit}" >/dev/null \
    || { echo "FEHLER: Ref '$ref' existiert nicht in $KIT." >&2; exit 1; }
done

SHA=$(sha_von "$KIT_REF");         VER=$(ver_von "$KIT_REF")
OBS_SHA=$(sha_von "$KIT_OBS_REF"); OBS_VER=$(ver_von "$KIT_OBS_REF")
HELP_SHA=$(sha_von "$KIT_HELP_REF"); HELP_VER=$(ver_von "$KIT_HELP_REF")

mkdir -p src/vendor/kit src/vendor/kit-obsidian

PURE="i18n settings vault-path"
OBS="settings_walker folder-suggest"
HELP="help-setting"

# VORPRUEFUNG, bevor irgendetwas geschrieben wird.
#
# Ein Abbruch mitten im Lauf ist zu spaet: `set -e` rettet nur die Datei, an der es ausloest,
# und laesst alle vorher geschriebenen auf dem neuen Stand zurueck — der Vendor-Ordner ist
# danach halb alt, halb neu, und der Abbruch sah "korrekt" aus (gemessen in vault-rag am
# 2026-08-30 mit KIT_REF=0.28.0). Deshalb: erst pruefen, ob JEDE Quelle in ihrer Ref
# existiert, dann schreiben. Der Fall ist real — seit Kit 0.28.0 sind die pure/-Module nach
# code-kit gezogen, ein Lauf mit 0.28.0 traefe genau darauf.
fehlend=""
for f in $PURE; do
  git -C "$KIT" cat-file -e "$KIT_REF:src/pure/$f.ts" 2>/dev/null \
    || fehlend="$fehlend src/pure/$f.ts@$KIT_REF"
done
for f in $OBS; do
  git -C "$KIT" cat-file -e "$KIT_OBS_REF:src/obsidian/$f.ts" 2>/dev/null \
    || fehlend="$fehlend src/obsidian/$f.ts@$KIT_OBS_REF"
done
for f in $HELP; do
  git -C "$KIT" cat-file -e "$KIT_HELP_REF:src/obsidian/$f.ts" 2>/dev/null \
    || fehlend="$fehlend src/obsidian/$f.ts@$KIT_HELP_REF"
done
if [ -n "$fehlend" ]; then
  echo "FEHLER: in obsidian-kit fehlen:$fehlend" >&2
  echo "        Nichts geschrieben. Ab Kit 0.28.0 sind die pure/-Module nach code-kit gezogen —" >&2
  echo "        die Ref zu heben verlangt eine Entscheidung ueber die QUELLE, nicht nur ueber die Version." >&2
  exit 1
fi

# vendor <zielpfad> <kit-relativer-quellpfad> <version-label> <git-ref>
#
# Schreibt ERST nach .tmp und verschiebt NUR bei Erfolg. Grund: die naheliegende Form
# `{ printf header; git show ...; } > ziel` legt die Zieldatei an, BEVOR `git show` laeuft —
# fehlt die Quelle in der Ref, bleibt eine Datei zurueck, die nur aus dem Herkunftsstempel
# besteht und wie ein gueltiges Vendoring aussieht. Genau dieser Stummel ist der Grund, warum
# CORE-META-22 den `cat`-Weg verbietet (Beleg: finance-ledger, 2026-08-27).
vendor() {
  tmp="$1.tmp"
  { printf '%s\n' "// vendored from obsidian-kit@$3, $2 — do not hand-edit; re-vendor via tools/sync-kit.sh"
    git -C "$KIT" show "${4}:$2"; } > "$tmp" || {
      rm -f "$tmp"
      echo "FEHLER: $2 fehlt in obsidian-kit@$3 — nichts geschrieben." >&2
      exit 1
    }
  mv "$tmp" "$1"
}

for f in $PURE; do
  vendor "src/vendor/kit/$f.ts" "src/pure/$f.ts" "$VER" "$KIT_REF"
done
for f in $OBS; do
  vendor "src/vendor/kit-obsidian/$f.ts" "src/obsidian/$f.ts" "$OBS_VER" "$KIT_OBS_REF"
done

for f in $HELP; do
  vendor "src/vendor/kit-obsidian/$f.ts" "src/obsidian/$f.ts" "$HELP_VER" "$KIT_HELP_REF"
done

# write_vendor_json <verzeichnis> <version> <sha> <modul-liste> <zusatz-note>
write_vendor_json() {
  printf '{\n  "source": "obsidian-kit",\n  "version": "%s",\n  "sha": "%s",\n  "vendored": "%s",\n  "note": "Verbatim snapshot aus der Git-Ref %s (CORE-META-22: feste Ref, nicht Arbeitsstand). Never hand-edit. Re-vendor via tools/sync-kit.sh. %s"\n}\n' \
    "$2" "$3" "$4" "$2" "$5" > "$1/VENDOR.json"
}
write_vendor_json src/vendor/kit "$VER" "$SHA" \
  "$(printf '%s.ts, ' $PURE | sed 's/, $//')" \
  "kit-obsidian/ steht bewusst auf einem anderen Stand — siehe dortige VENDOR.json."
write_vendor_json src/vendor/kit-obsidian "$OBS_VER" "$OBS_SHA" \
  "$(printf '%s.ts, ' $OBS | sed 's/, $//'), help-setting.ts (Kit $HELP_VER, $HELP_SHA)" \
  "Getrennt von kit/, weil dieser Ordner \\\"obsidian\\\" importiert (Setting, FolderSuggest nutzen DOM-/App-APIs) und damit ausserhalb des check:pure-Scopes liegen muss. Bewusst auf einem aelteren Stand als kit/ — Heben ist eine inhaltliche Aenderung (KIT_OBS_REF setzen, danach npm run gate)."

echo "vendored: kit@$VER ($SHA) → $PURE | kit-obsidian@$OBS_VER ($OBS_SHA) → $OBS"
