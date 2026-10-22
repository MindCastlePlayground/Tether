import * as clack from '@clack/prompts';

export class Cancelled extends Error {}

// Terminal UI adapter. The wizard only talks to this surface, so tests can replace it with a script.
export class Tui {
  constructor(io = {}, words = {}) { this.io = io; this.words = words; }
  static done(value) {
    if (clack.isCancel(value)) throw new Cancelled();
    return value;
  }
  static opts(items) { return items.map(([value, label, hint]) => (hint ? { value, label, hint } : { value, label })); }
  async pick(id, message, items, initial) {
    return Tui.done(await clack.select({ message, options: Tui.opts(items), initialValue: initial, ...this.io }));
  }
  async many(id, message, items, initial) {
    return Tui.done(await clack.multiselect({ message, options: Tui.opts(items), initialValues: initial, required: true, ...this.io }));
  }
  async ask(id, message, fallback = '', placeholder = fallback, validate) {
    const value = Tui.done(await clack.text({ message, placeholder, defaultValue: fallback, validate: validate && (v => validate(v || fallback)), ...this.io }));
    return (value ?? '').trim();
  }
  async ok(id, message, initial = true) {
    return Tui.done(await clack.confirm({ message, initialValue: initial, active: this.words.yes, inactive: this.words.no, ...this.io }));
  }
  start(text) { clack.intro(text, this.io); }
  end(text) { clack.outro(text, this.io); }
  stop(text) { clack.cancel(text, this.io); }
  note(text, title) { clack.note(text, title, this.io); }
  info(text) { clack.log.info(text, this.io); }
  warn(text) { clack.log.warn(text, this.io); }
}
