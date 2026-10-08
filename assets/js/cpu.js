/*
 * cpu.js — Unit 3 (Control Unit) of CAPP applied to the
 * Pharmacy Inventory Computing System.
 *
 *  PharmaCPU: 16-bit words, 8 general registers R0–R7, 512-word memory.
 *  - Instruction types & formats (R / I / M / X / B)
 *  - Two-pass assembler → machine code
 *  - Instruction cycle: fetch, decode, execute sub-cycles as micro-operations (RTL)
 *  - Hardwired control (sequence counter T0…Tn + opcode decoder D0…D15)
 *  - Microprogrammed control (control memory, CAR, horizontal & vertical microcode)
 *  - 5-stage pipeline timing with data / control hazards
 */
(function (root) {
  'use strict';
  const CAPP = (root.CAPP = root.CAPP || {});
  const bin = CAPP.bin || ((v, n) => (v >>> 0).toString(2).padStart(n, '0').slice(-n));
  const W = 0xffff;

  /* ---------------------------- ISA ----------------------------------- */
  // fmt: R = op rd rs rt | I = op rd imm9 | M = op rd addr9 | X = op rd rs off6 | B = op addr12 | N = op
  const ISA = [
    { op: 0x0, mn: 'HLT', fmt: 'N', type: 'Program control', desc: 'Stop the processor' },
    { op: 0x1, mn: 'LDI', fmt: 'I', type: 'Data transfer', desc: 'Rd ← imm9 (immediate)' },
    { op: 0x2, mn: 'LOAD', fmt: 'M', type: 'Data transfer', desc: 'Rd ← M[addr] (direct)' },
    { op: 0x3, mn: 'STORE', fmt: 'M', type: 'Data transfer', desc: 'M[addr] ← Rd (direct)' },
    { op: 0x4, mn: 'LDR', fmt: 'X', type: 'Data transfer', desc: 'Rd ← M[Rs + off6] (base + displacement)' },
    { op: 0x5, mn: 'ADD', fmt: 'R', type: 'Arithmetic', desc: 'Rd ← Rs + Rt' },
    { op: 0x6, mn: 'SUB', fmt: 'R', type: 'Arithmetic', desc: 'Rd ← Rs − Rt' },
    { op: 0x7, mn: 'AND', fmt: 'R', type: 'Logical', desc: 'Rd ← Rs ∧ Rt' },
    { op: 0x8, mn: 'OR', fmt: 'R', type: 'Logical', desc: 'Rd ← Rs ∨ Rt' },
    { op: 0x9, mn: 'XOR', fmt: 'R', type: 'Logical', desc: 'Rd ← Rs ⊕ Rt' },
    { op: 0xa, mn: 'ADDI', fmt: 'I', type: 'Arithmetic', desc: 'Rd ← Rd + sext(imm9)' },
    { op: 0xb, mn: 'NOT', fmt: 'R', type: 'Logical', desc: "Rd ← Rs'" },
    { op: 0xc, mn: 'JMP', fmt: 'B', type: 'Program control', desc: 'PC ← addr (unconditional)' },
    { op: 0xd, mn: 'JZ', fmt: 'B', type: 'Program control', desc: 'if Z = 1: PC ← addr' },
    { op: 0xe, mn: 'JN', fmt: 'B', type: 'Program control', desc: 'if N = 1: PC ← addr' },
    { op: 0xf, mn: 'JNZ', fmt: 'B', type: 'Program control', desc: 'if Z = 0: PC ← addr' },
  ];
  const BY_MN = Object.fromEntries(ISA.map((i) => [i.mn, i]));
  const FORMATS = {
    R: { name: 'Register (R-type)', fields: [['opcode', 4], ['Rd', 3], ['Rs', 3], ['Rt', 3], ['unused', 3]] },
    I: { name: 'Immediate (I-type)', fields: [['opcode', 4], ['Rd', 3], ['imm9', 9]] },
    M: { name: 'Memory/direct (M-type)', fields: [['opcode', 4], ['Rd', 3], ['addr9', 9]] },
    X: { name: 'Displacement (X-type)', fields: [['opcode', 4], ['Rd', 3], ['Rs', 3], ['off6', 6]] },
    B: { name: 'Branch (B-type)', fields: [['opcode', 4], ['addr12', 12]] },
    N: { name: 'No operand (N-type)', fields: [['opcode', 4], ['unused', 12]] },
  };

  function encode(mn, a = {}) {
    const ins = BY_MN[mn];
    const op = ins.op << 12;
    switch (ins.fmt) {
      case 'R': return op | (a.rd << 9) | (a.rs << 6) | ((a.rt || 0) << 3);
      case 'I': return op | (a.rd << 9) | (a.imm & 0x1ff);
      case 'M': return op | (a.rd << 9) | (a.addr & 0x1ff);
      case 'X': return op | (a.rd << 9) | (a.rs << 6) | (a.off & 0x3f);
      case 'B': return op | (a.addr & 0xfff);
      default: return op;
    }
  }
  function decode(word) {
    const ins = ISA[(word >>> 12) & 0xf];
    const d = { ins, mn: ins.mn, fmt: ins.fmt, op: ins.op };
    d.rd = (word >>> 9) & 7;
    d.rs = (word >>> 6) & 7;
    d.rt = (word >>> 3) & 7;
    d.imm = word & 0x1ff;
    d.simm = d.imm & 0x100 ? d.imm - 0x200 : d.imm;
    d.addr9 = word & 0x1ff;
    d.off = word & 0x3f;
    d.addr12 = word & 0xfff;
    return d;
  }
  function fieldsOf(word) {
    const d = decode(word);
    let pos = 16;
    return FORMATS[d.fmt].fields.map(([name, w]) => {
      pos -= w;
      return { name, width: w, bits: bin((word >>> pos) & ((1 << w) - 1), w) };
    });
  }
  function disasm(word) {
    const d = decode(word);
    switch (d.fmt) {
      case 'R': return d.mn === 'NOT' ? `NOT R${d.rd}, R${d.rs}` : `${d.mn} R${d.rd}, R${d.rs}, R${d.rt}`;
      case 'I': return `${d.mn} R${d.rd}, ${d.mn === 'ADDI' ? d.simm : d.imm}`;
      case 'M': return `${d.mn} R${d.rd}, [0x${d.addr9.toString(16).toUpperCase()}]`;
      case 'X': return `${d.mn} R${d.rd}, [R${d.rs}+${d.off}]`;
      case 'B': return `${d.mn} 0x${d.addr12.toString(16).toUpperCase().padStart(2, '0')}`;
      default: return d.mn;
    }
  }

  /* --------------------------- Assembler ------------------------------ */
  function assemble(src, symbols = {}) {
    const lines = src.split('\n');
    const labels = { ...symbols };
    const items = [];
    let pc = 0;
    lines.forEach((raw, li) => {
      let line = raw.replace(/;.*$/, '').trim();
      if (!line) return;
      const m = line.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
      if (m) { labels[m[1].toUpperCase()] = pc; line = m[2].trim(); if (!line) return; }
      items.push({ line, li, pc });
      pc++;
    });
    const num = (t, li) => {
      t = t.trim().toUpperCase();
      if (t in labels) return labels[t];
      const v = /^-?0X[0-9A-F]+$/.test(t) ? parseInt(t, 16) : /^-?\d+$/.test(t) ? parseInt(t, 10) : NaN;
      if (Number.isNaN(v)) throw new Error(`Line ${li + 1}: unknown value or label "${t}"`);
      return v;
    };
    const reg = (t, li) => {
      const m = t.trim().toUpperCase().match(/^R([0-7])$/);
      if (!m) throw new Error(`Line ${li + 1}: expected register R0–R7, got "${t.trim()}"`);
      return +m[1];
    };
    const program = items.map(({ line, li, pc }) => {
      const [mnRaw, ...rest] = line.split(/\s+/);
      const mn = mnRaw.toUpperCase();
      const ins = BY_MN[mn];
      if (!ins) throw new Error(`Line ${li + 1}: unknown instruction "${mnRaw}"`);
      const ops = rest.join(' ').split(',').map((s) => s.trim()).filter(Boolean);
      let word;
      switch (ins.fmt) {
        case 'R':
          word = mn === 'NOT' ? encode(mn, { rd: reg(ops[0], li), rs: reg(ops[1], li) })
            : encode(mn, { rd: reg(ops[0], li), rs: reg(ops[1], li), rt: reg(ops[2], li) });
          break;
        case 'I': word = encode(mn, { rd: reg(ops[0], li), imm: num(ops[1], li) }); break;
        case 'M': word = encode(mn, { rd: reg(ops[0], li), addr: num(ops[1].replace(/[[\]]/g, ''), li) }); break;
        case 'X': {
          const mm = ops[1] && ops[1].match(/^\[\s*(R[0-7])\s*(?:\+\s*(\w+))?\s*\]$/i);
          if (!mm) throw new Error(`Line ${li + 1}: expected [Rs+off]`);
          word = encode(mn, { rd: reg(ops[0], li), rs: reg(mm[1], li), off: mm[2] ? num(mm[2], li) : 0 });
          break;
        }
        case 'B': word = encode(mn, { addr: num(ops[0], li) }); break;
        default: word = encode(mn);
      }
      return { addr: pc, word, src: line, line: li };
    });
    return { program, labels };
  }

  /* ---------------- Micro-operations (control signals) ---------------- */
  // Each micro-operation is one control signal / one bit in a horizontal microinstruction.
  const MICRO_OPS = [
    ['MAR←PC', (c) => { c.MAR = c.PC; }],
    ['MBR←M[MAR]', (c) => { c.MBR = c.mem[c.MAR & 0x1ff]; }],
    ['PC←PC+1', (c) => { c.PC = (c.PC + 1) & 0xfff; }],
    ['IR←MBR', (c) => { c.IR = c.MBR; }],
    ['DECODE', (c) => { c.dec = decode(c.IR); }],
    ['MAR←IR(addr)', (c) => { c.MAR = c.dec.addr9; }],
    ['MAR←Rs+off', (c) => { c.MAR = (c.R[c.dec.rs] + c.dec.off) & 0x1ff; }],
    ['Rd←MBR', (c) => { c.R[c.dec.rd] = c.MBR; }],
    ['MBR←Rd', (c) => { c.MBR = c.R[c.dec.rd]; }],
    ['M[MAR]←MBR', (c) => { c.mem[c.MAR & 0x1ff] = c.MBR; c.wrote = c.MAR & 0x1ff; }],
    ['Rd←IR(imm)', (c) => { c.R[c.dec.rd] = c.dec.imm; }],
    ['A←Rs', (c) => { c.Areg = c.R[c.dec.rs]; }],
    ['A←Rd', (c) => { c.Areg = c.R[c.dec.rd]; }],
    ['B←Rt', (c) => { c.Breg = c.R[c.dec.rt]; }],
    ['B←sext(imm)', (c) => { c.Breg = c.dec.simm & W; }],
    ['ALU:ADD', (c) => aluOp(c, 'ADD')],
    ['ALU:SUB', (c) => aluOp(c, 'SUB')],
    ['ALU:AND', (c) => aluOp(c, 'AND')],
    ['ALU:OR', (c) => aluOp(c, 'OR')],
    ['ALU:XOR', (c) => aluOp(c, 'XOR')],
    ['ALU:NOT', (c) => aluOp(c, 'NOT')],
    ['Rd←ALU', (c) => { c.R[c.dec.rd] = c.Y; }],
    ['PC←IR(addr)', (c) => { c.PC = c.dec.addr12; c.branchTaken = true; }],
    ['HALT', (c) => { c.halted = true; }],
  ];
  const MICRO_INDEX = Object.fromEntries(MICRO_OPS.map(([n], i) => [n, i]));
  const MICRO_FN = Object.fromEntries(MICRO_OPS);

  function aluOp(c, op) {
    const r = CAPP.alu(op, c.Areg, c.Breg, 16);
    c.Y = r.result;
    c.F = { Z: r.flags.Z, N: r.flags.N, C: r.flags.C, V: r.flags.V };
  }

  // Branch conditions evaluated by the control unit (CD field in microcode)
  const COND = { U: () => true, Z: (c) => c.F.Z === 1, N: (c) => c.F.N === 1, NZ: (c) => c.F.Z === 0 };

  const FETCH = [
    { t: 'T0', rtl: 'MAR ← PC', ops: ['MAR←PC'], phase: 'Fetch' },
    { t: 'T1', rtl: 'MBR ← M[MAR], PC ← PC + 1', ops: ['MBR←M[MAR]', 'PC←PC+1'], phase: 'Fetch' },
    { t: 'T2', rtl: 'IR ← MBR', ops: ['IR←MBR'], phase: 'Fetch' },
    { t: 'T3', rtl: 'Decode IR(15–12) → D0…D15', ops: ['DECODE'], phase: 'Decode' },
  ];
  const aluR = (op, sym) => [
    { rtl: 'A ← Rs, B ← Rt', ops: ['A←Rs', 'B←Rt'] },
    { rtl: `Y ← A ${sym} B, update Z N C V`, ops: [`ALU:${op}`] },
    { rtl: 'Rd ← Y', ops: ['Rd←ALU'] },
  ];
  const branch = (cond, label) => [{ rtl: cond === 'U' ? 'PC ← IR(11–0)' : `if (${label}) PC ← IR(11–0)`, ops: ['PC←IR(addr)'], cond }];
  const EXEC = {
    HLT: [{ rtl: 'S ← 0 (halt)', ops: ['HALT'] }],
    LDI: [{ rtl: 'Rd ← IR(8–0)', ops: ['Rd←IR(imm)'] }],
    LOAD: [
      { rtl: 'MAR ← IR(8–0)', ops: ['MAR←IR(addr)'] },
      { rtl: 'MBR ← M[MAR]', ops: ['MBR←M[MAR]'] },
      { rtl: 'Rd ← MBR', ops: ['Rd←MBR'] },
    ],
    STORE: [
      { rtl: 'MAR ← IR(8–0)', ops: ['MAR←IR(addr)'] },
      { rtl: 'MBR ← Rd', ops: ['MBR←Rd'] },
      { rtl: 'M[MAR] ← MBR', ops: ['M[MAR]←MBR'] },
    ],
    LDR: [
      { rtl: 'MAR ← Rs + off6 (effective address)', ops: ['MAR←Rs+off'] },
      { rtl: 'MBR ← M[MAR]', ops: ['MBR←M[MAR]'] },
      { rtl: 'Rd ← MBR', ops: ['Rd←MBR'] },
    ],
    ADD: aluR('ADD', '+'),
    SUB: aluR('SUB', '−'),
    AND: aluR('AND', '∧'),
    OR: aluR('OR', '∨'),
    XOR: aluR('XOR', '⊕'),
    NOT: [{ rtl: 'A ← Rs', ops: ['A←Rs'] }, { rtl: "Y ← A', update Z N", ops: ['ALU:NOT'] }, { rtl: 'Rd ← Y', ops: ['Rd←ALU'] }],
    ADDI: [
      { rtl: 'A ← Rd, B ← sext(IR(8–0))', ops: ['A←Rd', 'B←sext(imm)'] },
      { rtl: 'Y ← A + B, update Z N C V', ops: ['ALU:ADD'] },
      { rtl: 'Rd ← Y', ops: ['Rd←ALU'] },
    ],
    JMP: branch('U'),
    JZ: branch('Z', 'Z = 1'),
    JN: branch('N', 'N = 1'),
    JNZ: branch('NZ', 'Z = 0'),
  };
  // number the execute T-states (T4, T5, …) and append SC ← 0
  for (const k of Object.keys(EXEC)) EXEC[k] = EXEC[k].map((s, i) => ({ ...s, t: 'T' + (4 + i), phase: 'Execute' }));

  /* ---------------- Microprogrammed control: control memory ---------- */
  // Control memory layout: FETCH routine at 0–3, each opcode's routine at 8·(op+1).
  // Mapping logic: CAR ← 0 IR(15–12) 000 + 8  (i.e. 8·opcode + 8)
  const VERT_BITS = 5; // each encoded micro-op field (F1/F2/F3) is 5 bits → 32 codes
  function buildControlMemory() {
    const cm = [];
    const push = (addr, step, br, next) => { cm[addr] = { addr, ...step, br, next }; };
    FETCH.forEach((s, i) => push(i, s, i === 3 ? 'MAP' : 'JMP', i === 3 ? null : i + 1));
    for (const ins of ISA) {
      const base = 8 * (ins.op + 1);
      const r = EXEC[ins.mn];
      r.forEach((s, i) => {
        const last = i === r.length - 1;
        push(base + i, s, last ? 'RET' : 'JMP', last ? 0 : base + i + 1);
      });
    }
    return cm;
  }
  const CONTROL_MEMORY = buildControlMemory();
  const BR_CODES = { JMP: '00', CALL: '01', RET: '10', MAP: '11' };
  const CD_CODES = { U: '00', Z: '01', N: '10', NZ: '11' };
  function horizontalWord(step) {
    // one bit per micro-op (control signal) – no decoding, maximum parallelism
    return MICRO_OPS.map(([n]) => (step.ops.includes(n) ? '1' : '0')).join('');
  }
  function verticalWord(step) {
    // up to three encoded micro-op fields + CD + BR + 7-bit next address
    const f = [0, 1, 2].map((i) => (step.ops[i] ? bin(MICRO_INDEX[step.ops[i]] + 1, VERT_BITS) : '0'.repeat(VERT_BITS)));
    return { F1: f[0], F2: f[1], F3: f[2], CD: CD_CODES[step.cond || 'U'], BR: BR_CODES[step.br || 'JMP'], AD: bin(step.next || 0, 7) };
  }

  /* ------------------------------ CPU --------------------------------- */
  class CPU {
    constructor(memSize = 512) { this.memSize = memSize; this.reset(); }
    reset() {
      this.mem = new Array(this.memSize).fill(0);
      this.R = new Array(8).fill(0);
      this.PC = 0; this.IR = 0; this.MAR = 0; this.MBR = 0;
      this.Areg = 0; this.Breg = 0; this.Y = 0;
      this.F = { Z: 0, N: 0, C: 0, V: 0 };
      this.halted = false; this.dec = null;
      this.queue = []; // remaining micro-steps of the current instruction
      this.cycles = 0; this.instrCount = 0; this.trace = [];
      this.car = 0; this.cur = null;
    }
    load(words, at = 0) { words.forEach((w, i) => { this.mem[at + i] = w & W; }); }
    /** Execute exactly one clock (one T-state / one microinstruction). */
    tick() {
      if (this.halted) return null;
      if (!this.queue.length) {
        this.cur = { pc: this.PC };
        this.queue = FETCH.map((s, i) => ({ ...s, car: i }));
      }
      const step = this.queue.shift();
      this.wrote = undefined; this.branchTaken = false;
      const fired = step.cond ? COND[step.cond](this) : true;
      if (fired) step.ops.forEach((o) => MICRO_FN[o](this));
      this.cycles++;
      const ev = { ...step, fired, car: step.car, cycle: this.cycles };
      if (step.ops.includes('DECODE')) {
        const mn = this.dec.mn;
        const base = 8 * (this.dec.op + 1);
        this.queue = EXEC[mn].map((s, i) => ({ ...s, car: base + i }));
        this.cur.word = this.IR; this.cur.mn = mn; this.cur.dec = this.dec;
        ev.decoded = mn; ev.D = 'D' + this.dec.op;
      }
      if (!this.queue.length) {
        this.instrCount++;
        this.trace.push({ pc: this.cur.pc, word: this.cur.word, mn: this.cur.mn, dec: this.cur.dec, taken: this.branchTaken });
        ev.endOfInstr = true;
      }
      ev.wrote = this.wrote;
      return ev;
    }
    /** Run a full instruction (all its T-states). */
    stepInstruction() {
      const evs = [];
      do { const e = this.tick(); if (!e) break; evs.push(e); } while (this.queue.length && !this.halted);
      return evs;
    }
    run(maxCycles = 20000) {
      while (!this.halted && this.cycles < maxCycles) this.tick();
      return this;
    }
  }

  /* --------------------------- Pipeline ------------------------------- */
  // Classic 5-stage RISC pipeline: IF ID EX MEM WB. Writes in first half of WB,
  // reads in second half of ID. Branches resolve in EX (predict not-taken).
  const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'];
  function regsOf(d) {
    const r = { reads: [], write: null, load: false };
    switch (d.fmt) {
      case 'R': r.reads = d.mn === 'NOT' ? [d.rs] : [d.rs, d.rt]; r.write = d.rd; break;
      case 'I': r.reads = d.mn === 'ADDI' ? [d.rd] : []; r.write = d.rd; break;
      case 'M': if (d.mn === 'LOAD') { r.write = d.rd; r.load = true; } else r.reads = [d.rd]; break;
      case 'X': r.reads = [d.rs]; r.write = d.rd; r.load = true; break;
      default: break;
    }
    return r;
  }
  function pipeline(trace, { forwarding = true, limit = Infinity } = {}) {
    const rows = [];
    const list = trace.slice(0, limit);
    let prevStart = 0;
    list.forEach((t, i) => {
      const info = regsOf(t.dec);
      let start = i === 0 ? 1 : prevStart + 1;
      let reason = '';
      // data hazards with the previous two instructions
      for (let d = 1; d <= 2 && i - d >= 0; d++) {
        const p = rows[i - d];
        if (p.info.write === null || !info.reads.includes(p.info.write)) continue;
        const k = !forwarding ? 3 : p.info.load ? 2 : 1;
        if (p.start + k > start) { start = p.start + k; reason = `RAW on R${p.info.write} (from ${p.mn})`; }
      }
      // control hazard: taken branch flushes the two wrongly fetched instructions
      if (i > 0 && rows[i - 1].taken && rows[i - 1].start + 3 > start) {
        start = rows[i - 1].start + 3; reason = 'Branch taken → flush 2';
      }
      rows.push({ i, mn: disasm(t.word), start, stalls: start - (i === 0 ? 1 : prevStart + 1), reason, info, taken: t.taken && t.dec.fmt === 'B' });
      prevStart = start;
    });
    const n = rows.length;
    const total = n ? rows[n - 1].start + 4 : 0;
    const stalls = rows.reduce((s, r) => s + r.stalls, 0);
    return { rows, total, stalls, n, nonPipelined: n * 5, ideal: n ? n + 4 : 0, cpi: n ? total / n : 0, speedup: total ? (n * 5) / total : 0 };
  }

  /* -------------------- Inventory programs (assembly) ------------------ */
  // Memory map for inventory data: 0x100 = item count N, records from 0x101,
  // 3 words each: [qty, reorderLevel, statusFlags]. Results stored at 0x1F0+.
  const PROGRAMS = {
    lowstock: {
      title: 'Count low-stock medicines',
      about: 'For each medicine compute qty − reorderLevel; a negative result (N flag) means it must be reordered. Count → M[0x1F0].',
      src: `; Count medicines whose quantity is below the reorder level
        LDI   R1, 0x101     ; R1 = pointer to first record
        LOAD  R2, [0x100]   ; R2 = N (number of medicines)
        LDI   R3, 0         ; R3 = low-stock counter
loop:   LDR   R4, [R1+0]    ; R4 = qty
        LDR   R5, [R1+1]    ; R5 = reorder level
        SUB   R6, R4, R5    ; R6 = qty - reorder  (sets N)
        JN    low           ; negative -> low stock
        JMP   next
low:    ADDI  R3, 1         ; counter++
next:   ADDI  R1, 3         ; advance to next record
        ADDI  R2, -1        ; N--   (sets Z)
        JNZ   loop
        STORE R3, [0x1F0]   ; result
        HLT`,
    },
    total: {
      title: 'Total units in stock',
      about: 'Loop over every record and accumulate the quantity field (ADD). Total → M[0x1F1].',
      src: `; Sum the quantity of every medicine
        LDI   R1, 0x101
        LOAD  R2, [0x100]
        LDI   R3, 0         ; running total
loop:   LDR   R4, [R1+0]    ; qty
        ADD   R3, R3, R4
        ADDI  R1, 3
        ADDI  R2, -1
        JNZ   loop
        STORE R3, [0x1F1]
        HLT`,
    },
    flags: {
      title: 'Expiry alert scan (logic AND mask)',
      about: 'AND each status register with mask 0b00001100 (NEAR | EXPIRED). Non-zero → alert. Count → M[0x1F2].',
      src: `; Count medicines that are expired or expiring soon
        LDI   R1, 0x101
        LOAD  R2, [0x100]
        LDI   R3, 0
        LDI   R7, 12        ; mask 0000 1100 = NEAR | EXP
loop:   LDR   R4, [R1+2]    ; status flags
        AND   R5, R4, R7    ; mask test (sets Z)
        JZ    skip
        ADDI  R3, 1
skip:   ADDI  R1, 3
        ADDI  R2, -1
        JNZ   loop
        STORE R3, [0x1F2]
        HLT`,
    },
    sale: {
      title: 'Record a sale (update stock)',
      about: 'qty ← qty − sold for record 0, then store back: a load/compute/store (RISC) sequence.',
      src: `; Update stock of the first medicine after selling M[0x1E0] units
        LOAD  R1, [0x101]   ; qty of record 0
        LOAD  R2, [0x1E0]   ; units sold
        SUB   R1, R1, R2
        STORE R1, [0x101]   ; write back
        HLT`,
    },
  };

  CAPP.ISA = ISA;
  CAPP.FORMATS = FORMATS;
  CAPP.encode = encode;
  CAPP.decode = decode;
  CAPP.fieldsOf = fieldsOf;
  CAPP.disasm = disasm;
  CAPP.assemble = assemble;
  CAPP.MICRO_OPS = MICRO_OPS.map(([n]) => n);
  CAPP.FETCH = FETCH;
  CAPP.EXEC = EXEC;
  CAPP.CONTROL_MEMORY = CONTROL_MEMORY;
  CAPP.horizontalWord = horizontalWord;
  CAPP.verticalWord = verticalWord;
  CAPP.CPU = CPU;
  CAPP.STAGES = STAGES;
  CAPP.pipeline = pipeline;
  CAPP.PROGRAMS = PROGRAMS;
})(typeof window !== 'undefined' ? window : globalThis);
