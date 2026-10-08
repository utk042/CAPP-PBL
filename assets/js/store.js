/*
 * store.js — Pharmacy inventory data (medicines, transactions) kept in
 * localStorage, plus the 8-bit status register computed for every medicine.
 */
(function (root) {
  'use strict';
  const CAPP = (root.CAPP = root.CAPP || {});
  const KEY = 'capp-pharmacy-v1';
  const DAY = 86400000;

  const iso = (d) => new Date(d).toISOString().slice(0, 10);
  const fromToday = (days) => iso(Date.now() + days * DAY);

  function sample() {
    const rows = [
      ['Paracetamol 500mg', 'Analgesic', 'PCM-2411', 240, 10, 100, 1.85, 420, 'Cipla Ltd', false, false],
      ['Amoxicillin 250mg', 'Antibiotic', 'AMX-1907', 36, 10, 60, 6.4, 60, 'Sun Pharma', true, false],
      ['Insulin Glargine 100IU', 'Antidiabetic', 'INS-0832', 12, 1, 10, 780.0, 45, 'Biocon', true, true],
      ['Cetirizine 10mg', 'Antihistamine', 'CTZ-5521', 150, 10, 50, 0.95, 25, 'Dr. Reddy\'s', false, false],
      ['Metformin 500mg', 'Antidiabetic', 'MTF-3310', 18, 15, 90, 1.2, 300, 'Mankind', true, false],
      ['ORS Sachet', 'Electrolyte', 'ORS-0045', 0, 1, 40, 21.0, 200, 'Cipla Ltd', false, false],
      ['Azithromycin 500mg', 'Antibiotic', 'AZI-7781', 45, 3, 30, 24.5, -12, 'Alkem Labs', true, false],
      ['Hepatitis B Vaccine', 'Vaccine', 'HBV-1102', 25, 1, 15, 310.0, 160, 'Serum Institute', true, true],
      ['Pantoprazole 40mg', 'Antacid', 'PAN-6619', 95, 15, 45, 3.1, 75, 'Alkem Labs', true, false],
      ['Vitamin D3 60K', 'Supplement', 'VD3-2290', 64, 4, 20, 32.0, 540, 'Mankind', false, false],
    ];
    return rows.map((r, i) => ({
      id: i + 1, name: r[0], category: r[1], batch: r[2], qty: r[3], packSize: r[4], reorder: r[5],
      price: r[6], expiry: fromToday(r[7]), supplier: r[8], rx: r[9], cold: r[10],
    }));
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* storage unavailable – fall back to sample data */ }
    return { medicines: sample(), tx: [], nextId: 11 };
  }
  let state = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }

  function daysToExpiry(m, now = Date.now()) { return Math.floor((new Date(m.expiry).getTime() - now) / DAY); }

  /** 8-bit status register (see CAPP.STATUS_BITS): built with OR (selective set). */
  function statusOf(m) {
    const L = CAPP.logic;
    let reg = 0;
    const d = daysToExpiry(m);
    if (m.qty === 0) reg = L.set(reg, 1 << 1);
    else if (m.qty <= m.reorder) reg = L.set(reg, 1 << 0);
    if (d < 0) reg = L.set(reg, 1 << 3);
    else if (d <= 90) reg = L.set(reg, 1 << 2);
    if (m.rx) reg = L.set(reg, 1 << 4);
    if (m.cold) reg = L.set(reg, 1 << 5);
    if (m.qty * m.price >= 5000) reg = L.set(reg, 1 << 6);
    return reg;
  }

  CAPP.store = {
    get medicines() { return state.medicines; },
    get tx() { return state.tx; },
    statusOf, daysToExpiry,
    find: (id) => state.medicines.find((m) => m.id === id),
    upsert(m) {
      if (m.id) Object.assign(this.find(m.id), m);
      else state.medicines.push({ ...m, id: state.nextId++ });
      save();
    },
    remove(id) { state.medicines = state.medicines.filter((m) => m.id !== id); save(); },
    /** Stock movement through the ALU: sale = SUB, purchase = ADD (16-bit). */
    move(id, kind, units) {
      const m = this.find(id);
      const op = kind === 'sale' ? 'SUB' : 'ADD';
      const r = CAPP.alu(op, m.qty, units, 16);
      if (kind === 'sale' && r.flags.C === 0) return { ok: false, reason: `Insufficient stock: SUB ${m.qty}, ${units} produced a borrow (C = 0, N = ${r.flags.N}).`, alu: r };
      if (kind === 'purchase' && r.flags.C === 1) return { ok: false, reason: 'Stock register overflow (C = 1).', alu: r };
      const before = m.qty;
      m.qty = r.result;
      const t = { at: new Date().toISOString(), id, name: m.name, kind, units, before, after: m.qty, op, flags: r.flags };
      state.tx.unshift(t);
      state.tx = state.tx.slice(0, 200);
      save();
      return { ok: true, tx: t, alu: r };
    },
    reset() { state = { medicines: sample(), tx: [], nextId: 11 }; save(); },
    exportJSON() { return JSON.stringify(state, null, 2); },
    importJSON(text) {
      const s = JSON.parse(text);
      if (!Array.isArray(s.medicines)) throw new Error('Invalid file: missing medicines array');
      state = { medicines: s.medicines, tx: s.tx || [], nextId: Math.max(0, ...s.medicines.map((m) => m.id)) + 1 };
      save();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
