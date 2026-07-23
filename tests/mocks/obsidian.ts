// tests/mocks/obsidian.ts
// Test-only node stand-in for the "obsidian" module, activated via the vitest
// resolve.alias. Modeled on obsidian-kit/src/testing/obsidian-mock.ts
// (obsidian-plugin-test-pattern skill), trimmed to exactly what the sidebar
// code imports. NEVER import this from src/.

// Minimal stand-in for the DOM events the sidebar listens to. Only the members
// the renderer actually touches — enough to drive drag and keyboard handlers.
export interface FakeEvent {
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  altKey?: boolean;
  key?: string;
  dataTransfer?: { effectAllowed: string; setData(format: string, data: string): void };
}

export class FakeEl {
  tag: string;
  children: FakeEl[] = [];
  classes = new Set<string>();
  attrs: Record<string, string> = {};
  text = "";
  private listeners: Record<string, Array<(ev: FakeEvent) => void>> = {};
  draggable = false;
  focusCount = 0;

  constructor(tag = "div") {
    this.tag = tag;
  }

  empty(): void {
    this.children = [];
  }
  addClass(...cls: string[]): this {
    for (const c of cls) this.classes.add(c);
    return this;
  }
  removeClass(...cls: string[]): this {
    for (const c of cls) this.classes.delete(c);
    return this;
  }
  toggleClass(cls: string, on?: boolean): this {
    const want = on ?? !this.classes.has(cls);
    if (want) this.classes.add(cls);
    else this.classes.delete(cls);
    return this;
  }
  hasClass(cls: string): boolean {
    return this.classes.has(cls);
  }

  private make(tag: string, o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
    const el = new FakeEl(tag);
    if (o?.cls) for (const c of o.cls.split(/\s+/).filter(Boolean)) el.classes.add(c);
    if (o?.text) el.text = o.text;
    if (o?.attr) for (const [k, v] of Object.entries(o.attr)) el.attrs[k] = v;
    this.children.push(el);
    return el;
  }
  createEl(tag: string, o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
    return this.make(tag, o);
  }
  createDiv(o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
    return this.make("div", o);
  }
  createSpan(o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
    return this.make("span", o);
  }

  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null;
  }

  addEventListener(ev: string, fn: (ev: FakeEvent) => void): void {
    (this.listeners[ev] ??= []).push(fn);
  }
  set onclick(fn: (ev: FakeEvent) => void) {
    this.listeners["click"] = [fn];
  }

  // ── test-only event plumbing (not part of Obsidian's API) ────────────────
  dispatch(ev: string, payload: Partial<FakeEvent> = {}): FakeEvent {
    const e: FakeEvent = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
      ...payload,
    };
    for (const fn of this.listeners[ev] ?? []) fn(e);
    return e;
  }
  click(): void {
    this.dispatch("click");
  }
  focus(): void {
    this.focusCount++;
  }

  // ── test-only introspection (not part of Obsidian's API) ────────────────
  findAll(cls: string): FakeEl[] {
    const out: FakeEl[] = [];
    const walk = (el: FakeEl): void => {
      if (el.classes.has(cls)) out.push(el);
      for (const c of el.children) walk(c);
    };
    for (const c of this.children) walk(c);
    return out;
  }
  find(cls: string): FakeEl | null {
    return this.findAll(cls)[0] ?? null;
  }
  get allText(): string {
    return (this.text ? [this.text] : []).concat(this.children.map((c) => c.allText)).join(" ").trim();
  }
}

export function makeFakeEl(tag = "div"): FakeEl {
  return new FakeEl(tag);
}

export function setIcon(el: FakeEl, icon: string): void {
  el.attrs["data-icon"] = icon;
}

export class Notice {
  constructor(public message?: string) {}
}

// Settable stand-in for Obsidian's `Platform`. Real usage only ever reads
// `isMobile`; tests mutate it directly to exercise both states. Defaults to
// desktop so every pre-existing test (written before mobile suppression
// existed) is unaffected.
export const Platform: { isMobile: boolean } = { isMobile: false };

// Minimal YAML-object serializer, just enough for import.ts's frontmatter
// block (flat + string-array values). NOT a general YAML implementation.
export function stringifyYaml(obj: Record<string, unknown>): string {
  const line = (v: unknown): string => {
    if (Array.isArray(v)) {
      return v.length ? `\n${v.map((x) => `  - ${JSON.stringify(String(x))}`).join("\n")}` : " []";
    }
    if (typeof v === "boolean" || typeof v === "number") return ` ${v}`;
    return ` ${JSON.stringify(String(v ?? ""))}`;
  };
  return Object.entries(obj)
    .map(([k, v]) => `${k}:${line(v)}`)
    .join("\n");
}

// Minimal stand-in for the imperative Setting builder. The declarative path
// never instantiates it; it only needs to exist as a binding so settings-tab.ts
// (which still keeps display() as a <1.13 fallback) can be imported under node.
export class Setting {
  constructor(_containerEl?: unknown) {}
}

// Minimal SettingTab/PluginSettingTab base. The declarative-API methods
// (getSettingDefinitions/getControlValue/setControlValue) live on the plugin
// subclass; the base only supplies the pieces those methods touch —
// refreshDomState — plus a call counter for test introspection.
export class PluginSettingTab {
  containerEl = makeFakeEl();
  refreshDomStateCalls = 0;
  constructor(public app: unknown, public plugin: unknown) {}
  refreshDomState(): void {
    this.refreshDomStateCalls++;
  }
}

export class TFile {
  path = "";
  basename = "";
  extension = "md";
  parent: { path: string } | null = null;
}

export class TFolder {
  path = "";
  children: unknown[] = [];
}

export class MarkdownView {
  file: TFile | null = null;
}

export class WorkspaceLeaf {
  view: unknown = null;
  async setViewState(): Promise<void> {}
  detach(): void {}
}

export class ItemView {
  containerEl = makeFakeEl();
  contentEl = makeFakeEl();
  app: unknown;
  constructor(public leaf: WorkspaceLeaf) {
    // Obsidian seeds containerEl.children[1] as the content area; mirror that.
    this.containerEl.children = [makeFakeEl(), this.contentEl];
  }
  registerEvent(): void {}
  getViewType(): string {
    return "";
  }
  getDisplayText(): string {
    return "";
  }
  getIcon(): string {
    return "";
  }
}
