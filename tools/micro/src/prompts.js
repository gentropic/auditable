// micro — the in-app PROMPTS: one small dialog that asks for a value (microPrompt), a pick
// from a list (microChoose) or a yes/no (microConfirm). No window.prompt anywhere.
import { _exprFields, exprField } from './exprfield.js';

const $ = (s) => document.querySelector(s);

// the in-app prompt — same grammar as window.prompt (null on cancel), but
// it's OUR dialog: Enter accepts, Esc/backdrop cancel, text pre-selected
export let _pmResolve = null;

export function microPrompt(title, initial = '', opts = {}) {
  return new Promise((resolve) => {
    _pmResolve = resolve;
    $('#pmTitle').textContent = title;
    $('#pmMsg').style.display = 'none';
    const inp = $('#pmInput');
    if (opts.expr) exprField(inp, opts.expr); else _exprFields.delete(inp);   // an expression answer gets the phone's strip
    inp.style.display = '';
    inp.value = initial;
    $('#pmDlg').classList.add('show');
    inp.focus(); inp.select();
  });
}

// several answers on the same dialog: one footer button per choice, in order,
// the LAST the primary (focused); { quiet: true } sits apart on the left for a
// rarely-wanted answer. × / Esc / backdrop resolve null — the header's × only
// ever closes, every answer is in the footer.
export let _pmOkValue;

export function microChoose(title, msg, choices) {
  return new Promise((resolve) => {
    _pmResolve = resolve;
    $('#pmTitle').textContent = title;
    const m = $('#pmMsg');
    m.textContent = msg; m.style.display = '';
    $('#pmInput').style.display = 'none';
    const prim = choices[choices.length - 1];
    $('#pmOk').textContent = prim.label; _pmOkValue = prim.value;
    for (const c of choices.slice(0, -1)) {
      const b = document.createElement('button');
      b.className = c.quiet ? 'pm-alt pm-quiet' : 'pm-alt';
      b.textContent = c.label; b.onclick = () => pmClose(c.value);
      $('#pmFoot').insertBefore(b, $('#pmOk'));
    }
    $('#pmDlg .box').classList.toggle('wide', choices.length > 2);
    $('#pmDlg').classList.add('show');
    $('#pmOk').focus();
  });
}

// confirm = a two-answer choice; true on OK, false on cancel / Esc / × / backdrop
export function microConfirm(title, msg, okLabel, cancelLabel) {
  return microChoose(title, msg, [{ label: cancelLabel || 'Cancel', value: false }, { label: okLabel || 'OK', value: true }]).then((v) => v === true);
}

export function pmClose(v) {
  if (!_pmResolve) return;
  $('#pmDlg').classList.remove('show');
  $('#pmFoot').querySelectorAll('.pm-alt').forEach((b) => b.remove());   // restore the prompt's bare footer
  $('#pmDlg .box').classList.remove('wide');
  $('#pmOk').textContent = 'OK'; _pmOkValue = undefined;
  const r = _pmResolve; _pmResolve = null; r(v);
}
