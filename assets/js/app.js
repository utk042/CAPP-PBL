/*
 * app.js — user interface of the Pharmacy Inventory Computing System.
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
  const bitsHtml = (str, cls) => `<span class="bits">${[...str].map((b) => `<span class="${cls ? cls : b === '1' ? 'on' : 'off'}">${b}</span>`).join('')}</span>`;
  const table = (el, head, rows) => {
    el.innerHTML = `<thead><tr>${head.map((h) => `<th${h.num ? ' class="num"' : ''}>${h.t || h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>`;
  };
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.h);
    toast.h = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ----------------------------- theme / tabs ---------------------------- */
  try { const th = localStorage.getItem('capp-theme'); if (th) document.documentElement.dataset.theme = th; } catch (e) { /* */ }
  $('#themeBtn').onclick = () => {
    const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark');
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('capp-theme', document.documentElement.dataset.theme); } catch (e) { /* */ }
  };
  function showTab(name) {
    $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    if (name === 'dashboard') renderDashboard();
    if (name === 'inventory') renderInventory();
    if (name === 'cpu') { if (!cpu.cycles) assembleLoad(); else renderCpu(); }
    try { localStorage.setItem('capp-tab', name); } catch (e) { /* */ }
  }
  $$('.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

  /* ------------------------------ status ---------------------------------- */
  const BADGE = { LOW: 'b-warn', OUT: 'b-danger', NEAR: 'b-warn', EXP: 'b-danger', RX: 'b-info', COLD: 'b-info', HIGH: 'b-muted' };
  const SHORT = { LOW: 'Low', OUT: 'Out', NEAR: 'Expiring', EXP: 'Expired', RX: 'Rx', COLD: 'Cold', HIGH: 'High value' };
  function badges(reg) {
    const out = C.STATUS_BITS.filter((b) => b.key !== 'RSV' && reg & (1 << b.bit)).map((b) => `<span class="badge ${BADGE[b.key]}">${SHORT[b.key]}</span>`);
    return out.length ? out.join('') : '<span class="badge b-ok">OK</span>';
  }

  /* ------------------------------ dashboard ------------------------------- */
  function renderDashboard() {
    const meds = S.medicines;
    const regs = meds.map(S.statusOf);
    const count = (mask) => regs.filter((r) => C.logic.test(r, mask)).length;
    // stock value: single precision multiply-accumulate (what an FPU would compute)
    let value = 0;
    meds.forEach((m) => { value = Math.fround(value + Math.fround(Math.fround(m.price) * m.qty)); });
    const units = meds.reduce((s, m) => s + m.qty, 0);
    $('#kpis').innerHTML = [
      ['Medicines', meds.length],
      ['Units in stock', units.toLocaleString('en-IN')],
      ['Stock value (float32)', inr(value)],
      ['Low / out of stock', count(0b11)],
      ['Expired / expiring', count(0b1100)],
    ].map(([l, v]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');

    const alerts = [];
    meds.forEach((m, i) => {
      const r = regs[i];
      const d = S.daysToExpiry(m);
      if (r & 8) alerts.push([0, `<span class="badge b-danger">Expired</span> <b>${esc(m.name)}</b> — batch ${esc(m.batch)} expired ${-d} days ago. Remove from shelf.`]);
      if (r & 2) alerts.push([1, `<span class="badge b-danger">Out</span> <b>${esc(m.name)}</b> — 0 units. Reorder from ${esc(m.supplier)}.`]);
      if (r & 1) alerts.push([2, `<span class="badge b-warn">Low</span> <b>${esc(m.name)}</b> — ${m.qty} units ≤ reorder level ${m.reorder}.`]);
      if (r & 4) alerts.push([3, `<span class="badge b-warn">Expiring</span> <b>${esc(m.name)}</b> — expires in ${d} days (${m.expiry}).`]);
    });
    alerts.sort((a, b) => a[0] - b[0]);
    $('#alerts').innerHTML = alerts.length ? alerts.map((a) => `<li>${a[1]}</li>`).join('') : '<li>No alerts — all medicines are in stock and in date.</li>';

    const max = Math.max(1, ...meds.map((m) => Math.max(m.qty, m.reorder)));
    $('#stockBars').innerHTML = meds.map((m, i) => {
      const cls = regs[i] & 2 ? 'out' : regs[i] & 1 ? 'low' : '';
      return `<div class="bar-row"><span class="name" title="${esc(m.name)}">${esc(m.name)}</span>
        <div class="bar"><i class="${cls}" style="width:${(m.qty / max) * 100}%"></i><b style="left:${(m.reorder / max) * 100}%"></b></div>
        <span class="num">${m.qty}</span></div>`;
    }).join('');

    const tx = S.tx.slice(0, 12);
    table($('#txTable'), ['Time', 'Medicine', 'Type', { t: 'Units', num: 1 }, 'ALU operation', 'Flags'],
      tx.length ? tx.map((t) => `<tr><td>${new Date(t.at).toLocaleString()}</td><td>${esc(t.name)}</td>
        <td><span class="badge ${t.kind === 'sale' ? 'b-warn' : 'b-ok'}">${t.kind}</span></td><td class="num">${t.units}</td>
        <td class="mono">${t.op} ${t.before}, ${t.units} → ${t.after}</td><td class="mono">Z=${t.flags.Z} N=${t.flags.N} C=${t.flags.C} V=${t.flags.V}</td></tr>`)
        : ['<tr><td colspan="6">No movements yet — record a sale or purchase from the Inventory tab.</td></tr>']);
  }

  /* ------------------------------ inventory ------------------------------- */
  let filterMask = 0;
  $('#maskFilter').innerHTML = C.STATUS_BITS.filter((b) => b.key !== 'RSV').map((b) =>
    `<label title="${b.label}"><input type="checkbox" value="${b.bit}"> ${SHORT[b.key]}</label>`).join('');
  $('#maskFilter').onchange = () => {
    filterMask = $$('#maskFilter input:checked').reduce((m, i) => m | (1 << +i.value), 0);
    renderInventory();
  };
  $('#search').oninput = renderInventory;

  function renderInventory() {
    const q = $('#search').value.trim().toLowerCase();
    const rows = S.medicines.filter((m) => {
      if (q && !`${m.name} ${m.batch} ${m.supplier} ${m.category}`.toLowerCase().includes(q)) return false;
      return !filterMask || C.logic.test(S.statusOf(m), filterMask);
    });
    $('#maskExpr').innerHTML = filterMask
      ? `Filter: <code>status ∧ ${C.bin(filterMask, 8)} ≠ 0</code> — ${rows.length} match(es).`
      : 'Tip: tick status chips to filter with a bit mask (logic AND).';
    table($('#invTable'), ['Medicine', 'Batch', { t: 'Units', num: 1 }, { t: 'Packs + loose', num: 1 }, { t: 'Reorder', num: 1 }, { t: 'Price', num: 1 }, 'Expiry', 'Status reg', 'Status', ''],
      rows.map((m) => {
        const reg = S.statusOf(m);
        const strips = Math.floor(m.qty / m.packSize), loose = m.qty % m.packSize;
        const d = S.daysToExpiry(m);
        return `<tr><td><b>${esc(m.name)}</b><br><small class="hint">${esc(m.category)} · ${esc(m.supplier)}</small></td>
          <td class="mono">${esc(m.batch)}</td><td class="num">${m.qty}</td>
          <td class="num" title="${m.qty} ÷ ${m.packSize} (division unit)">${strips} × ${m.packSize} + ${loose}</td>
          <td class="num">${m.reorder}</td><td class="num">${inr(m.price)}</td>
          <td>${m.expiry}<br><small class="hint">${d < 0 ? -d + ' d ago' : d + ' d left'}</small></td>
          <td>${bitsHtml(C.bin(reg, 8))}</td><td>${badges(reg)}</td>
          <td style="white-space:nowrap"><button class="btn sm" data-move="${m.id}">± Stock</button>
            <button class="btn sm" data-edit="${m.id}">Edit</button>
            <button class="btn sm danger" data-del="${m.id}" aria-label="Delete">✕</button></td></tr>`;
      }));
  }
  $('#invTable').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.edit) openMed(S.find(+b.dataset.edit));
    if (b.dataset.move) openMove(S.find(+b.dataset.move));
    if (b.dataset.del) {
      const m = S.find(+b.dataset.del);
      if (confirm(`Delete ${m.name}?`)) { S.remove(m.id); renderInventory(); toast('Deleted ' + m.name); }
    }
  };

  let editing = null;
  function openMed(m) {
    editing = m || null;
    const f = $('#medForm');
    f.reset();
    $('#medDialog').returnValue = '';
    $('#medTitle').textContent = m ? 'Edit medicine' : 'Add medicine';
    const v = m || { qty: 0, packSize: 10, reorder: 20, price: 1, expiry: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10) };
    for (const el of f.elements) {
      if (!el.name || !(el.name in v)) continue;
      if (el.type === 'checkbox') el.checked = !!v[el.name]; else el.value = v[el.name];
    }
    $('#medDialog').showModal();
  }
  $('#addBtn').onclick = () => openMed(null);
  $('#medDialog').addEventListener('close', () => {
    if ($('#medDialog').returnValue !== 'save') return;
    const f = $('#medForm');
    const m = {
      name: f.name.value.trim(), category: f.category.value.trim(), batch: f.batch.value.trim(), supplier: f.supplier.value.trim(),
      qty: +f.qty.value, packSize: Math.max(1, +f.packSize.value), reorder: +f.reorder.value, price: +f.price.value,
      expiry: f.expiry.value, rx: f.rx.checked, cold: f.cold.checked,
    };
    if (editing) m.id = editing.id;
    S.upsert(m);
    renderInventory();
    toast('Saved ' + m.name);
  });

  let moving = null;
  function openMove(m) {
    moving = m;
    $('#moveTitle').textContent = 'Stock movement — ' + m.name;
    $('#moveErr').textContent = '';
    $('#moveDialog').showModal();
  }
  $('#moveForm').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    const f = $('#moveForm');
    const r = S.move(moving.id, f.kind.value, +f.units.value);
    if (!r.ok) { e.preventDefault(); $('#moveErr').textContent = r.reason; return; }
    toast(`${r.tx.op} ${r.tx.before}, ${r.tx.units} → ${r.tx.after}  (Z=${r.alu.flags.Z} N=${r.alu.flags.N} C=${r.alu.flags.C})`);
    setTimeout(renderInventory);
  });

  $('#exportBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([S.exportJSON()], { type: 'application/json' }));
    a.download = 'pharmacy-inventory.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('#importFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { S.importJSON(await file.text()); renderInventory(); toast('Imported ' + S.medicines.length + ' medicines'); }
    catch (err) { toast('Import failed: ' + err.message); }
    e.target.value = '';
  };
  $('#resetBtn').onclick = () => { if (confirm('Replace all data with the sample inventory?')) { S.reset(); renderInventory(); toast('Sample data restored'); } };

  /* ------------------------------- ALU lab -------------------------------- */
  function renderAlu() {
    const a = +$('#aluA').value & 255, b = +$('#aluB').value & 255;
    table($('#aluTable'), ['S2 S1 S0', 'Operation', 'Micro-operation', 'F (binary)', { t: 'F', num: 1 }, 'C', 'Z', 'N', 'V'],
      C.ALU_OPS.map((o) => {
        const r = C.alu(o.name, a, b, 8);
        return `<tr><td class="mono">${C.bin(o.code, 3).split('').join(' ')}</td><td><b>${o.name}</b> <small class="hint">${o.type}</small></td>
          <td class="mono">${o.expr}</td><td>${bitsHtml(C.bin(r.result, 8))}</td><td class="num">${r.result}</td>
          <td>${r.flags.C}</td><td>${r.flags.Z}</td><td>${r.flags.N}</td><td>${r.flags.V}</td></tr>`;
      }));
  }
  ['#aluA', '#aluB'].forEach((s) => ($(s).oninput = renderAlu));

  function renderDiv() {
    const q = +$('#divQ').value, m = +$('#divM').value;
    if (!(q >= 0 && q <= 255 && m >= 1 && m <= 255)) { $('#divOut').innerHTML = '<p class="err">Use 0 ≤ Q ≤ 255 and 1 ≤ M ≤ 255.</p>'; return; }
    const r = C.divide(q, m, 8, $('#divMethod').value);
    $('#divOut').innerHTML = `<div class="table-wrap short"><table class="compact mono"><thead><tr><th>Step</th><th>Action</th><th>A</th><th>Q</th></tr></thead><tbody>
      ${r.steps.map((s) => `<tr><td>${s.step}</td><td style="font-family:inherit">${s.action}</td><td>${s.A}</td><td>${s.Q}</td></tr>`).join('')}</tbody></table></div>
      <p class="result">Quotient Q = <b>${r.quotient}</b> strips, remainder A = <b>${r.remainder}</b> loose tablets (${q} = ${r.quotient} × ${m} + ${r.remainder}).</p>`;
  }
  ['#divQ', '#divM', '#divMethod'].forEach((s) => ($(s).oninput = renderDiv));

  function renderBooth() {
    const m = +$('#bM').value, q = +$('#bQ').value;
    if (!(Math.abs(m) <= 127 && Math.abs(q) <= 127)) { $('#boothOut').innerHTML = '<p class="err">Use values between −127 and 127.</p>'; return; }
    const r = C.booth(m, q, 8);
    $('#boothOut').innerHTML = `<p class="hint mono">M = ${C.bin(m & 255, 8)} &nbsp; −M = ${C.bin(-m & 255, 8)}</p>
      <div class="table-wrap short"><table class="compact mono"><thead><tr><th>Step</th><th>Q0 Q−1</th><th>Action</th><th>A</th><th>Q</th><th>Q−1</th></tr></thead><tbody>
      ${r.steps.map((s) => `<tr><td>${s.step}</td><td>${s.pair || ''}</td><td style="font-family:inherit">${s.action}</td><td>${s.A}</td><td>${s.Q}</td><td>${s.Q_1}</td></tr>`).join('')}</tbody></table></div>
      <p class="result">Product (A,Q) = <span class="mono">${r.bits}</span> = <b>${r.product}</b></p>`;
  }
  ['#bM', '#bQ'].forEach((s) => ($(s).oninput = renderBooth));

  function renderLogic() {
    const sel = $('#logicMed');
    if (!sel.options.length || sel.options.length !== S.medicines.length) {
      sel.innerHTML = S.medicines.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    }
    if (!$('#logicMask').children.length) {
      $('#logicMask').innerHTML = C.STATUS_BITS.slice().reverse().map((b) =>
        `<label><input type="checkbox" value="${b.bit}" ${b.bit === 2 || b.bit === 3 ? 'checked' : ''}> b${b.bit} ${b.label}</label>`).join('');
    }
    const m = S.find(+sel.value) || S.medicines[0];
    if (!m) { $('#logicOut').innerHTML = '<p class="hint">Add a medicine first.</p>'; return; }
    const reg = S.statusOf(m);
    const mask = $$('#logicMask input:checked').reduce((a, i) => a | (1 << +i.value), 0);
    const op = $('#logicOp').value;
    let res, expr;
    if (op === 'test') { res = reg & mask; expr = 'R ∧ M'; }
    else if (op === 'set') { res = C.logic.set(reg, mask); expr = 'R ∨ M'; }
    else if (op === 'clear') { res = C.logic.clear(reg, mask); expr = "R ∧ M'"; }
    else { res = C.logic.complement(reg, mask); expr = 'R ⊕ M'; }
    $('#logicOut').innerHTML = `<dl class="kv">
      <dt>Status R</dt><dd>${bitsHtml(C.bin(reg, 8))} = ${hex(reg, 2)}</dd>
      <dt>Mask M</dt><dd>${bitsHtml(C.bin(mask, 8))} = ${hex(mask, 2)}</dd>
      ${op === 'clear' ? `<dt>M'</dt><dd>${bitsHtml(C.bin(~mask & 255, 8))}</dd>` : ''}
      <dt>${expr}</dt><dd>${bitsHtml(C.bin(res, 8))} = ${hex(res, 2)}</dd></dl>
      <p class="result">${op === 'test'
        ? (res ? `Z = 0 → <b>${esc(m.name)}</b> matches the mask: ${badges(res)}` : `Z = 1 → <b>${esc(m.name)}</b> has none of the masked conditions.`)
        : `New status: ${badges(res)} <small class="hint">(simulation only — real status is recomputed from stock &amp; expiry)</small>`}</p>`;
  }
  ['#logicMed', '#logicOp', '#logicMask'].forEach((s) => ($(s).onchange = renderLogic));

  const FP_PRESETS = ['12.75', '0.1', '-780', '1.85', '0.000001', '3.4e38', '1e-45', 'Infinity', 'NaN', '-0'];
  $('#fpPresets').innerHTML = FP_PRESETS.map((p) => `<button class="btn sm" data-v="${p}">${p}</button>`).join('');
  $('#fpPresets').onclick = (e) => { const b = e.target.closest('button'); if (b) { $('#fpVal').value = b.dataset.v; renderFp(); } };
  function renderFp() {
    const raw = $('#fpVal').value.trim();
    const x = raw === '-0' ? -0 : Number(raw);
    if (raw === '' || (Number.isNaN(x) && raw.toLowerCase() !== 'nan')) { $('#fpOut').innerHTML = '<p class="err">Enter a number.</p>'; return; }
    const r = C.ieee754(x, $('#fpPrec').value);
    const ebits = r.bits.exponent, fbits = r.bits.fraction;
    $('#fpOut').innerHTML = `<div class="legend"><span><i style="background:var(--s-fill)"></i>Sign</span><span><i style="background:var(--e-fill)"></i>Exponent (${ebits.length} bits, bias ${r.bias})</span><span><i style="background:var(--f-fill)"></i>Fraction (${fbits.length} bits)</span></div>
      ${bitsHtml(r.bits.sign, 's')} ${bitsHtml(ebits, 'e')} ${bitsHtml(fbits, 'f')}
      <dl class="kv"><dt>Hex</dt><dd>${r.hex}</dd><dt>Class</dt><dd>${r.kind}</dd>
      <dt>Value</dt><dd>${r.kind === 'Normalised' ? `(−1)^${r.sign} × 1.${fbits.replace(/0+$/, '') || '0'}₂ × 2^${r.unbiased}` : r.kind === 'Denormalised' ? `(−1)^${r.sign} × 0.f × 2^${r.unbiased}` : r.kind}</dd>
      <dt>Exponent</dt><dd>E = ${r.exponent} → e = E − ${r.bias} = ${r.kind === 'Normalised' ? r.exponent - r.bias : r.unbiased}</dd>
      <dt>Stored value</dt><dd>${Object.is(r.stored, -0) ? '-0' : r.stored}</dd>
      ${r.precision === 'single' && Number.isFinite(x) ? `<dt>Rounding error</dt><dd>${r.error === 0 ? 'exact' : r.error.toExponential(3)}</dd>` : ''}</dl>`;
  }
  ['#fpVal', '#fpPrec'].forEach((s) => ($(s).oninput = renderFp));

  function renderFpArith() {
    const a = Number($('#fpA').value), b = Number($('#fpB').value);
    if (!Number.isFinite(a) || !Number.isFinite(b)) { $('#fpArithOut').innerHTML = '<p class="err">Enter two finite numbers.</p>'; return; }
    const r = C.fpArith(a, b, $('#fpOp').value);
    $('#fpArithOut').innerHTML = `<div class="steps">${r.steps.map((s) => `<div class="step"><b>${s.title}</b><pre>${esc(s.detail)}</pre></div>`).join('')}</div>
      <p class="result">Result = <b>${r.result}</b> ${Object.is(r.result, r.expected) || r.result === r.expected ? '✓ matches the hardware FPU (Math.fround)' : '✗ differs from hardware: ' + r.expected}</p>`;
  }
  ['#fpA', '#fpB', '#fpOp'].forEach((s) => ($(s).oninput = renderFpArith));

  /* ------------------------------- CPU lab -------------------------------- */
  // ISA table and formats
  table($('#isaTable'), ['Op', 'Mnemonic', 'Fmt', 'Type', 'Meaning'],
    C.ISA.map((i) => `<tr><td class="mono">${C.bin(i.op, 4)}</td><td class="mono"><b>${i.mn}</b></td><td>${i.fmt}</td><td>${i.type}</td><td class="mono">${i.desc}</td></tr>`));
  $('#formats').innerHTML = Object.entries(C.FORMATS).map(([, f]) => `<div class="fmt"><div class="t">${f.name}</div><div class="row">
    ${f.fields.map(([n, w]) => `<div style="flex:${w}" title="${w} bits">${n} (${w})</div>`).join('')}</div></div>`).join('') +
    '<p class="hint">Addressing modes used: immediate (LDI), direct (LOAD/STORE), register (ALU ops), base + displacement (LDR) and absolute branch.</p>';

  const cpu = new C.CPU();
  let program = [], lastEv = null, prevRegs = null, log = [], running = null;
  $('#progSel').innerHTML = Object.entries(C.PROGRAMS).map(([k, p]) => `<option value="${k}">${p.title}</option>`).join('');
  function selectProgram() {
    const p = C.PROGRAMS[$('#progSel').value];
    $('#asm').value = p.src;
    $('#progAbout').textContent = p.about;
    assembleLoad();
  }
  $('#progSel').onchange = selectProgram;

  // Memory image of the inventory: N at 0x100, then up to 40 records [qty, reorder, status]
  function fillData(mem) {
    const meds = S.medicines.slice(0, 40);
    for (let a = 0x100; a < 0x200; a++) mem[a] = 0;
    mem[0x100] = meds.length;
    meds.forEach((m, i) => { mem[0x101 + 3 * i] = m.qty & 0xffff; mem[0x102 + 3 * i] = m.reorder & 0xffff; mem[0x103 + 3 * i] = S.statusOf(m); });
    mem[0x1e0] = 30; // units sold, input of the "sale" program
  }
  function assembleLoad() {
    stopRun();
    try {
      program = C.assemble($('#asm').value).program;
      if (program.length > 0xff) throw new Error('Program too large (max 255 words)');
      $('#asmErr').textContent = '';
    } catch (e) { $('#asmErr').textContent = e.message; program = []; }
    cpu.reset();
    cpu.load(program.map((p) => p.word));
    fillData(cpu.mem);
    lastEv = null; log = []; prevRegs = null;
    renderCpu();
    renderPipeline();
  }
  $('#asmBtn').onclick = assembleLoad;

  function snapshot() { return { R: cpu.R.slice(), PC: cpu.PC, IR: cpu.IR, MAR: cpu.MAR, MBR: cpu.MBR, A: cpu.Areg, B: cpu.Breg, Y: cpu.Y }; }
  function doTick() {
    prevRegs = snapshot();
    const ev = cpu.tick();
    if (!ev) return false;
    lastEv = ev;
    log.push(ev);
    if (log.length > 400) log.shift();
    return true;
  }
  $('#tickBtn').onclick = () => { stopRun(); doTick(); renderCpu(); };
  $('#instrBtn').onclick = () => {
    stopRun();
    prevRegs = snapshot();
    const keep = prevRegs;
    do { if (!doTick()) break; } while (cpu.queue.length && !cpu.halted);
    prevRegs = keep;
    renderCpu();
    if (cpu.halted) renderPipeline();
  };
  function stopRun() { if (running) { clearInterval(running); running = null; $('#runBtn').textContent = 'Run ▶'; } }
  $('#runBtn').onclick = () => {
    if (running) { stopRun(); return; }
    if (cpu.halted) assembleLoad();
    $('#runBtn').textContent = 'Pause ❚❚';
    running = setInterval(() => {
      for (let i = 0; i < 12; i++) if (!doTick()) break;
      renderCpu();
      if (cpu.halted || cpu.cycles > 20000) { stopRun(); renderPipeline(); toast(`Halted after ${cpu.instrCount} instructions / ${cpu.cycles} clock cycles`); }
    }, 60);
  };

  function renderCpu() {
    const now = snapshot();
    const ch = (k, i) => prevRegs && (i === undefined ? prevRegs[k] !== now[k] : prevRegs.R[i] !== now.R[i]);
    const reg = (n, v, changed, bits = 4) => `<div class="reg${changed ? ' changed' : ''}"><b>${n}</b>${hex(v, bits)} <small>(${v})</small></div>`;
    $('#regs').innerHTML = [
      reg('PC', cpu.PC, ch('PC'), 3), reg('IR', cpu.IR, ch('IR')), reg('MAR', cpu.MAR, ch('MAR'), 3), reg('MBR', cpu.MBR, ch('MBR')),
      ...cpu.R.map((v, i) => reg('R' + i, v, ch('R', i))),
      reg('A', cpu.Areg, ch('A')), reg('B', cpu.Breg, ch('B')), reg('Y', cpu.Y, ch('Y')),
      `<div class="reg"><b>Flags</b>Z${cpu.F.Z} N${cpu.F.N} C${cpu.F.C} V${cpu.F.V}</div>`,
      `<div class="reg"><b>Clock</b>${cpu.cycles} <small>· ${cpu.instrCount} instr${cpu.halted ? ' · HALT' : ''}</small></div>`,
    ].join('');

    // control-unit view
    const ev = lastEv;
    const mode = $('#ctlSel').value;
    let html = '';
    if (!ev) html = '<p class="hint">Press <b>Clock ▸</b> to execute one T-state (one micro-operation step), or <b>Instruction ▸▸</b> for a full instruction cycle.</p>';
    else {
      const ins = cpu.cur && cpu.cur.mn ? cpu.cur.mn : '—';
      const states = ['T0', 'T1', 'T2', 'T3'].concat(cpu.cur && cpu.cur.mn ? C.EXEC[cpu.cur.mn].map((s) => s.t) : []);
      const head = `<div><b>${ev.phase}</b> sub-cycle · instruction <code>${ins}</code>${cpu.cur && cpu.cur.word !== undefined ? ` <code>${C.disasm(cpu.cur.word)}</code>` : ''}</div>
        <div class="tline">${states.map((t) => `<span class="${t === ev.t ? 'on' : ''}">${t}</span>`).join('')}</div>
        <div>RTL: <code>${ev.rtl}</code>${ev.fired ? '' : ' <span class="badge b-muted">condition false – no transfer</span>'}</div>`;
      if (mode === 'hard') {
        const D = cpu.cur && cpu.cur.dec ? 'D' + cpu.cur.dec.op : null;
        const term = ev.phase === 'Execute' ? `${D}·${ev.t}` : ev.t;
        html = head + `<div style="margin-top:6px">Hardwired: sequence counter → decoder gives <code>${ev.t}</code>${D ? `; opcode decoder asserts <code>${D}</code> (${ins})` : ''}.
          Control logic term <code>${term}${ev.cond && ev.cond !== 'U' ? '·' + ev.cond : ''}</code> enables: ${ev.ops.map((o) => `<code>${o}</code>`).join(', ')}${ev.endOfInstr ? '; then <code>SC ← 0</code>' : ''}.</div>`;
      } else {
        const mi = C.CONTROL_MEMORY[ev.car];
        const v = C.verticalWord(mi);
        html = head + `<div style="margin-top:6px">Microprogrammed: <code>CAR = ${ev.car}</code> → control memory word
          <div class="kv" style="grid-template-columns:max-content 1fr"><dt>Horizontal (${C.MICRO_OPS.length} bits)</dt><dd><code class="word">${C.horizontalWord(mi)}</code></dd>
          <dt>Vertical (${15 + 2 + 2 + 7} bits)</dt><dd><code class="word">F1=${v.F1} F2=${v.F2} F3=${v.F3} CD=${v.CD} BR=${v.BR} AD=${v.AD}</code></dd></div>
          Next: ${mi.br === 'MAP' ? '<code>CAR ← mapping(opcode) = 8·op + 8</code>' : mi.br === 'RET' ? '<code>CAR ← 0</code> (back to fetch)' : `<code>CAR ← ${mi.next}</code>`}</div>`;
      }
    }
    $('#ctlView').innerHTML = `<div class="ctl">${html}</div>`;

    // log
    table($('#uopLog'), ['Clk', 'T', 'Phase', 'Micro-operations'],
      log.slice(-120).reverse().map((e) => `<tr><td>${e.cycle}</td><td>${e.t}</td><td style="font-family:inherit">${e.phase}${e.decoded ? ' → ' + e.decoded : ''}</td><td>${e.rtl}${e.fired ? '' : ' (skipped)'}</td></tr>`));

    // code listing
    table($('#codeTable'), ['Addr', 'Machine code', 'Hex', 'Assembly'],
      program.map((p) => `<tr class="${cpu.cur && p.addr === cpu.cur.pc && !cpu.halted ? 'cur' : ''}"><td>${hex(p.addr, 2)}</td>
        <td>${C.fieldsOf(p.word).map((f) => `<span title="${f.name}">${f.bits}</span>`).join(' ')}</td><td>${hex(p.word)}</td><td>${esc(p.src)}</td></tr>`));

    // memory view
    const n = Math.min(cpu.mem[0x100], 40);
    const rows = [];
    const meds = S.medicines;
    for (let i = 0; i < n; i++) {
      const base = 0x101 + 3 * i;
      rows.push(`<tr class="${cpu.MAR >= base && cpu.MAR < base + 3 ? 'hi' : ''}"><td>${hex(base, 3)}</td><td style="font-family:inherit">${esc(meds[i] ? meds[i].name : '#' + i)}</td>
        <td class="num">${cpu.mem[base]}</td><td class="num">${cpu.mem[base + 1]}</td><td>${C.bin(cpu.mem[base + 2], 8)}</td></tr>`);
    }
    const results = [[0x1f0, 'low-stock count'], [0x1f1, 'total units'], [0x1f2, 'expiry alerts'], [0x1e0, 'units sold (input)']];
    table($('#memTable'), ['Addr', 'Medicine', { t: 'qty', num: 1 }, { t: 'reorder', num: 1 }, 'status'],
      [`<tr><td>0x100</td><td style="font-family:inherit"><b>N (count)</b></td><td class="num">${cpu.mem[0x100]}</td><td></td><td></td></tr>`, ...rows,
        ...results.map(([a, l]) => `<tr class="${cpu.wrote === a ? 'cur' : ''}"><td>${hex(a, 3)}</td><td style="font-family:inherit"><b>${l}</b></td><td class="num">${cpu.mem[a]}</td><td></td><td></td></tr>`)]);
  }
  $('#ctlSel').onchange = renderCpu;

  function renderMicro() {
    $('#microHint').innerHTML = `Control memory of PharmaCPU. <b>Horizontal</b>: one bit per control signal (${C.MICRO_OPS.length} bits) — no decoding, many signals in parallel, but wide.
      <b>Vertical</b>: each field F1/F2/F3 encodes one micro-operation in 5 bits (needs a decoder) plus CD (condition), BR (branch type) and AD (next address) — narrow (26 bits) but slower.`;
    const cm = C.CONTROL_MEMORY.filter(Boolean);
    table($('#cmTable'), ['CAR', 'Routine', 'Microinstruction (RTL)', 'Horizontal word', 'Vertical: F1 F2 F3 CD BR AD'],
      cm.map((m) => {
        const routine = m.addr < 8 ? 'FETCH' : C.ISA[m.addr / 8 - 1 | 0].mn;
        const v = C.verticalWord(m);
        return `<tr><td>${m.addr}</td><td>${routine}</td><td style="font-family:inherit">${m.rtl}</td><td>${C.horizontalWord(m)}</td><td>${v.F1} ${v.F2} ${v.F3} ${v.CD} ${v.BR} ${v.AD}</td></tr>`;
      }));
  }

  function renderPipeline() {
    // run a copy of the program to completion to get the dynamic instruction trace
    if (!program.length) { $('#pipeTable').innerHTML = ''; $('#pipeStats').innerHTML = ''; return; }
    const sim = new C.CPU();
    sim.load(program.map((p) => p.word));
    fillData(sim.mem);
    sim.run(20000);
    const fwd = $('#fwd').checked;
    const all = C.pipeline(sim.trace, { forwarding: fwd });
    const lim = Math.max(4, Math.min(60, +$('#pipeN').value || 16));
    const p = C.pipeline(sim.trace, { forwarding: fwd, limit: lim });
    $('#pipeStats').innerHTML = [
      ['Instructions executed', all.n], ['Non-pipelined cycles (5/instr)', all.nonPipelined], ['Pipelined cycles', all.total],
      ['Stall cycles', all.stalls], ['CPI', all.cpi.toFixed(2)], ['Speed-up', all.speedup.toFixed(2) + '×'],
    ].map(([l, v]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
    const cycles = p.total;
    const head = ['Instruction'].concat(Array.from({ length: cycles }, (_, i) => String(i + 1))).concat(['Hazard']);
    table($('#pipeTable'), head, p.rows.map((r, idx) => {
      const prev = idx === 0 ? 0 : p.rows[idx - 1].start;
      const cells = [];
      for (let c = 1; c <= cycles; c++) {
        const k = c - r.start;
        if (k >= 0 && k < 5) cells.push(`<td class="st-${C.STAGES[k]}">${C.STAGES[k]}</td>`);
        else if (r.stalls && c > prev && c < r.start) cells.push('<td class="st-stall" title="stall / bubble">·</td>');
        else cells.push('<td></td>');
      }
      return `<tr><td>${esc(r.mn)}</td>${cells.join('')}<td style="text-align:left;white-space:nowrap">${r.stalls ? `<span class="badge b-danger">${r.stalls} stall</span> ${esc(r.reason)}` : ''}</td></tr>`;
    }));
  }
  $('#fwd').onchange = renderPipeline;
  $('#pipeN').oninput = renderPipeline;

  /* ----------------------------- RISC vs CISC ----------------------------- */
  function renderRiscCisc() {
    const n = Math.max(1, +$('#rcN').value || 1);
    // CISC: one memory-to-memory instruction SUBM [qty],[sold] — 5 bytes, ~ 8 cycles (2 operand fetches, ALU, write-back, microcoded)
    // RISC: LOAD, LOAD, SUB, STORE — 4 × 2 bytes, pipelined CPI ≈ 1.2
    const cisc = { instr: n, bytes: 5, cpi: 8 }, risc = { instr: 4 * n, bytes: 8, cpi: 1.2 };
    const row = (l, a, b) => `<tr><td>${l}</td><td class="num">${a}</td><td class="num">${b}</td></tr>`;
    $('#riscCisc').innerHTML = `<div class="grid2 tight">
      <div><b>CISC</b><pre class="step mono" style="margin:4px 0">SUBM [qty], [sold]   ; 1 instr,
                     ; memory-to-memory,
                     ; microprogrammed</pre></div>
      <div><b>RISC (PharmaCPU)</b><pre class="step mono" style="margin:4px 0">LOAD  R1, [qty]
LOAD  R2, [sold]
SUB   R1, R1, R2
STORE R1, [qty]</pre></div></div>
      <div class="table-wrap"><table class="compact"><thead><tr><th>For ${n.toLocaleString('en-IN')} sales</th><th class="num">CISC</th><th class="num">RISC</th></tr></thead><tbody>
      ${row('Instructions executed', cisc.instr.toLocaleString('en-IN'), risc.instr.toLocaleString('en-IN'))}
      ${row('Code size per sale (bytes)', cisc.bytes + ' (variable length)', risc.bytes + ' (fixed 16-bit)')}
      ${row('Cycles per instruction', cisc.cpi + ' (multi-cycle)', risc.cpi + ' (pipelined)')}
      ${row('Total clock cycles', (cisc.instr * cisc.cpi).toLocaleString('en-IN'), Math.round(risc.instr * risc.cpi).toLocaleString('en-IN'))}
      ${row('Control unit', 'Microprogrammed', 'Hardwired')}
      ${row('Memory access', 'Any instruction', 'LOAD / STORE only')}
      ${row('Registers', 'Few', 'Many (R0–R7)')}</tbody></table></div>
      <p class="hint">CISC: fewer, more powerful instructions (shorter programs). RISC: simple fixed-format instructions that pipeline well, so total cycles are lower despite more instructions. CPI values are illustrative.</p>`;
  }
  $('#rcN').oninput = renderRiscCisc;

  /* ------------------------------- Flynn ---------------------------------- */
  let flynnTimer = null;
  function flynnRun(simd) {
    clearInterval(flynnTimer);
    const meds = S.medicines;
    const lanes = simd ? +$('#lanes').value : 1;
    $('#flynnGrid').innerHTML = meds.map((m) => `<div class="lane"><div class="n" title="${esc(m.name)}">${esc(m.name)}</div><div>${m.expiry}</div></div>`).join('');
    const cells = $$('#flynnGrid .lane');
    let i = 0, steps = 0;
    $('#flynnStat').textContent = '';
    flynnTimer = setInterval(() => {
      cells.forEach((c) => c.classList.remove('active'));
      if (i >= meds.length) {
        clearInterval(flynnTimer);
        const bad = meds.filter((m) => S.statusOf(m) & 0b1100).length;
        $('#flynnStat').innerHTML = `<b>${simd ? 'SIMD' : 'SISD'}</b>: ${meds.length} medicines checked in <b>${steps}</b> instruction step(s) (${lanes} lane${lanes > 1 ? 's' : ''}); ${bad} expired / expiring. Ideal SIMD speed-up = ${lanes}×.`;
        return;
      }
      // one instruction: compare `lanes` expiry dates with today in parallel
      for (let k = 0; k < lanes && i < meds.length; k++, i++) {
        const bad = S.statusOf(meds[i]) & 0b1100;
        cells[i].classList.add('active', bad ? 'bad' : 'good');
      }
      steps++;
    }, 380);
  }
  $('#sisdBtn').onclick = () => flynnRun(false);
  $('#simdBtn').onclick = () => flynnRun(true);
  table($('#flynnTable'), ['Class', 'Streams', 'Pharmacy example'], [
    ['SISD', '1 instruction, 1 data', 'One CPU core checks one medicine expiry at a time (PharmaCPU).'],
    ['SIMD', '1 instruction, many data', 'Vector compare of many expiry dates at once (above).'],
    ['MISD', 'many instructions, 1 data', 'Redundant checks of the same prescription record (fault tolerance).'],
    ['MIMD', 'many instructions, many data', 'Multi-core server: billing, stock updates and reports running in parallel.'],
  ].map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td></tr>`));

  /* ------------------------------ Progress -------------------------------- */
  const SYL = [
    ['Unit 1', 'Functional units, buses, register/bus/memory transfer, general registers, addressing modes', 'Month 1 study; applied in PharmaCPU (registers, MAR/MBR, addressing modes)', 'done'],
    ['Unit 2', 'Signed multiplication, Booth\'s algorithm', 'Month 1 study; Booth simulator in ALU Lab', 'done'],
    ['Unit 2', 'Division (restoring / non-restoring) and logic operations', 'Strips ÷ pack size; status-register masks & filters', 'done'],
    ['Unit 2', 'Floating point arithmetic, ALU design, IEEE 754', '8-bit ALU with flags; price encoding; FP add/sub/mul/div steps', 'done'],
    ['Unit 3', 'Instruction types, formats, instruction cycle & sub-cycles, micro-operations', 'PharmaCPU ISA, assembler, clock-by-clock fetch/decode/execute', 'done'],
    ['Unit 3', 'Program control, RISC, CISC', 'Branch instructions (JMP/JZ/JN/JNZ), RISC vs CISC comparison', 'done'],
    ['Unit 3', 'Pipelining', '5-stage timing diagram with hazards, forwarding and speed-up', 'done'],
    ['Unit 3', 'Hardwired & microprogrammed control, horizontal / vertical microcode', 'Switchable control view, control memory listing', 'done'],
    ['Unit 3', "Flynn's classification", 'SISD vs SIMD expiry scan', 'done'],
    ['Unit 4', 'Parallel architectures, cache, coherence protocols', 'Planned for final review', 'next'],
    ['Unit 5', 'Scalable shared memory, consistency, synchronization, interconnects', 'Planned for final review', 'next'],
  ];
  table($('#syllabus'), ['Unit', 'Syllabus topic', 'Where it is applied', 'Status'],
    SYL.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3] === 'done' ? '<span class="badge b-ok">Implemented</span>' : '<span class="badge b-muted">Final review</span>'}</td></tr>`));

  /* -------------------------------- init ---------------------------------- */
  renderAlu(); renderDiv(); renderBooth(); renderLogic(); renderFp(); renderFpArith();
  renderMicro(); renderRiscCisc();
  selectProgram();
  let start = 'dashboard';
  try { start = localStorage.getItem('capp-tab') || start; } catch (e) { /* */ }
  if (location.hash && $('#tab-' + location.hash.slice(1))) start = location.hash.slice(1);
  showTab($('#tab-' + start) ? start : 'dashboard');
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if ($('#tab-' + t)) showTab(t); });
})();
