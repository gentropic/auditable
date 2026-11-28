// @gcu/dd60 — chrome: the DD-60 "DADA Diskman" device itself (a de-branded Data Discman DD-8), as a module
// any page can mount: the body, the lid with its lime LCD and the F-key pills, the round keys, NO / YES,
// INPUT MODE / SHIFT, the four arrow buttons, the wordmark. It knows nothing about what's on the screen —
// it hands the page the LCD's parts and reports what was pressed.
//
//   const dev = mountDD60(document.body, { tabs: [['filter', 'FILTER'], …], model: 'DD-60' });
//   dev.on((e) => …)        // { type: 'f', id } · { type: 'key', ch } · { type: 'dpad', dir, repeat }
//                           // · { type: 'yes' | 'no' | 'bmark' | 'input' | 'shift' }
//   dev.screen / dev.overlay / dev.status(left, right) / dev.flash(msg) / dev.setTab(id) / dev.fit()
//
// Touch first: every control is a pointer target; the d-pad repeats while held; nothing needs hover. On a
// narrow screen the device fits the WIDTH and the page scrolls; on a wide one it fits the window.

export const DD60_CSS = `
.dd60-stage { --body-1: #34373b; --body-2: #232629; --body-3: #131517;
  --lcd-bg: #c6d197; --lcd-bg2: #b9c889; --lcd-ink: #1f3a72; --lcd-dim: #5a6a86; --lcd-hi: #25499c;
  --key-1: #8b8e92; --key-2: #54575a; --key-edge: #3a3d40; --key-ink: #eef0f1;
  --red: #d8463a; --green: #58b389; --dark-1: #45494d; --dark-2: #202326;
  min-height: 100%; display: grid; place-items: center; padding: 10px 0 24px;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.dd60-stage * { box-sizing: border-box; }
.dd8 { width: 480px; position: relative; font-family: 'Barlow', Arial, system-ui, sans-serif;
  background: linear-gradient(168deg, var(--body-1), var(--body-2) 26%, var(--body-2) 80%, var(--body-3));
  border-radius: 16px; padding: 20px 22px 24px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.10), inset 0 -4px 10px rgba(0,0,0,.5), 0 30px 64px rgba(0,0,0,.6); }
.dd8::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background-image: radial-gradient(rgba(255,255,255,.018) 1px, transparent 1px); background-size: 4px 4px; mix-blend-mode: screen; }
.dd8 .lid { background: linear-gradient(166deg, #3c3f43, #2d3033 58%, #282b2e);
  border-radius: 15px 15px 5px 5px; padding: 20px 22px 15px; margin: -20px -22px 20px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.14), inset 0 -1px 0 rgba(0,0,0,.45), 0 11px 18px rgba(0,0,0,.55), 0 3px 4px rgba(0,0,0,.5); }
.dd8 .topbar { display: flex; align-items: center; justify-content: space-between; margin: 0 4px 12px; }
.dd8 .maker { font-family: Arial, sans-serif; font-weight: 800; font-size: 22px; letter-spacing: 1px; color: #e9ebec; text-shadow: 0 1px 1px #000; }
.dd8 .ebp { font-size: 10px; letter-spacing: 1.5px; color: #b9bdc0; text-transform: uppercase; }
.dd8 .ebp b { color: #e9ebec; }
.dd8 .screen-mod { background: linear-gradient(165deg, #141617, #090a0a); border-radius: 6px; padding: 14px;
  position: relative; box-shadow: inset 0 2px 7px rgba(0,0,0,.78); display: flex; gap: 12px; align-items: stretch; }
.dd8 .lcd-wrap { flex: 1; min-width: 0; }
.dd8 .mask-right { flex: none; width: 54px; display: flex; flex-direction: column; justify-content: space-between; align-items: center; padding: 2px 0 64px; }
.dd8 .ebxa { text-align: center; }
.dd8 .ebxa .mark { font-family: Arial, sans-serif; font-weight: 900; font-size: 14px; letter-spacing: .5px; color: #dfe2e3; white-space: nowrap; }
.dd8 .ebxa .mark span { display: inline-block; transform: scaleX(.74); }
.dd8 .ebxa .sub { font-size: 6.5px; letter-spacing: .3px; color: #9aa0a3; margin-top: 1px; text-transform: uppercase; }
.dd8 .dotmatrix { display: grid; grid-template-columns: repeat(7, 4px); grid-auto-rows: 4px; gap: 2px; padding: 4px; background: #161312; border-radius: 3px; box-shadow: inset 0 0 4px #000; }
.dd8 .dotmatrix i { width: 4px; height: 4px; border-radius: 50%; background: #3a1410; }
.dd8 .dotmatrix i.on { background: var(--red); box-shadow: 0 0 4px rgba(216,70,58,.8); }
.dd8 .lcd { background: linear-gradient(160deg, var(--lcd-bg), var(--lcd-bg2)); border-radius: 3px;
  height: 328px; overflow: hidden; position: relative; display: flex; flex-direction: column;
  color: var(--lcd-ink); box-shadow: inset 0 0 0 1px rgba(0,0,0,.35), inset 0 2px 10px rgba(0,0,0,.25);
  font-family: 'Space Mono', ui-monospace, 'Courier New', monospace; }
.dd8 .lcd::after { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 5;
  background: linear-gradient(118deg, rgba(255,255,255,.18), rgba(255,255,255,0) 30%); }
.dd8 .statusline { flex: none; display: flex; justify-content: space-between; gap: 8px; color: var(--lcd-dim);
  border-bottom: 1px solid rgba(31,58,114,.28); padding: 9px 12px 5px; font-size: 10.5px; letter-spacing: .3px; }
.dd8 .statusline span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dd8 .lcd-screen { flex: 1; min-height: 0; overflow: hidden; position: relative; }
.dd8 .lcd-tabs { flex: none; display: flex; gap: 2px; padding: 3px; }
.dd8 .lcd-tabs span { flex: 1; text-align: center; font-size: 9.5px; letter-spacing: .3px; padding: 2px 0; border-radius: 1px;
  background: rgba(31,58,114,.16); color: var(--lcd-ink); cursor: pointer; }
.dd8 .lcd-tabs span.active { background: var(--lcd-hi); color: var(--lcd-bg); }
.dd8 .lcd-ov { position: absolute; inset: 0 0 23px 0; z-index: 6; background: var(--lcd-bg);
  display: none; flex-direction: column; padding: 10px 0 0; }
.dd8 .lcd-ov.open { display: flex; }
.dd8 .flash { position: absolute; left: 50%; bottom: 30px; transform: translateX(-50%); z-index: 8;
  background: var(--lcd-hi); color: var(--lcd-bg); font-size: 10px; padding: 3px 10px; border-radius: 2px;
  opacity: 0; transition: opacity .15s; pointer-events: none; white-space: nowrap; }
.dd8 .flash.show { opacity: 1; }
.dd8 .frow { display: flex; gap: 9px; margin: 13px 2px 0; }
.dd8 .pill { flex: 1; text-align: center; padding: 6px 2px; border-radius: 11px;
  background: radial-gradient(circle at 50% 25%, #83868a, #4f5255); border: 1px solid #2f3234; color: #d7d9db;
  font-size: 10px; font-weight: 700; letter-spacing: .5px; box-shadow: inset 0 1px 1px rgba(255,255,255,.22), 0 2px 3px rgba(0,0,0,.5); cursor: pointer; user-select: none; }
.dd8 .pill.bmark { flex: 1.4; }
.dd8 .keys { display: flex; flex-direction: column; gap: 11px; margin: 0 2px; padding-left: 8px; }
.dd8 .krow { display: flex; gap: 8px; }
.dd8 .krow.r2 { padding-left: 16px; } .dd8 .krow.r3 { padding-left: 32px; }
.dd8 .key { position: relative; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center;
  background: radial-gradient(circle at 38% 30%, var(--key-1), var(--key-2) 96%); border: 1px solid var(--key-edge);
  color: var(--key-ink); font-size: 15px; font-weight: 700; cursor: pointer; user-select: none;
  box-shadow: inset 0 1px 1px rgba(255,255,255,.45), inset 0 -2px 3px rgba(0,0,0,.35), 0 2px 3px rgba(0,0,0,.4); text-shadow: 0 1px 1px rgba(0,0,0,.4); }
.dd8 .key .num { position: absolute; top: -13px; font-size: 10px; font-weight: 800; color: var(--red); text-shadow: none; }
.dd8 .key .acc { position: absolute; bottom: -13px; font-size: 10px; color: var(--green); text-shadow: none; }
.dd8 .band { position: relative; height: 150px; margin: 16px 0 2px; }
.dd8 .well { position: absolute; background: linear-gradient(180deg, #191b1d, #2a2d30); box-shadow: inset 0 2px 5px rgba(0,0,0,.6), inset 0 -1px 0 rgba(255,255,255,.05); }
.dd8 .well.no { left: 18px; top: 39px; width: 64px; height: 64px; border-radius: 50%; }
.dd8 .well.yes { left: 84px; top: 45px; width: 110px; height: 56px; border-radius: 28px; }
.dd8 .well.dpad { right: 34px; top: 14px; width: 150px; height: 120px; border-radius: 50%; }
.dd8 .ovl { position: absolute; background: radial-gradient(circle at 50% 28%, #83868a, #4f5255); border: 1px solid #2f3234;
  color: #e2e4e6; font-size: 12px; font-weight: 700; letter-spacing: .5px; display: grid; place-items: center;
  box-shadow: inset 0 1px 1px rgba(255,255,255,.22), 0 2px 4px rgba(0,0,0,.55); cursor: pointer; user-select: none; }
.dd8 .ovl.no { left: 26px; top: 50px; width: 48px; height: 48px; border-radius: 50%; }
.dd8 .ovl.yes { left: 92px; top: 56px; width: 94px; height: 36px; border-radius: 18px; }
.dd8 .lblbtn { position: absolute; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.dd8 .lblbtn.im { left: 23px; top: 0; } .dd8 .lblbtn.sh { left: 112px; top: 0; }
.dd8 .lblbtn .cap { font-size: 8px; letter-spacing: .5px; color: #b7babd; font-weight: 700; }
.dd8 .lblbtn .cap.teal { color: var(--green); }
.dd8 .lblbtn .btn { width: 54px; height: 15px; border-radius: 8px; background: radial-gradient(circle at 50% 30%, #6d7073, #404346); border: 1px solid #2a2d2f; box-shadow: inset 0 1px 1px rgba(255,255,255,.15), 0 2px 3px rgba(0,0,0,.5); cursor: pointer; }
.dd8 .lblbtn .btn.on { background: radial-gradient(circle at 50% 30%, #7fb79c, #3f6f58); }
.dd8 .silk { position: absolute; color: #8c9093; font-size: 11px; letter-spacing: .5px; user-select: none; pointer-events: none; }
.dd8 .silk.play { left: 128px; top: 29px; font-size: 12px; }
.dd8 .silk.seekL { right: 196px; top: 68px; } .dd8 .silk.seekR { left: 414px; top: 68px; }
.dd8 .dpad { position: absolute; right: 44px; top: 24px; width: 130px; height: 100px; }
.dd8 .dbtn { position: absolute; width: 38px; height: 38px; border-radius: 50%;
  background: radial-gradient(circle at 40% 30%, var(--dark-1), var(--dark-2)); border: 1px solid #0a0b0c;
  color: #e6e8ea; display: grid; place-items: center; font-size: 15px; cursor: pointer; user-select: none;
  box-shadow: inset 0 1px 1px rgba(255,255,255,.18), 0 2px 4px rgba(0,0,0,.5); }
.dd8 .dbtn.up { top: 0; left: 46px; } .dd8 .dbtn.down { bottom: 0; left: 46px; }
.dd8 .dbtn.left { left: 0; top: 31px; } .dd8 .dbtn.right { right: 0; top: 31px; }
.dd8 .pressed, .dd8 [data-act]:active, .dd8 .key:active, .dd8 .pill:active { transform: translateY(1px); filter: brightness(.88); }
.dd8 .wordmark { margin: 16px 6px 0; }
.dd8 .wordmark .mm { font-size: 9px; letter-spacing: 1px; color: #b7babd; font-weight: 700; }
.dd8 .wordmark .dd { font-family: Arial, sans-serif; font-weight: 800; font-size: 19px; color: #e9ebec; letter-spacing: .5px; }
.dd8 .led { position: absolute; right: 26px; bottom: 26px; width: 5px; height: 5px; border-radius: 50%; background: #2b4a3a; }
.dd8 .led.on { background: #6be08f; box-shadow: 0 0 5px #6be08f; }
`;

const ROWS = [
  [['Q', '1', 'Ä'], ['W', '2', 'Å'], ['E', '3', 'Æ'], ['R', '4', 'Ç'], ['T', '5', 'Ë'], ['Y', '6', 'Ñ'], ['U', '7', 'Ö'], ['I', '8', 'Ø'], ['O', '9', '_'], ['P', '0', 'Ü']],
  [['A'], ['S'], ['D'], ['F'], ['G'], ['H'], ['J'], ['K'], ['L']],
  [['Z', '', 'β'], ['X', '', '⇧'], ['C', '', '⏮'], ['V', '', '⏪'], ['B', '', '⏯'], ['N', '', '⏩'], ['M', '', '⏭'], ['-', '', '']],
];
const DOTS = [1,1,1,1,1,0,0, 1,0,0,0,1,1,0, 1,0,0,0,0,1,0, 1,0,1,1,0,1,0, 1,0,0,1,0,1,0, 1,1,1,1,1,0,0];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Mount the device in `host`. Options: { tabs: [[id, label] × 5], model = 'DD-60', maker = 'GCU',
 * title = 'DADA DISKMAN', keyboard = true (map the physical keyboard onto the device) }.
 */
export function mountDD60(host, { tabs = [], model = 'DD-60', maker = 'GCU', title = 'DADA DISKMAN', keyboard = true } = {}) {
  if (!document.getElementById('dd60-css')) { const st = document.createElement('style'); st.id = 'dd60-css'; st.textContent = DD60_CSS; document.head.appendChild(st); }
  const stage = document.createElement('div'); stage.className = 'dd60-stage';
  const tabHtml = tabs.map(([id, label]) => `<span data-f="${esc(id)}">${esc(label)}</span>`).join('');
  const pillHtml = tabs.map(([id], i) => `<div class="pill" data-f="${esc(id)}">F${i + 1}</div>`).join('');
  const keyHtml = ROWS.map((row, r) => `<div class="krow r${r + 1}">` + row.map(([k, n, a]) =>
    `<div class="key" data-k="${esc(k)}">${n ? `<span class="num">${n}</span>` : ''}${k === '-' ? '−' : esc(k)}${a ? `<span class="acc">${esc(a)}</span>` : ''}</div>`).join('') + '</div>').join('');
  stage.innerHTML = `<div class="dd8">
    <div class="lid">
      <div class="topbar"><div class="maker">${esc(maker)}</div><div class="ebp"><b>ELECTRONIC BOOK PLAYER</b> &nbsp;${esc(model)}</div></div>
      <div class="screen-mod">
        <div class="lcd-wrap"><div class="lcd">
          <div class="statusline"><span class="st-l">${esc(title)}</span><span class="st-r"></span></div>
          <div class="lcd-screen"></div>
          <div class="lcd-ov"></div>
          <div class="flash"></div>
          <div class="lcd-tabs">${tabHtml}</div>
        </div></div>
        <div class="mask-right"><div class="ebxa"><div class="mark">D<span>3</span>XA</div><div class="sub">Electronic Book</div></div><div class="dotmatrix">${DOTS.map((v) => `<i${v ? ' class="on"' : ''}></i>`).join('')}</div></div>
      </div>
      <div class="frow">${pillHtml}<div class="pill bmark" data-act="bmark">B-MARK</div></div>
    </div>
    <div class="keys">${keyHtml}</div>
    <div class="band">
      <div class="lblbtn im"><span class="cap">INPUT MODE</span><div class="btn" data-act="input"></div></div>
      <div class="lblbtn sh"><span class="cap teal">SHIFT</span><div class="btn" data-act="shift"></div></div>
      <div class="silk play">►&nbsp;❙❙</div>
      <div class="well no"></div><div class="well yes"></div><div class="well dpad"></div>
      <div class="ovl no" data-act="no">NO</div><div class="ovl yes" data-act="yes">YES</div>
      <span class="silk seekL">◄◄</span><span class="silk seekR">►►</span>
      <div class="dpad">
        <div class="dbtn up" data-dir="up">▲</div><div class="dbtn down" data-dir="down">▼</div>
        <div class="dbtn left" data-dir="left">◄</div><div class="dbtn right" data-dir="right">►</div>
      </div>
    </div>
    <div class="wordmark"><div class="mm">MULTI-MEDIA</div><div class="dd">DADA <b>Diskman</b></div></div>
    <div class="led"></div>
  </div>`;
  host.appendChild(stage);
  const dev = stage.firstElementChild, q = (s) => dev.querySelector(s);
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) { try { fn(e); } catch (err) { console.error('[dd60]', err); } } };

  // presses: pointerdown acts at once (a phone's click waits); the d-pad repeats while held
  let repeat = null;
  const stopRepeat = () => { if (repeat) { clearTimeout(repeat.t); clearInterval(repeat.i); repeat.el.classList.remove('pressed'); repeat = null; } };
  dev.addEventListener('pointerdown', (ev) => {
    const el = ev.target.closest('[data-f], [data-act], [data-k], [data-dir]'); if (!el || !dev.contains(el)) return;
    ev.preventDefault();
    if (el.dataset.dir) {
      stopRepeat(); el.classList.add('pressed');
      emit({ type: 'dpad', dir: el.dataset.dir, repeat: false });
      repeat = { el, t: setTimeout(() => { repeat.i = setInterval(() => emit({ type: 'dpad', dir: el.dataset.dir, repeat: true }), 70); }, 380) };
      try { el.setPointerCapture(ev.pointerId); } catch { /* fine */ }
    } else if (el.dataset.f) emit({ type: 'f', id: el.dataset.f });
    else if (el.dataset.k) emit({ type: 'key', ch: el.dataset.k });
    else emit({ type: el.dataset.act });
  });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) dev.addEventListener(t, stopRepeat);

  if (keyboard) document.addEventListener('keydown', (ev) => {
    const t = ev.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
    const map = { ArrowUp: ['dpad', 'up'], ArrowDown: ['dpad', 'down'], ArrowLeft: ['dpad', 'left'], ArrowRight: ['dpad', 'right'], Enter: ['yes'], Escape: ['no'], Backspace: ['no'] };
    const fk = /^F([1-5])$/.exec(ev.key);
    if (fk && tabs[+fk[1] - 1]) { ev.preventDefault(); emit({ type: 'f', id: tabs[+fk[1] - 1][0] }); return; }
    const m = map[ev.key];
    if (m) { ev.preventDefault(); if (m[0] === 'dpad') emit({ type: 'dpad', dir: m[1], repeat: ev.repeat }); else emit({ type: m[0], key: ev.key }); return; }
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) emit({ type: 'key', ch: ev.key, physical: true });
  });

  // fit: the whole device in a wide window; the WIDTH on a narrow one (the page scrolls, the keys stay big)
  function fit() {
    dev.style.zoom = 1;
    const w = innerWidth, h = innerHeight, narrow = w < 560;
    const s = narrow ? Math.min(1, (w - 12) / dev.offsetWidth) : Math.min(1, (h - 30) / dev.offsetHeight, (w - 30) / dev.offsetWidth);
    dev.style.zoom = s;
  }
  addEventListener('resize', fit); fit();

  let flashTimer = null;
  return {
    el: dev, screen: q('.lcd-screen'), overlay: q('.lcd-ov'), fit,
    on(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    status(left, right) { if (left != null) q('.st-l').textContent = left; if (right != null) q('.st-r').textContent = right; },
    flash(msg, ms = 1100) { const f = q('.flash'); f.textContent = msg; f.classList.add('show'); clearTimeout(flashTimer); flashTimer = setTimeout(() => f.classList.remove('show'), ms); },
    setTab(id) { for (const s of q('.lcd-tabs').children) s.classList.toggle('active', s.dataset.f === id); },
    led(on) { q('.led').classList.toggle('on', !!on); },
    toggle(act, on) { const b = q(`[data-act="${act}"]`); if (b) b.classList.toggle('on', !!on); },
  };
}
