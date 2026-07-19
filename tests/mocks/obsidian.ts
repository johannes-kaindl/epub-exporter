// tests/mocks/obsidian.ts
// Test-only node stand-in for the "obsidian" module, activated via the vitest
// resolve.alias. Modeled on obsidian-kit/src/testing/obsidian-mock.ts
// (obsidian-plugin-test-pattern skill), trimmed to exactly what the sidebar
// code imports. NEVER import this from src/.

export class FakeEl {
  tag: string;
  children: FakeEl[] = [];
  classes = new Set<string>();
  attrs: Record<string, string> = {};
  text = "";
  private listeners: Record<string, Array<() => void>> = {};

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

  addEventListener(ev: string, fn: () => void): void {
    (this.listeners[ev] ??= []).push(fn);
  }
  set onclick(fn: () => void) {
    this.listeners["click"] = [fn];
  }
  click(): void {
    for (const fn of this.listeners["click"] ?? []) fn();
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
