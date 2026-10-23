---
paths:
  - "src/obsidian/hub-view.ts"
  - "src/obsidian/sidebar-render.ts"
  - "src/obsidian/sidebar-bridge.ts"
  - "src/core/sidebar-model.ts"
  - "src/core/spine-reorder.ts"
---

# Sidebar — Gotchas

Die Sidebar ist EIN kontextsensitives Panel (bewusst keine Tab-Maschinerie wie die Geschwister-Hubs); die pure Render-Funktion (`sidebar-render.ts`/`sidebar-model.ts`) ist vom `ItemView`-Mount (`hub-view.ts`) getrennt und damit node-testbar.

- **`getMostRecentLeaf(rootSplit)` statt `getActiveViewOfType`:** Ein Klick ins Panel macht das Panel zum aktiven Leaf, `getActiveViewOfType` liefert dann null.
- **Die Model-Key-Memoisierung überspringt den redundanten Rerender bei `active-leaf-change`;** ohne sie brauchen Buttons zwei Klicks.
- **Der Opt-in-Autostart hängt hinter `onLayoutReady`.**
