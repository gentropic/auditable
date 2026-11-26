// wuffle desk — the console: a log and an input line over commands.js. ↑/↓ walk the history, Tab completes a
// command name, Enter runs. Each line is echoed with its reply; failures say what to type. "Run a routine…"
// is just many lines.

import { createCommands } from './commands.js';

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export class ConsoleView {
  constructor(ctx) {
    this.cmd = createCommands(ctx);
    this.el = h('div', 'wcon');
    this.log = h('div', 'wcon-log'); this.log.setAttribute('role', 'log'); this.log.setAttribute('aria-live', 'polite');
    const row = h('div', 'wcon-row'), prompt = h('span', 'wcon-prompt', '›');
    this.input = h('input', 'wcon-in'); this.input.type = 'text'; this.input.spellcheck = false; this.input.autocomplete = 'off';
    this.input.setAttribute('aria-label', 'command'); this.input.placeholder = 'help · sample tocher · contour kamb · select cone 150/60 20 · stats';
    row.append(prompt, this.input); this.el.append(this.log, row);
    this._hi = -1;
    this.input.addEventListener('keydown', (e) => this._key(e));
    this.el.addEventListener('click', (e) => { if (e.target === this.el || e.target === this.log) this.input.focus(); });
    this._print('wuffle console — help lists the commands', 'note');
  }
  _print(text, cls) { const d = h('div', `wcon-line ${cls || ''}`, text); this.log.append(d); this.log.scrollTop = this.log.scrollHeight; return d; }
  /** run a line as if typed → { ok, text } */
  run(line) {
    this._print(`› ${line}`, 'echo');
    const r = this.cmd.run(line);
    if (r.text) this._print(r.text, r.ok ? 'out' : 'err');
    return r;
  }
  runAll(text) { return text.split(/\r?\n/).filter((l) => l.trim() && !/^\s*#/.test(l)).map((l) => this.run(l)); }
  _key(e) {
    const hist = this.cmd.history;
    if (e.key === 'Enter') { const v = this.input.value; if (!v.trim()) return; this.input.value = ''; this._hi = -1; this.run(v); }
    else if (e.key === 'ArrowUp') { if (!hist.length) return; e.preventDefault(); this._hi = this._hi < 0 ? hist.length - 1 : Math.max(0, this._hi - 1); this.input.value = hist[this._hi]; }
    else if (e.key === 'ArrowDown') { if (this._hi < 0) return; e.preventDefault(); this._hi += 1; if (this._hi >= hist.length) { this._hi = -1; this.input.value = ''; } else this.input.value = hist[this._hi]; }
    else if (e.key === 'Tab') {
      const v = this.input.value; if (/\s/.test(v)) return;
      e.preventDefault();
      const m = this.cmd.names.filter((n) => n.startsWith(v.toLowerCase()));
      if (m.length === 1) this.input.value = m[0] + ' '; else if (m.length > 1) this._print(m.join('  '), 'note');
    }
  }
}
