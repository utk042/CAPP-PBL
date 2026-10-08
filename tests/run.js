// Self-checks for the CAPP simulation cores. Run: node tests/run.js
require('../assets/js/alu.js');
require('../assets/js/cpu.js');
const C = globalThis.CAPP;
let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.error('FAIL:', msg); } };

// ALU
ok(C.alu('ADD', 200, 100).flags.C === 1 && C.alu('ADD', 200, 100).result === 44, 'ADD carry');
ok(C.alu('SUB', 30, 30).flags.Z === 1, 'SUB zero');
ok(C.alu('SUB', 10, 30).flags.N === 1 && C.alu('SUB', 10, 30).flags.C === 0, 'SUB borrow');
ok(C.alu('ADD', 100, 100).flags.V === 1, 'ADD overflow');

// Booth
for (let a = -127; a < 128; a += 7) for (let b = -127; b < 128; b += 11)
  ok(C.booth(a, b).product === a * b, `booth ${a}*${b}`);

// Division
for (const m of ['restoring', 'nonrestoring'])
  for (let a = 0; a < 256; a += 3) for (let b = 1; b < 256; b += 13) {
    const r = C.divide(a, b, 8, m);
    ok(r.quotient === Math.floor(a / b) && r.remainder === a % b, `${m} ${a}/${b}`);
  }

// IEEE 754
ok(C.ieee754(12.75).hex === '0x414C0000', 'ieee 12.75');
ok(C.ieee754(-0.1, 'double').hex === '0xBFB999999999999A', 'ieee double -0.1');

// FP arithmetic vs hardware (Math.fround)
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = 0; i < 20000; i++) {
  const a = Math.fround((rnd() - 0.5) * 10 ** Math.floor(rnd() * 8 - 3));
  const b = Math.fround((rnd() - 0.5) * 10 ** Math.floor(rnd() * 8 - 3));
  for (const op of ['add', 'sub', 'mul', 'div']) {
    if (a === 0 || b === 0) continue;
    const r = C.fpArith(a, b, op);
    ok(Object.is(r.result, r.expected) || (r.result === 0 && r.expected === 0), `fp ${op} ${a} ${b} got ${r.result} want ${r.expected}`);
  }
}
for (const [a, b] of [[1, -1], [1.5, 1.5], [16777216, 1], [16777217, 3], [0.1, 0.2], [1e-3, 1e3]])
  for (const op of ['add', 'sub', 'mul', 'div']) { const r = C.fpArith(a, b, op); ok(Object.is(r.result, r.expected) || r.result === r.expected, `fp edge ${op} ${a} ${b} ${r.result} ${r.expected}`); }

// PharmaCPU: run inventory programs on sample data
const items = [[120, 50, 0], [10, 40, 1], [0, 20, 3], [75, 30, 4], [5, 25, 9]]; // qty, reorder, flags
const loadData = (cpu) => { cpu.mem[0x100] = items.length; items.forEach((r, i) => r.forEach((v, j) => (cpu.mem[0x101 + 3 * i + j] = v))); cpu.mem[0x1E0] = 30; };
const runProg = (key) => { const cpu = new C.CPU(); cpu.load(C.assemble(C.PROGRAMS[key].src).program.map((p) => p.word)); loadData(cpu); cpu.run(); ok(cpu.halted, key + ' halts'); return cpu; };
ok(runProg('lowstock').mem[0x1F0] === 3, 'lowstock count');
ok(runProg('total').mem[0x1F1] === 210, 'total units');
ok(runProg('flags').mem[0x1F2] === 2, 'expiry flag scan');
ok(runProg('sale').mem[0x101] === 90, 'sale update');
for (const w of [0x5a58, 0x1fff, 0x4a7f, 0xc123]) ok(C.assemble(C.disasm(w)).program[0].word === w, 'disasm/assemble roundtrip ' + w.toString(16));
const cpu = runProg('lowstock');
const pf = C.pipeline(cpu.trace, { forwarding: true }), pn = C.pipeline(cpu.trace, { forwarding: false });
ok(pf.total < pn.total && pf.total >= pf.ideal, 'pipeline forwarding helps');
ok(cpu.trace.length * 5 === pf.nonPipelined, 'non-pipelined cycles');
// microcode: every routine ends in RET, fetch ends in MAP
ok(C.CONTROL_MEMORY[3].br === 'MAP' && C.ISA.every((i) => C.CONTROL_MEMORY.filter(Boolean).some((m) => m.addr >= 8 * (i.op + 1) && m.addr < 8 * (i.op + 2) && m.br === 'RET')), 'control memory');

if (typeof module !== 'undefined') module.exports = { ok, done: () => {} };
process.on('exit', () => { console.log(`${checks - fails}/${checks} checks passed`); if (fails) process.exitCode = 1; });
