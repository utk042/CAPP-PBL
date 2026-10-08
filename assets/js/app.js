/*
 * app.js — interface of the Pharmacy Inventory Computing System.
 * Engines: alu.js (Unit 2), cpu.js (Unit 3), store.js (inventory data).
 */
(function () {
  'use strict';
  const C = window.CAPP;
  const S = C.store;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (v) => '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hex = (v, n = 4) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
  const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const bits = (str, cls = '') => `<span class="bits ${cls}">${[...str].map((b) => `<span class="${!cls && b === '1' ? 'on' : ''}">${b}</span>`).join('')}</span>`;
  const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* */ } } };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast.h);
    toast.h = setTimeout(() => t.classList.remove('on'), 2400);
  }

  /* ------------------------------------------------------------ theme */
  const th = store.get('capp-theme');
  if (th) document.documentElement.dataset.theme = th;
  $('#theme').onclick = () => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const cur = document.documentElement.dataset.theme || (dark ? 'dark' : 'light');
    document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark';
    store.set('capp-theme', document.documentElement.dataset.theme);
  };

  /* ------------------------------------------------------------ routing */
  function route() {
    const [view, topic] = (location.hash.slice(1) || 'stock').split('/');
    const v = ['stock', 'lab', 'about'].includes(view) ? view : 'stock';
    $$('.view').forEach((el) => el.classList.toggle('on', el.id === 'view-' + v));
    $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === v));
    if (v === 'stock') renderStock();
    if (v === 'lab') openTopic(topic || store.get('capp-topic', 'alu'));
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /* ============================================================ STOCK */
  const MASK = { reorder: 0b00000011, expiry: 0b00001100 };
  let filter = 'all';

  function state(m, reg) {
    if (reg & 8) return ['bad', 'Expired'];
    if (reg & 2) return ['bad', 'Out of stock'];
    if (reg & 1) return ['warn', 'Reorder'];
    if (reg & 4) return ['warn', 'Expiring'];
    return ['', 'In stock'];
  }

  function renderStock() {
    const meds = S.medicines;
    const regs = meds.map(S.statusOf);
    let value = 0;
    meds.forEach((m) => { value = Math.fround(value + Math.fround(Math.fround(m.price) * m.qty)); });
    const units = meds.reduce((s, m) => s + m.qty, 0);
    const nRe = regs.filter((r) => r & MASK.reorder).length;
    const nEx = regs.filter((r) => r & MASK.expiry).length;
    $('#summary').innerHTML = `${meds.length} medicines · <span class="num">${units.toLocaleString('en-IN')}</span> units · <span class="num">${inr(value)}</span>` +
      (nRe || nEx ? ` · <span style="color:var(--warn)">${[nRe && nRe + ' to reorder', nEx && nEx + ' expiring'].filter(Boolean).join(', ')}</span>` : '');

    const q = $('#q').value.trim().toLowerCase();
    const max = Math.max(1, ...meds.map((m) => Math.max(m.qty, m.reorder * 1.5)));
    const rows = meds.map((m, i) => ({ m, reg: regs[i] })).filter(({ m, reg }) =>
      (!q || `${m.name} ${m.batch} ${m.supplier} ${m.category}`.toLowerCase().includes(q)) &&
      (filter === 'all' || (reg & MASK[filter])));
    $('#list').innerHTML = rows.length ? rows.map(({ m, reg }) => {
      const [tone, label] = state(m, reg);
      const d = S.daysToExpiry(m);
      return `<div class="row" role="listitem" tabindex="0" data-id="${m.id}">
        <div class="a"><div class="nm">${esc(m.name)}</div><div class="sub">${esc(m.category)} · ${esc(m.batch)}</div></div>
        <div class="qty"><div class="n num">${m.qty} <small>/ reorder at ${m.reorder}</small></div>
          <div class="track"><i class="${reg & 3 ? 'low' : ''}" style="width:${Math.min(100, (m.qty / max) * 100)}%"></i><b style="left:${(m.reorder / max) * 100}%"></b></div></div>
        <div class="exp num">${fmtDate(m.expiry)}<small>${d < 0 ? Math.abs(d) + ' days ago' : d + ' days left'}</small></div>
        <div class="state"><span class="dot ${tone}"></span>${label}</div></div>`;
    }).join('') : `<div class="empty">No medicines match.</div>`;
  }
  $('#q').oninput = renderStock;
  $('#filter').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    filter = b.dataset.f;
    $$('#filter button').forEach((x) => x.classList.toggle('on', x === b));
    renderStock();
  };
  $('#list').onclick = (e) => { const r = e.target.closest('.row'); if (r) openSheet(+r.dataset.id); };
  $('#list').onkeydown = (e) => { const r = e.target.closest('.row'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSheet(+r.dataset.id); } };

  /* ---------- medicine sheet */
  let sheetId = null, moveKind = 'sale', moveN = 10;
  function openSheet(id) {
    sheetId = id;
    renderSheet();
    if (!$('#sheet').open) $('#sheet').showModal();
  }
  function renderSheet(err = '') {
    const m = S.find(sheetId);
    if (!m) { $('#sheet').close(); return; }
    const reg = S.statusOf(m);
    const [tone, label] = state(m, reg);
    const div = C.divide(Math.min(m.qty, 255), Math.min(m.packSize, 255), 8);
    const packs = Math.floor(m.qty / m.packSize), loose = m.qty % m.packSize;
    const fp = C.ieee754(m.price, 'single');
    const val = Math.fround(Math.fround(m.price) * m.qty);
    const set = C.STATUS_BITS.filter((b) => b.key !== 'RSV' && reg & (1 << b.bit)).map((b) => b.label).join(', ') || 'none set';
    const last = S.tx.find((t) => t.id === m.id);
    const d = S.daysToExpiry(m);
    $('#sheetBody').innerHTML = `
      <div class="sheet-head"><div><h2 id="sheetTitle">${esc(m.name)}</h2><p>${esc(m.category)} · Batch ${esc(m.batch)} · ${esc(m.supplier)}</p></div>
        <button class="icon" data-close aria-label="Close"><svg viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15"/></svg></button></div>
      <dl class="facts">
        <div><dt>In stock</dt><dd class="num">${m.qty} units</dd></div>
        <div><dt>Status</dt><dd><span class="state" style="justify-self:start"><span class="dot ${tone}"></span>${label}</span></dd></div>
        <div><dt>Packs</dt><dd class="num">${packs} × ${m.packSize}${loose ? ' + ' + loose : ''}</dd></div>
        <div><dt>Reorder level</dt><dd class="num">${m.reorder}</dd></div>
        <div><dt>Unit price</dt><dd class="num">${inr(m.price)}</dd></div>
        <div><dt>Expires</dt><dd class="num">${fmtDate(m.expiry)}<span class="muted" style="font-weight:400"> · ${d < 0 ? 'expired' : d + 'd'}</span></dd></div>
      </dl>
      <div>
        <div class="seg" id="mvKind" style="margin-bottom:10px"><button data-k="sale" class="${moveKind === 'sale' ? 'on' : ''}">Sell</button><button data-k="purchase" class="${moveKind === 'purchase' ? 'on' : ''}">Restock</button></div>
        <form class="move" id="mvForm"><input type="number" id="mvN" min="1" max="65535" value="${moveN}" aria-label="Units"><button class="btn solid">${moveKind === 'sale' ? 'Record sale' : 'Add stock'}</button></form>
        <p class="err">${esc(err)}</p>
      </div>
      <div class="hood">
        <h2>Under the hood</h2>
        <div class="hood-row"><span>Status register</span><span>${bits(C.bin(reg, 8))}<br><span class="muted">${esc(set)}</span></span></div>
        <div class="hood-row"><span>Packs (${m.qty > 255 || m.packSize > 255 ? 'exact' : 'restoring division'})</span><span class="mono">${m.qty} ÷ ${m.packSize} → Q=${m.qty > 255 ? packs : div.quotient}, R=${m.qty > 255 ? loose : div.remainder}</span></span></div>
        <div class="hood-row"><span>Price, IEEE 754</span><span><span class="mono">${fp.hex}</span><br><span class="mono" style="font-size:11px"><span style="color:var(--sign)">${fp.bits.sign}</span> <span style="color:var(--exp)">${fp.bits.exponent}</span> <span style="color:var(--frac)">${fp.bits.fraction}</span></span></span></div>
        <div class="hood-row"><span>Stock value, float32</span><span class="mono">${Math.fround(m.price)} × ${m.qty} = ${val}</span></div>
        <div class="hood-row"><span>Last movement</span><span class="mono">${last ? `${last.op} ${last.before}, ${last.units} → ${last.after}<br><span class="muted">Z${last.flags.Z} N${last.flags.N} C${last.flags.C} V${last.flags.V}</span>` : '—'}</span></div>
      </div>
      <div class="sheet-foot"><button class="btn quiet danger" data-del>Delete</button><button class="btn" data-edit>Edit</button></div>`;
  }
  $('#sheet').addEventListener('click', (e) => {
    if (e.target === $('#sheet')) return $('#sheet').close();
    if (e.target.closest('[data-close]')) return $('#sheet').close();
    const k = e.target.closest('#mvKind button');
    if (k) { moveN = +$('#mvN').value || moveN; moveKind = k.dataset.k; renderSheet(); return; }
    if (e.target.closest('[data-edit]')) { $('#sheet').close(); openEditor(S.find(sheetId)); }
    if (e.target.closest('[data-del]')) {
      const m = S.find(sheetId);
      if (confirm(`Delete ${m.name}?`)) { S.remove(m.id); $('#sheet').close(); renderStock(); toast('Deleted ' + m.name); }
    }
  });
  $('#sheet').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = +$('#mvN').value;
    moveN = n || 10;
    if (!(n >= 1)) return renderSheet('Enter a number of units.');
    const r = S.move(sheetId, moveKind, n);
    if (!r.ok) return renderSheet(r.reason);
    renderSheet();
    renderStock();
    toast(`${r.tx.op} ${r.tx.before}, ${r.tx.units} → ${r.tx.after}`);
  });

  /* ---------- editor */
  let editing = null;
  function openEditor(m) {
    editing = m || null;
    const f = $('#edForm');
    f.reset();
    $('#edTitle').textContent = m ? 'Edit medicine' : 'Add medicine';
    const v = m || { qty: 0, packSize: 10, reorder: 20, price: 1, expiry: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10) };
    for (const el of f.elements) {
      if (!el.name || !(el.name in v)) continue;
      if (el.type === 'checkbox') el.checked = !!v[el.name]; else el.value = v[el.name];
    }
    $('#editor').returnValue = '';
    $('#editor').showModal();
  }
  $('#add').onclick = () => openEditor(null);
  $('#editor').addEventListener('click', (e) => { if (e.target === $('#editor')) $('#editor').close(); });
  $('#editor').addEventListener('close', () => {
    if ($('#editor').returnValue !== 'save') return;
    const f = $('#edForm');
    const m = {
      name: f.name.value.trim(), category: f.category.value.trim(), batch: f.batch.value.trim(), supplier: f.supplier.value.trim(),
      qty: +f.qty.value, packSize: Math.max(1, +f.packSize.value), reorder: +f.reorder.value, price: +f.price.value,
      expiry: f.expiry.value, rx: f.rx.checked, cold: f.cold.checked,
    };
    if (editing) m.id = editing.id;
    S.upsert(m);
    renderStock();
    toast('Saved ' + m.name);
  });

  /* ============================================================ LAB */
  const TOPICS = [
    { grp: 'Unit 2 · Arithmetic' },
    { id: 'alu', t: 'ALU', fn: alu },
    { id: 'division', t: 'Division', fn: division },
    { id: 'booth', t: 'Multiplication', fn: booth },
    { id: 'float', t: 'Floating point', fn: float },
    { grp: 'Unit 3 · Control unit' },
    { id: 'isa', t: 'Instruction set', fn: isa },
    { id: 'cycle', t: 'Instruction cycle', fn: cycle },
    { id: 'control', t: 'Control design', fn: control },
    { id: 'pipeline', t: 'Pipelining', fn: pipeline },
    { id: 'flynn', t: 'Flynn’s taxonomy', fn: flynn },
  ];
  $('#topics').innerHTML = TOPICS.map((x) => x.grp ? `<div class="grp">${x.grp}</div>` : `<a href="#lab/${x.id}" data-t="${x.id}">${x.t}</a>`).join('');
  function openTopic(id) {
    const tp = TOPICS.find((x) => x.id === id) || TOPICS[1];
    store.set('capp-topic', tp.id);
    $$('#topics a').forEach((a) => a.classList.toggle('on', a.dataset.t === tp.id));
    const on = $('#topics a.on');
    if (on && on.scrollIntoView && matchMedia('(max-width: 860px)').matches) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    stopRun(); clearInterval(flynnT);
    tp.fn($('#panel'));
  }
  const seg = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const onSeg = (el, fn) => { el.onclick = (e) => { const b = e.target.closest('button'); if (b) fn(b.dataset.v); }; };
  const table = (head, rows, cls = '') => `<div class="tbl ${cls}"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

  /* ---------- ALU */
  const L = { a: 120, b: 30, op: 'SUB', dA: 157, dM: 10, dMethod: 'restoring', bM: -12, bQ: 10, fpMode: 'encode', fpV: '6.4', fpP: 'single', fA: '6.4', fB: '36', fOp: 'mul' };
  function alu(p) {
    p.innerHTML = `<h3>Arithmetic &amp; logic unit</h3>
      <p class="intro">An 8-bit ALU with a 3-bit function select (S2 S1 S0) and four flags. A sale runs <code>SUB stock, sold</code>. If the C flag drops to 0, the subtraction borrowed, so the sale is refused. Logic operations mask the 8-bit status register that drives the stock filters.</p>
      <div class="inputs"><label>A (stock)<input type="number" id="aA" min="0" max="255" value="${L.a}"></label><label>B (units)<input type="number" id="aB" min="0" max="255" value="${L.b}"></label></div>
      ${seg('aOp', C.ALU_OPS.map((o) => [o.name, o.name]), L.op)}
      <div class="card" style="margin-top:16px" id="aOut"></div>`;
    const draw = () => {
      L.a = Math.max(0, Math.min(255, +$('#aA').value | 0)); L.b = Math.max(0, Math.min(255, +$('#aB').value | 0));
      const op = C.ALU_OPS.find((o) => o.name === L.op);
      const r = C.alu(L.op, L.a, L.b, 8);
      const unary = ['NOT', 'SHL', 'SHR'].includes(L.op);
      $('#aOut').innerHTML = `<div class="out">
        <div class="out-row"><span>A</span>${bits(C.bin(L.a, 8))}<span class="num">${L.a}</span></div>
        ${unary ? '' : `<div class="out-row"><span>B</span>${bits(C.bin(L.b, 8))}<span class="num">${L.b}</span></div>`}
        <div class="out-row total"><span>F</span>${bits(C.bin(r.result, 8))}<span class="num big" style="font-size:22px">${r.result}</span></div></div>
        <div class="answer flags" style="margin-top:16px"><span>S = <b>${C.bin(op.code, 3)}</b></span><span>${op.expr}</span></div>
        <div class="flags" style="margin-top:8px">${Object.entries(r.flags).map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('')}</div>`;
    };
    $('#aA').oninput = $('#aB').oninput = draw;
    onSeg($('#aOp'), (v) => { L.op = v; $$('#aOp button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); draw(); });
    draw();
  }

  /* ---------- Division */
  function division(p) {
    p.innerHTML = `<h3>Division</h3>
      <p class="intro">Loose tablets ÷ pack size gives full packs (quotient) and loose tablets (remainder). The divider shifts A,Q left, subtracts M, and sets Q0 from the sign of A, restoring A after a negative result or not.</p>
      <div class="inputs"><label>Tablets (Q)<input type="number" id="dQ" min="0" max="255" value="${L.dA}"></label><label>Per pack (M)<input type="number" id="dM" min="1" max="255" value="${L.dM}"></label>
      ${seg('dMeth', [['restoring', 'Restoring'], ['nonrestoring', 'Non-restoring']], L.dMethod)}</div>
      <div id="dOut"></div>`;
    const draw = () => {
      L.dA = +$('#dQ').value; L.dM = +$('#dM').value;
      if (!(L.dA >= 0 && L.dA <= 255 && L.dM >= 1 && L.dM <= 255)) { $('#dOut').innerHTML = '<p class="err">Use 0–255 tablets and 1–255 per pack.</p>'; return; }
      const r = C.divide(L.dA, L.dM, 8, L.dMethod);
      $('#dOut').innerHTML = `<div class="card"><div class="big num">${r.quotient} packs + ${r.remainder}</div><p class="small">${L.dA} = ${r.quotient} × ${L.dM} + ${r.remainder}</p></div>
        ${table(['Step', 'Action', 'A', 'Q'], r.steps.map((s) => `<tr><td>${s.step}</td><td class="wrap">${s.action}</td><td class="mono">${s.A}</td><td class="mono">${s.Q}</td></tr>`))}`;
    };
    $('#dQ').oninput = $('#dM').oninput = draw;
    onSeg($('#dMeth'), (v) => { L.dMethod = v; $$('#dMeth button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); draw(); });
    draw();
  }

  /* ---------- Booth */
  function booth(p) {
    p.innerHTML = `<h3>Signed multiplication · Booth’s algorithm</h3>
      <p class="intro">For example, a return of −12 strips × 10 tablets each. Each step looks at Q0 and Q−1: on 10 it subtracts M, on 01 it adds M, then it shifts A, Q, Q−1 right arithmetically.</p>
      <div class="inputs"><label>Multiplicand M<input type="number" id="bM" min="-127" max="127" value="${L.bM}"></label><label>Multiplier Q<input type="number" id="bQ" min="-127" max="127" value="${L.bQ}"></label></div>
      <div id="bOut"></div>`;
    const draw = () => {
      L.bM = +$('#bM').value; L.bQ = +$('#bQ').value;
      if (!(Math.abs(L.bM) <= 127 && Math.abs(L.bQ) <= 127)) { $('#bOut').innerHTML = '<p class="err">Use values between −127 and 127.</p>'; return; }
      const r = C.booth(L.bM, L.bQ, 8);
      $('#bOut').innerHTML = `<div class="card"><div class="big num">${r.product}</div><p class="small mono">${r.bits}</p></div>
        ${table(['Step', 'Q0 Q−1', 'Action', 'A', 'Q', 'Q−1'], r.steps.map((s) => `<tr><td>${s.step}</td><td class="mono">${s.pair || ''}</td><td>${s.action}</td><td class="mono">${s.A}</td><td class="mono">${s.Q}</td><td class="mono">${s.Q_1}</td></tr>`))}`;
    };
    $('#bM').oninput = $('#bQ').oninput = draw;
    draw();
  }

  /* ---------- Floating point */
  function float(p) {
    p.innerHTML = `<h3>Floating point · IEEE 754</h3>
      <p class="intro">Prices are stored as IEEE 754 words. Arithmetic on them unpacks the fields, works on the significands, normalises, rounds to nearest even and packs the result again. Every result here matches the hardware bit for bit.</p>
      <div style="margin-bottom:20px">${seg('fMode', [['encode', 'Representation'], ['arith', 'Arithmetic']], L.fpMode)}</div>
      <div id="fBody"></div>`;
    const body = () => {
      if (L.fpMode === 'encode') {
        $('#fBody').innerHTML = `<div class="inputs"><label>Value<input type="text" id="fV" value="${esc(L.fpV)}" inputmode="decimal"></label>${seg('fP', [['single', '32-bit'], ['double', '64-bit']], L.fpP)}</div><div id="fOut"></div>`;
        const draw = () => {
          L.fpV = $('#fV').value.trim();
          const x = L.fpV === '-0' ? -0 : Number(L.fpV);
          if (L.fpV === '' || (Number.isNaN(x) && L.fpV.toLowerCase() !== 'nan')) { $('#fOut').innerHTML = '<p class="err">Enter a number.</p>'; return; }
          const r = C.ieee754(x, L.fpP);
          $('#fOut').innerHTML = `<div class="card"><div class="bitrow">${bits(r.bits.sign, 's')}${bits(r.bits.exponent, 'e')}${bits(r.bits.fraction, 'f')}</div>
            <div class="key"><span><i style="background:var(--sign)"></i>sign</span><span><i style="background:var(--exp)"></i>exponent, bias ${r.bias}</span><span><i style="background:var(--frac)"></i>fraction</span></div></div>
            <dl class="facts" style="margin-top:16px">
              <div><dt>Hex</dt><dd class="mono">${r.hex}</dd></div><div><dt>Class</dt><dd>${r.kind}</dd></div>
              <div><dt>Exponent</dt><dd class="mono">${r.exponent} − ${r.bias} = ${r.kind === 'Normalised' ? r.exponent - r.bias : r.unbiased}</dd></div>
              <div><dt>Stored as</dt><dd class="mono">${Object.is(r.stored, -0) ? '-0' : r.stored}</dd></div></dl>
            ${r.precision === 'single' && Number.isFinite(x) && r.error !== 0 ? `<p class="small">Rounding error: ${r.error.toExponential(3)}</p>` : ''}`;
        };
        $('#fV').oninput = draw;
        onSeg($('#fP'), (v) => { L.fpP = v; $$('#fP button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); draw(); });
        draw();
      } else {
        $('#fBody').innerHTML = `<div class="inputs"><label>A<input type="text" id="fA" value="${esc(L.fA)}" inputmode="decimal"></label>
          ${seg('fOp', [['add', '+'], ['sub', '−'], ['mul', '×'], ['div', '÷']], L.fOp)}<label>B<input type="text" id="fB" value="${esc(L.fB)}" inputmode="decimal"></label></div><div id="fOut"></div>`;
        const draw = () => {
          L.fA = $('#fA').value; L.fB = $('#fB').value;
          const a = Number(L.fA), b = Number(L.fB);
          if (!Number.isFinite(a) || !Number.isFinite(b)) { $('#fOut').innerHTML = '<p class="err">Enter two numbers.</p>'; return; }
          const r = C.fpArith(a, b, L.fOp);
          $('#fOut').innerHTML = `<div class="card"><div class="big num">${r.result}</div><p class="small">${Object.is(r.result, r.expected) || r.result === r.expected ? 'Matches the hardware FPU' : 'Hardware gives ' + r.expected}</p></div>
            <div class="card"><div class="steps">${r.steps.map((s) => `<div class="step"><b>${esc(s.title.replace(/^\d+b?\.\s*/, ''))}</b><pre>${esc(s.detail)}</pre></div>`).join('')}</div></div>`;
        };
        $('#fA').oninput = $('#fB').oninput = draw;
        onSeg($('#fOp'), (v) => { L.fOp = v; $$('#fOp button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); draw(); });
        draw();
      }
    };
    onSeg($('#fMode'), (v) => { L.fpMode = v; $$('#fMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); body(); });
    body();
  }

  /* ---------- Instruction set */
  function isa(p) {
    p.innerHTML = `<h3>PharmaCPU instruction set</h3>
      <p class="intro">A 16-bit machine with 8 registers and 512 words of memory. The 4-bit opcode selects one of 16 instructions in four types. Five formats use immediate, direct, register and base + displacement addressing.</p>
      <div class="card" style="display:grid;gap:14px">${Object.values(C.FORMATS).map((f) => `<div><div class="small" style="margin:0 0 6px">${f.name}</div>
        <div style="display:flex;gap:2px">${f.fields.map(([n, w]) => `<div style="flex:${w};min-width:0;background:var(--sunken);border-radius:5px;padding:6px 4px;text-align:center;font-size:11px;font-family:var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${n}, ${w} bits">${n}<span class="muted"> ${w}</span></div>`).join('')}</div></div>`).join('')}</div>
      <div style="margin-top:16px">${table(['Opcode', 'Instruction', 'Type', 'Meaning'], C.ISA.map((i) => `<tr><td class="mono">${C.bin(i.op, 4)}</td><td class="mono"><b>${i.mn}</b></td><td>${i.type}</td><td class="mono">${i.desc}</td></tr>`))}</div>`;
  }

  /* ---------- Instruction cycle (shared CPU) */
  const cpu = new C.CPU();
  let progKey = 'lowstock', src = C.PROGRAMS.lowstock.src, program = [], asmErr = '', prev = null, running = null;
  function fillData(mem) {
    const meds = S.medicines.slice(0, 40);
    for (let a = 0x100; a < 0x200; a++) mem[a] = 0;
    mem[0x100] = meds.length;
    meds.forEach((m, i) => { mem[0x101 + 3 * i] = m.qty & 0xffff; mem[0x102 + 3 * i] = m.reorder & 0xffff; mem[0x103 + 3 * i] = S.statusOf(m); });
    mem[0x1e0] = 30;
  }
  function loadProgram() {
    stopRun();
    try { program = C.assemble(src).program; asmErr = ''; } catch (e) { program = []; asmErr = e.message; }
    cpu.reset();
    cpu.load(program.map((x) => x.word));
    fillData(cpu.mem);
    prev = null;
  }
  loadProgram();
  const snap = () => ({ R: cpu.R.slice(), PC: cpu.PC, IR: cpu.IR, MAR: cpu.MAR, MBR: cpu.MBR, A: cpu.Areg, B: cpu.Breg, Y: cpu.Y });
  let lastEv = null;
  function stopRun() { if (running) { clearInterval(running); running = null; const b = $('#cRun'); if (b) b.textContent = 'Run'; } }
  const RESULT = { lowstock: [0x1f0, 'medicines below reorder level'], total: [0x1f1, 'units in stock'], flags: [0x1f2, 'expired or expiring'], sale: [0x101, 'units left of item 1 after selling 30'] };

  function cycle(p) {
    p.innerHTML = `<h3>Instruction cycle</h3>
      <p class="intro">Each instruction runs as fetch (T0–T2), decode (T3) and execute (T4 onward). Every clock performs one step of register-transfer micro-operations. The programs run on the inventory stored in memory at <code>0x100</code>.</p>
      <div class="inputs"><label>Program<select id="cProg">${Object.entries(C.PROGRAMS).map(([k, v]) => `<option value="${k}" ${k === progKey ? 'selected' : ''}>${v.title}</option>`).join('')}</select></label></div>
      <div class="controls"><button class="btn" id="cTick">Clock</button><button class="btn" id="cInstr">Instruction</button><button class="btn solid" id="cRun">Run</button><button class="btn quiet" id="cReset">Reset</button></div>
      <div class="cpu"><div class="card now" id="cNow"></div><div class="regs" id="cRegs"></div></div>
      <div style="margin-top:16px" id="cCode"></div>
      <details><summary>Edit assembly source</summary><textarea id="cSrc" spellcheck="false">${esc(src)}</textarea><div class="controls"><button class="btn" id="cAsm">Assemble &amp; load</button></div></details>
      <p class="err" id="cErr">${esc(asmErr)}</p>`;
    $('#cProg').onchange = () => { progKey = $('#cProg').value; src = C.PROGRAMS[progKey].src; $('#cSrc').value = src; loadProgram(); lastEv = null; drawCpu(); };
    $('#cAsm').onclick = () => { src = $('#cSrc').value; loadProgram(); lastEv = null; $('#cErr').textContent = asmErr; drawCpu(); };
    $('#cReset').onclick = () => { loadProgram(); lastEv = null; drawCpu(); };
    const tick = () => { const e = cpu.tick(); if (e) lastEv = e; return !!e; };
    $('#cTick').onclick = () => { stopRun(); prev = snap(); tick(); drawCpu(); };
    $('#cInstr').onclick = () => { stopRun(); prev = snap(); do { if (!tick()) break; } while (cpu.queue.length && !cpu.halted); drawCpu(); };
    $('#cRun').onclick = () => {
      if (running) return stopRun();
      if (cpu.halted) loadProgram();
      $('#cRun').textContent = 'Pause';
      running = setInterval(() => {
        prev = snap();
        for (let i = 0; i < 4; i++) if (!tick()) break;
        drawCpu();
        if (cpu.halted) { stopRun(); toast(`Halted · ${cpu.instrCount} instructions, ${cpu.cycles} clocks`); }
      }, 40);
    };
    drawCpu();
  }
  function drawCpu() {
    if (!$('#cNow')) return;
    const e = lastEv;
    const states = cpu.cur && cpu.cur.mn ? ['T0', 'T1', 'T2', 'T3', ...C.EXEC[cpu.cur.mn].map((s) => s.t)] : ['T0', 'T1', 'T2', 'T3'];
    const [addr, what] = RESULT[progKey] || [];
    $('#cNow').innerHTML = e ? `<div class="muted">${e.phase}${cpu.cur && cpu.cur.word !== undefined ? ' · <span class="mono">' + esc(C.disasm(cpu.cur.word)) + '</span>' : ''}</div>
        <div class="rtl">${e.rtl}${e.fired ? '' : ' <span class="muted">(condition false)</span>'}</div>
        <div class="tline">${states.map((t) => `<span class="${t === e.t ? 'on' : ''}">${t}</span>`).join('')}</div>
        <div class="muted">${cpu.halted ? `Halted. <b style="color:var(--text)">M[${hex(addr, 3)}] = ${cpu.mem[addr]}</b> ${what}.` : `Clock ${cpu.cycles} · ${cpu.instrCount} instructions done`}</div>`
      : `<div class="muted">Ready</div><div class="rtl">Press Clock to run one micro-operation step.</div><div class="tline">${states.map((t) => `<span>${t}</span>`).join('')}</div><div class="muted">Result goes to M[${hex(addr, 3)}], ${what}.</div>`;
    const now = snap();
    const reg = (n, v, ch) => `<div class="reg ${ch ? 'chg' : ''}"><span>${n}</span>${hex(v, 4)}</div>`;
    $('#cRegs').innerHTML = [
      reg('PC', now.PC, prev && prev.PC !== now.PC), reg('IR', now.IR, prev && prev.IR !== now.IR), reg('MAR', now.MAR, prev && prev.MAR !== now.MAR), reg('MBR', now.MBR, prev && prev.MBR !== now.MBR),
      ...now.R.map((v, i) => reg('R' + i, v, prev && prev.R[i] !== v)),
      reg('A', now.A, prev && prev.A !== now.A), reg('B', now.B, prev && prev.B !== now.B), reg('Y', now.Y, prev && prev.Y !== now.Y),
      `<div class="reg"><span>Flags</span>Z${cpu.F.Z} N${cpu.F.N} C${cpu.F.C}</div>`,
    ].join('');
    $('#cCode').innerHTML = table(['Addr', 'Machine code', 'Assembly'], program.map((x) =>
      `<tr class="${cpu.cur && x.addr === cpu.cur.pc && !cpu.halted ? 'cur' : ''}"><td class="mono">${hex(x.addr, 2)}</td><td class="mono">${C.fieldsOf(x.word).map((f) => f.bits).join(' ')}</td><td class="mono">${esc(x.src.replace(/\s*;.*$/, ''))}</td></tr>`), 'scroll');
  }

  /* ---------- Control design */
  let ctlMode = 'hard', ctlIns = 'SUB';
  function control(p) {
    p.innerHTML = `<h3>Control unit design</h3>
      <p class="intro">The same micro-operations, produced two ways. <b>Hardwired</b>: a sequence counter and an opcode decoder feed logic gates, so each step fires on a term such as D6·T4. <b>Microprogrammed</b>: each step is a word in control memory, addressed by the CAR. Horizontal microcode has one bit per signal (24 bits, no decoding). Vertical microcode packs the signals into encoded fields (26 bits, needs a decoder).</p>
      <div class="inputs">${seg('kMode', [['hard', 'Hardwired'], ['micro', 'Microprogrammed']], ctlMode)}
        <label>Instruction<select id="kIns">${C.ISA.map((i) => `<option ${i.mn === ctlIns ? 'selected' : ''}>${i.mn}</option>`).join('')}</select></label></div>
      <div id="kOut"></div>`;
    const draw = () => {
      const ins = C.ISA.find((i) => i.mn === ctlIns);
      const base = 8 * (ins.op + 1);
      const steps = C.FETCH.map((s, i) => ({ ...s, car: i })).concat(C.EXEC[ctlIns].map((s, i) => ({ ...s, car: base + i })));
      if (ctlMode === 'hard') {
        $('#kOut').innerHTML = table(['Timing', 'Control term', 'Micro-operations'], steps.map((s) => {
          const term = s.phase === 'Execute' ? `D${ins.op}·${s.t}${s.cond && s.cond !== 'U' ? '·' + s.cond : ''}` : s.t;
          return `<tr><td class="mono">${s.t}</td><td class="mono">${term}</td><td class="mono">${s.rtl}</td></tr>`;
        }).concat(`<tr><td></td><td class="mono">last T</td><td class="mono">SC ← 0</td></tr>`));
      } else {
        $('#kOut').innerHTML = table(['CAR', 'Micro-operations', 'Horizontal', 'Vertical  F1 F2 F3 CD BR AD'], steps.map((s) => {
          const m = C.CONTROL_MEMORY[s.car];
          const v = C.verticalWord(m);
          return `<tr><td class="mono">${s.car}</td><td class="mono">${s.rtl}</td><td class="mono">${C.horizontalWord(m)}</td><td class="mono">${v.F1} ${v.F2} ${v.F3} ${v.CD} ${v.BR} ${v.AD}</td></tr>`;
        })) + `<p class="small">After decode the mapping logic loads <code>CAR ← 8·opcode + 8</code> = ${base}. The last micro-instruction returns to fetch with <code>CAR ← 0</code>.</p>`;
      }
    };
    onSeg($('#kMode'), (v) => { ctlMode = v; $$('#kMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); draw(); });
    $('#kIns').onchange = () => { ctlIns = $('#kIns').value; draw(); };
    draw();
  }

  /* ---------- Pipelining */
  let fwd = true;
  function pipeline(p) {
    p.innerHTML = `<h3>Pipelining</h3>
      <p class="intro">Five stages overlap: IF, ID, EX, MEM, WB. Read-after-write hazards stall the pipe unless results are forwarded, and a taken branch flushes the two instructions fetched behind it. The trace below is the selected inventory program.</p>
      <div class="inputs"><label>Program<select id="pProg">${Object.entries(C.PROGRAMS).map(([k, v]) => `<option value="${k}" ${k === progKey ? 'selected' : ''}>${v.title}</option>`).join('')}</select></label>
        ${seg('pFwd', [['1', 'Forwarding'], ['0', 'No forwarding']], fwd ? '1' : '0')}</div>
      <div id="pOut"></div>
      <h2>RISC vs CISC</h2>
      ${table(['', 'CISC', 'RISC (PharmaCPU)'], [
        ['Record one sale', '<span class="mono">SUBM [qty], [sold]</span>', '<span class="mono">LOAD · LOAD · SUB · STORE</span>'],
        ['Instructions', '1, variable length', '4, fixed 16-bit'],
        ['Cycles per instruction', '≈ 8, microcoded', '≈ 1.2, pipelined'],
        ['Clocks for 100 sales', '≈ 800', '≈ 480'],
        ['Memory access', 'any instruction', 'load / store only'],
      ].map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'wrap' : 'muted'}">${c}</td>`).join('')}</tr>`))}`;
    const draw = () => {
      const sim = new C.CPU();
      const prog = C.assemble(C.PROGRAMS[progKey].src).program;
      sim.load(prog.map((x) => x.word));
      fillData(sim.mem);
      sim.run(20000);
      const all = C.pipeline(sim.trace, { forwarding: fwd });
      const pp = C.pipeline(sim.trace, { forwarding: fwd, limit: 14 });
      const head = ['Instruction', ...Array.from({ length: pp.total }, (_, i) => i + 1)];
      $('#pOut').innerHTML = `<div class="stats">
          <div><span>Instructions</span><b class="num">${all.n}</b></div><div><span>Unpipelined</span><b class="num">${all.nonPipelined}</b></div>
          <div><span>Pipelined</span><b class="num">${all.total}</b></div><div><span>Speed-up</span><b class="num">${all.speedup.toFixed(2)}×</b></div></div>
        ${table(head, pp.rows.map((r, idx) => {
          const prevStart = idx ? pp.rows[idx - 1].start : 0;
          let cells = '';
          for (let c = 1; c <= pp.total; c++) {
            const k = c - r.start;
            if (k >= 0 && k < 5) cells += `<td><span class="s s-${C.STAGES[k]}">${C.STAGES[k]}</span></td>`;
            else if (r.stalls && c > prevStart && c < r.start) cells += `<td class="s-x" title="${esc(r.reason)}">·</td>`;
            else cells += '<td></td>';
          }
          return `<tr><td class="mono" title="${esc(r.reason)}">${esc(r.mn)}</td>${cells}</tr>`;
        }), 'pipe-wrap').replace('<table>', '<table class="pipe">')}
        <p class="small">First 14 instructions shown. ${all.stalls} stall cycles in total, CPI ${all.cpi.toFixed(2)}. Red dots mark stalls; hover them for the reason.</p>`;
    };
    $('#pProg').onchange = () => { progKey = $('#pProg').value; src = C.PROGRAMS[progKey].src; loadProgram(); lastEv = null; draw(); };
    onSeg($('#pFwd'), (v) => { fwd = v === '1'; $$('#pFwd button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); draw(); });
    draw();
  }

  /* ---------- Flynn */
  let flynnT = null, lanes = 4;
  function flynn(p) {
    p.innerHTML = `<h3>Flynn’s taxonomy</h3>
      <p class="intro">An expiry check over every medicine. SISD compares one date per instruction. SIMD applies the same compare to several dates at once, one per lane.</p>
      <div class="inputs">${seg('fl', [['1', 'SISD'], ['2', 'SIMD × 2'], ['4', 'SIMD × 4'], ['8', 'SIMD × 8']], String(lanes))}<button class="btn solid" id="flGo">Run scan</button></div>
      <div class="lanes" id="flGrid"></div><p class="small" id="flStat">&nbsp;</p>
      <h2>The four classes</h2>
      ${table(['Class', 'Streams', 'In a pharmacy'], [
        ['SISD', 'one instruction, one data', 'A single core checks one medicine at a time'],
        ['SIMD', 'one instruction, many data', 'Vector compare of many expiry dates'],
        ['MISD', 'many instructions, one data', 'Redundant checks of one prescription'],
        ['MIMD', 'many instructions, many data', 'Billing, stock and reports on separate cores'],
      ].map((r) => `<tr><td><b>${r[0]}</b></td><td class="muted">${r[1]}</td><td class="wrap">${r[2]}</td></tr>`))}`;
    const grid = () => { $('#flGrid').innerHTML = S.medicines.map((m) => `<div class="lane"><div class="n">${esc(m.name)}</div><div class="d num">${fmtDate(m.expiry)}</div></div>`).join(''); };
    grid();
    onSeg($('#fl'), (v) => { lanes = +v; $$('#fl button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); });
    $('#flGo').onclick = () => {
      clearInterval(flynnT);
      grid();
      const meds = S.medicines, cells = $$('#flGrid .lane');
      let i = 0, steps = 0;
      flynnT = setInterval(() => {
        cells.forEach((c) => c.classList.remove('go'));
        if (i >= meds.length) {
          clearInterval(flynnT);
          const bad = meds.filter((m) => S.statusOf(m) & 0b1100).length;
          $('#flStat').textContent = `${meds.length} medicines in ${steps} instruction steps, ${bad} expired or expiring.${lanes > 1 ? ` ${lanes}× fewer steps than SISD.` : ''}`;
          return;
        }
        for (let k = 0; k < lanes && i < meds.length; k++, i++) cells[i].classList.add('go', S.statusOf(meds[i]) & 0b1100 ? 'bad' : 'ok');
        steps++;
        $('#flStat').textContent = `Step ${steps}`;
      }, 420);
    };
  }

  /* ============================================================ ABOUT */
  $('#syllabus').innerHTML = [
    ['Unit 1', 'Registers, buses, memory transfer, addressing modes', 'done'],
    ['Unit 2', 'Booth’s multiplication, division, logic operations', 'done'],
    ['Unit 2', 'ALU design, floating point, IEEE 754', 'done'],
    ['Unit 3', 'Instruction types, formats, cycle, micro-operations', 'done'],
    ['Unit 3', 'Program control, RISC and CISC, pipelining', 'done'],
    ['Unit 3', 'Hardwired and microprogrammed control, Flynn’s taxonomy', 'done'],
    ['Unit 4', 'Cache, virtual memory, coherence protocols', ''],
    ['Unit 5', 'Shared memory, consistency, synchronisation, interconnects', ''],
  ].map(([u, t, s]) => `<div><dt>${u}</dt><dd>${t}</dd><dd class="${s}">${s ? 'Done' : 'Next review'}</dd></div>`).join('');

  route();
})();
