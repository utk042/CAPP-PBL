/*
 * alu.js — Unit 2 (Arithmetic & Logic Unit) of CAPP applied to the
 * Pharmacy Inventory Computing System.
 *
 *  - 8-bit ALU with S2 S1 S0 operation select and C/Z/N/V flags
 *  - Booth's algorithm (signed operand multiplication)
 *  - Restoring and non-restoring division (strips = tablets / pack size)
 *  - Logic operations on a medicine status register (bit masks)
 *  - IEEE 754 single / double precision encoding of prices
 *  - Step-by-step floating point add / sub / mul / div (single precision)
 */
(function (root) {
  'use strict';
  const CAPP = (root.CAPP = root.CAPP || {});

  const bin = (v, n) => (v >>> 0).toString(2).padStart(n, '0').slice(-n);
  const mask = (n) => (n >= 32 ? 0xffffffff : (1 << n) - 1);
  const toSigned = (v, n) => {
    v &= mask(n);
    return v & (1 << (n - 1)) ? v - (1 << n) : v;
  };

  /* ------------------------------------------------------------------ */
  /* 1. ALU design: n-bit ALU, 3-bit function select                     */
  /* ------------------------------------------------------------------ */
  const ALU_OPS = [
    { code: 0b000, name: 'ADD', expr: 'F = A + B', type: 'arith' },
    { code: 0b001, name: 'SUB', expr: "F = A + B' + 1", type: 'arith' },
    { code: 0b010, name: 'AND', expr: 'F = A ∧ B', type: 'logic' },
    { code: 0b011, name: 'OR', expr: 'F = A ∨ B', type: 'logic' },
    { code: 0b100, name: 'XOR', expr: 'F = A ⊕ B', type: 'logic' },
    { code: 0b101, name: 'NOT', expr: "F = A'", type: 'logic' },
    { code: 0b110, name: 'SHL', expr: 'F = shl A', type: 'shift' },
    { code: 0b111, name: 'SHR', expr: 'F = shr A', type: 'shift' },
  ];

  function alu(op, a, b, n = 8) {
    const m = mask(n);
    a &= m;
    b &= m;
    const sign = 1 << (n - 1);
    let r = 0, c = 0, v = 0;
    switch (op) {
      case 'ADD': {
        const s = a + b;
        r = s & m;
        c = s > m ? 1 : 0;
        v = (~(a ^ b) & (a ^ r) & sign) ? 1 : 0;
        break;
      }
      case 'SUB': {
        // A - B implemented as A + (B' + 1): carry = 1 means "no borrow"
        const s = a + ((~b) & m) + 1;
        r = s & m;
        c = s > m ? 1 : 0;
        v = ((a ^ b) & (a ^ r) & sign) ? 1 : 0;
        break;
      }
      case 'AND': r = a & b; break;
      case 'OR': r = a | b; break;
      case 'XOR': r = a ^ b; break;
      case 'NOT': r = ~a & m; break;
      case 'SHL': r = (a << 1) & m; c = (a & sign) ? 1 : 0; break;
      case 'SHR': r = a >>> 1; c = a & 1; break;
      default: throw new Error('Unknown ALU op ' + op);
    }
    return { result: r, flags: { C: c, Z: r === 0 ? 1 : 0, N: (r & sign) ? 1 : 0, V: v } };
  }

  /* ------------------------------------------------------------------ */
  /* 2. Booth's algorithm (signed multiplication)                        */
  /* ------------------------------------------------------------------ */
  // Operands must lie in −(2^(n−1)−1) … 2^(n−1)−1 (A − M must not overflow n bits).
  function booth(multiplicand, multiplier, n = 8) {
    const m = mask(n);
    const M = multiplicand & m;
    let A = 0, Q = multiplier & m, Q_1 = 0;
    const steps = [{ step: 0, action: 'Initialise', A: bin(A, n), Q: bin(Q, n), Q_1: Q_1 }];
    for (let i = 1; i <= n; i++) {
      const pair = `${Q & 1}${Q_1}`;
      let action = '';
      if (pair === '10') { A = (A - M) & m; action = 'A ← A − M'; }
      else if (pair === '01') { A = (A + M) & m; action = 'A ← A + M'; }
      else action = 'No operation';
      // arithmetic shift right of A, Q, Q-1
      Q_1 = Q & 1;
      Q = ((Q >>> 1) | ((A & 1) << (n - 1))) & m;
      A = ((A >>> 1) | (A & (1 << (n - 1)))) & m;
      steps.push({ step: i, pair, action: action + ', ASR', A: bin(A, n), Q: bin(Q, n), Q_1 });
    }
    // 2n-bit signed result
    const raw = A * 2 ** n + Q;
    const product = raw >= 2 ** (2 * n - 1) ? raw - 2 ** (2 * n) : raw;
    return { steps, product, bits: bin(A, n) + bin(Q, n) };
  }

  /* ------------------------------------------------------------------ */
  /* 3. Division: restoring and non-restoring (unsigned)                 */
  /* ------------------------------------------------------------------ */
  function divide(dividend, divisor, n = 8, method = 'restoring') {
    if (divisor === 0) throw new Error('Division by zero');
    const w = n + 2; // A register: n bits + carry + sign, so 2·A never overflows
    const m = mask(w);
    const qm = mask(n);
    const M = divisor & qm;
    let A = 0, Q = dividend & qm;
    const sgn = (x) => (x & (1 << (w - 1)) ? 1 : 0);
    const steps = [{ step: 0, action: 'Initialise', A: bin(A, w), Q: bin(Q, n) }];
    for (let i = 1; i <= n; i++) {
      // shift left A,Q
      A = ((A << 1) | (Q >>> (n - 1))) & m;
      Q = (Q << 1) & qm;
      let action;
      if (method === 'restoring') {
        A = (A - M) & m;
        if (sgn(A)) { Q &= ~1; A = (A + M) & m; action = 'SHL, A←A−M, A<0: Q0←0, restore A←A+M'; }
        else { Q |= 1; action = 'SHL, A←A−M, A≥0: Q0←1'; }
      } else {
        if (sgn(A)) { A = (A + M) & m; action = 'SHL, A<0: A←A+M'; }
        else { A = (A - M) & m; action = 'SHL, A≥0: A←A−M'; }
        if (sgn(A)) { Q &= ~1; action += ', Q0←0'; } else { Q |= 1; action += ', Q0←1'; }
      }
      steps.push({ step: i, action, A: bin(A, w), Q: bin(Q, n) });
    }
    if (method !== 'restoring' && sgn(A)) {
      A = (A + M) & m;
      steps.push({ step: '✓', action: 'Final: A<0 so A←A+M', A: bin(A, w), Q: bin(Q, n) });
    }
    return { steps, quotient: Q, remainder: A & qm };
  }

  /* ------------------------------------------------------------------ */
  /* 4. Logic operations on the medicine status register                 */
  /* ------------------------------------------------------------------ */
  const STATUS_BITS = [
    { bit: 0, key: 'LOW', label: 'Low stock' },
    { bit: 1, key: 'OUT', label: 'Out of stock' },
    { bit: 2, key: 'NEAR', label: 'Expiring ≤ 90 days' },
    { bit: 3, key: 'EXP', label: 'Expired' },
    { bit: 4, key: 'RX', label: 'Prescription only' },
    { bit: 5, key: 'COLD', label: 'Cold storage' },
    { bit: 6, key: 'HIGH', label: 'High value (≥ ₹5000)' },
    { bit: 7, key: 'RSV', label: 'Reserved' },
  ];
  const logic = {
    set: (reg, m) => reg | m, // selective set: OR
    clear: (reg, m) => reg & ~m & 0xff, // selective clear: AND with mask'
    complement: (reg, m) => reg ^ m, // selective complement: XOR
    test: (reg, m) => (reg & m) !== 0, // mask / test: AND
    testAll: (reg, m) => (reg & m) === m,
  };

  /* ------------------------------------------------------------------ */
  /* 5. IEEE 754                                                          */
  /* ------------------------------------------------------------------ */
  function ieeeSingleBits(x) {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, x);
    return dv.getUint32(0);
  }
  function singleFromBits(u) {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setUint32(0, u >>> 0);
    return dv.getFloat32(0);
  }
  function classify(expBits, fracZero, expMax) {
    if (expBits === 0) return fracZero ? 'Zero' : 'Denormalised';
    if (expBits === expMax) return fracZero ? 'Infinity' : 'NaN';
    return 'Normalised';
  }
  function ieee754(x, precision = 'single') {
    if (precision === 'single') {
      const u = ieeeSingleBits(x);
      const s = u >>> 31, e = (u >>> 23) & 0xff, f = u & 0x7fffff;
      const stored = singleFromBits(u);
      return {
        precision, bias: 127, sign: s, exponent: e, fraction: f,
        bits: { sign: String(s), exponent: bin(e, 8), fraction: bin(f, 23) },
        hex: '0x' + u.toString(16).toUpperCase().padStart(8, '0'),
        kind: classify(e, f === 0, 255),
        unbiased: e === 0 ? -126 : e - 127,
        stored, error: Number.isFinite(x) ? stored - x : 0,
      };
    }
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, x);
    const hi = dv.getUint32(0), lo = dv.getUint32(4);
    const s = hi >>> 31, e = (hi >>> 20) & 0x7ff;
    const fBits = bin(hi & 0xfffff, 20) + bin(lo, 32);
    return {
      precision, bias: 1023, sign: s, exponent: e,
      bits: { sign: String(s), exponent: bin(e, 11), fraction: fBits },
      hex: '0x' + hi.toString(16).toUpperCase().padStart(8, '0') + lo.toString(16).toUpperCase().padStart(8, '0'),
      kind: classify(e, !fBits.includes('1'), 2047),
      unbiased: e === 0 ? -1022 : e - 1023,
      stored: x, error: 0,
    };
  }

  /*
   * Step-by-step single precision arithmetic done the way the hardware does it:
   * unpack → (align / multiply / divide significands) → normalise → round to
   * nearest even → pack. Uses BigInt so every intermediate bit is exact.
   */
  function unpack(x) {
    const u = ieeeSingleBits(x);
    const s = u >>> 31, e = (u >>> 23) & 0xff, f = u & 0x7fffff;
    return { s, e, f, m: BigInt(e === 0 ? f : f | 0x800000), normal: e !== 0 && e !== 255, zero: e === 0 && f === 0 };
  }
  // round a significand that carries `extra` bits below the 24-bit result (plus a sticky flag)
  function roundNearestEven(sig, extra, sticky) {
    const one = 1n;
    const lsbMask = (one << BigInt(extra)) - one;
    const rem = sig & lsbMask;
    let q = sig >> BigInt(extra);
    const half = one << BigInt(extra - 1);
    const roundUp = rem > half || (rem === half && (sticky || (q & one) === one));
    const tie = rem === half && !sticky;
    if (roundUp) q += one;
    return { q, guard: rem >= half ? 1 : 0, rest: rem & (half - one) ? 1 : 0, sticky: sticky ? 1 : 0, roundUp, tie };
  }
  function msbIndex(v) { return v === 0n ? -1 : v.toString(2).length - 1; }
  const sigStr = (m) => { const s = m.toString(2).padStart(24, '0'); return s[0] + '.' + s.slice(1); };

  function fpArith(a, b, op) {
    a = Math.fround(a); b = Math.fround(b);
    const expected = Math.fround(op === 'add' ? a + b : op === 'sub' ? a - b : op === 'mul' ? a * b : a / b);
    const A = unpack(a), B = unpack(b);
    const steps = [];
    const desc = (n, X) => `${n} = ${X.s ? '−' : '+'}${sigStr(X.m)} × 2^${X.e - 127}  (E=${X.e})`;
    if (!A.normal || !B.normal) {
      return { steps: [{ title: 'Special operand', detail: 'Zero / denormal / ∞ / NaN operands are handled by the special-case logic of the FPU.' }], result: expected, expected, special: true };
    }
    steps.push({ title: '1. Unpack', detail: `${desc('A', A)}\n${desc('B', B)}` });
    let s, e, sig, extra, sticky = false;
    if (op === 'add' || op === 'sub') {
      const bs = op === 'sub' ? B.s ^ 1 : B.s;
      if (op === 'sub') steps.push({ title: '1b. Subtraction', detail: 'A − B is performed as A + (−B): flip sign bit of B.' });
      let X = { s: A.s, e: A.e, m: A.m }, Y = { s: bs, e: B.e, m: B.m };
      if (Y.e > X.e || (Y.e === X.e && Y.m > X.m)) [X, Y] = [Y, X];
      const G = 3n; // guard, round, sticky positions
      let xm = X.m << G, ym = Y.m << G;
      const d = X.e - Y.e;
      if (d > 0) {
        const lost = d >= 27 ? ym : ym & ((1n << BigInt(d)) - 1n);
        ym = d >= 27 ? 0n : ym >> BigInt(d);
        if (lost) ym |= 1n; // sticky
      }
      steps.push({ title: '2. Align exponents', detail: `Exponent difference = ${d}. Shift smaller significand right by ${d}${d ? ' (lost bits OR-ed into sticky bit)' : ''}.\nBoth now scaled by 2^${X.e - 127}.` });
      let r = X.s === Y.s ? xm + ym : xm - ym;
      s = X.s;
      steps.push({ title: '3. Add / subtract significands', detail: `${X.s === Y.s ? 'Signs equal → add' : 'Signs differ → subtract'} magnitudes; result sign = ${s ? '−' : '+'}\nraw = ${r.toString(2)}` });
      if (r === 0n) return { steps: steps.concat({ title: '4. Result', detail: 'Exact zero.' }), result: 0, expected, special: false };
      e = X.e;
      const top = msbIndex(r), want = 23 + 3;
      if (top > want) {
        if (r & 1n) sticky = true;
        r >>= 1n; e += 1;
        steps.push({ title: '4. Normalise', detail: 'Carry out of the MSB → shift right 1, exponent + 1.' });
      } else if (top < want) {
        r <<= BigInt(want - top); e -= want - top;
        steps.push({ title: '4. Normalise', detail: `Leading zeros → shift left ${want - top}, exponent − ${want - top}.` });
      } else steps.push({ title: '4. Normalise', detail: 'Already normalised (1.xxx).' });
      sig = r; extra = 3;
    } else if (op === 'mul') {
      s = A.s ^ B.s;
      e = A.e + B.e - 127;
      let p = A.m * B.m; // 47 or 48 bits
      steps.push({ title: '2. Sign & exponent', detail: `sign = ${A.s} ⊕ ${B.s} = ${s}; E = ${A.e} + ${B.e} − 127 = ${e}` });
      steps.push({ title: '3. Multiply significands', detail: `24 × 24 bit product = ${p.toString(2)}` });
      if (msbIndex(p) === 47) { e += 1; steps.push({ title: '4. Normalise', detail: 'Product ≥ 2 → shift right 1, exponent + 1.' }); }
      else steps.push({ title: '4. Normalise', detail: 'Product in [1,2) – no shift needed.' });
      extra = msbIndex(p) - 23;
      sig = p;
    } else {
      s = A.s ^ B.s;
      e = A.e - B.e + 127;
      steps.push({ title: '2. Sign & exponent', detail: `sign = ${A.s} ⊕ ${B.s} = ${s}; E = ${A.e} − ${B.e} + 127 = ${e}` });
      const num = A.m << 26n;
      let q = num / B.m;
      const r = num % B.m;
      sticky = r !== 0n;
      steps.push({ title: '3. Divide significands', detail: `quotient = ${q.toString(2)}${sticky ? ' (non-zero remainder → sticky)' : ''}` });
      if (msbIndex(q) < 26) { e -= 1; steps.push({ title: '4. Normalise', detail: 'Quotient < 1 → shift left 1, exponent − 1.' }); }
      else steps.push({ title: '4. Normalise', detail: 'Quotient in [1,2) – no shift needed.' });
      extra = msbIndex(q) - 23;
      sig = q;
    }
    const rnd = roundNearestEven(sig, extra, sticky);
    let q = rnd.q;
    if (msbIndex(q) === 24) { q >>= 1n; e += 1; }
    steps.push({ title: '5. Round (nearest-even)', detail: `guard=${rnd.guard} round=${rnd.rest} sticky=${rnd.sticky} → ${rnd.roundUp ? 'round up (+1 ulp)' : 'truncate'}${rnd.tie ? ' (tie → even)' : ''}\nsignificand = ${sigStr(q)}` });
    if (e >= 255 || e <= 0) {
      steps.push({ title: '6. Overflow / underflow', detail: 'Exponent out of the normal range — result handled as ∞ / denormal.' });
      return { steps, result: expected, expected, special: true };
    }
    const bits = ((s << 31) | (e << 23) | Number(q & 0x7fffffn)) >>> 0;
    const result = singleFromBits(bits);
    steps.push({ title: '6. Pack', detail: `S=${s}  E=${bin(e, 8)}  F=${bin(Number(q & 0x7fffffn), 23)}  → ${'0x' + bits.toString(16).toUpperCase().padStart(8, '0')} = ${result}` });
    return { steps, result, expected, special: false };
  }

  CAPP.bin = bin;
  CAPP.toSigned = toSigned;
  CAPP.ALU_OPS = ALU_OPS;
  CAPP.alu = alu;
  CAPP.booth = booth;
  CAPP.divide = divide;
  CAPP.STATUS_BITS = STATUS_BITS;
  CAPP.logic = logic;
  CAPP.ieee754 = ieee754;
  CAPP.fpArith = fpArith;
})(typeof window !== 'undefined' ? window : globalThis);
