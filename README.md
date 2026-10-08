# Pharmacy Inventory Computing System

PBL project for **Computer Architecture & Parallel Processing (CAPP, CCSE0304)**, B.Tech CSE-F, NIET. Group 91: Utkarsh Raj Shukla (2501330100398), Vivek Kumar (2501330100414), Vishal Gupta (2501330100411), Yash Srivastava (2501330100422) and Nishant Kumar Mahto (0261DCS009). Faculty: Dr. Amrita Bhatnagar. SDG 3: Good Health & Well-Being.

**Live web app:** https://utk042.github.io/CAPP-PBL/
**Repository:** https://github.com/utk042/CAPP-PBL

The app manages a pharmacy's medicines: stock, reorder levels, expiry dates, sales and purchases. Every computation it makes is shown as the CAPP hardware concept that carries it out, such as an ALU operation, an IEEE 754 operation or an instruction on a small simulated CPU.

## Features

| Tab | What it does | Syllabus |
|---|---|---|
| Dashboard | Stock KPIs, alerts and a stock vs reorder chart. The total stock value is computed in float32. | Unit 2 |
| Inventory | Add, edit and delete medicines. Each sale is an ALU `SUB` and each purchase an ALU `ADD`, with the flags recorded. Shows packs + loose tablets (division) and lets you filter with a bit mask on an 8-bit status register. Supports import and export as JSON. | Unit 2 |
| ALU Lab | 8-bit ALU (S2 S1 S0, C/Z/N/V flags), restoring and non-restoring division, Booth's algorithm, logic operations (selective set, clear and complement, mask test), IEEE 754 single and double encoding, and step-by-step FP add/sub/mul/div | Unit 2 |
| Control Unit Lab | PharmaCPU ISA (instruction types, 5 formats, addressing modes), assembler, clock-by-clock fetch/decode/execute with micro-operations, hardwired vs microprogrammed control, horizontal vs vertical microcode, a 5-stage pipeline diagram with hazards and forwarding, RISC vs CISC, and Flynn's classification (SISD vs SIMD) | Unit 3 |
| Progress | Syllabus coverage (50%) and evidence | — |

## Run locally

The app is plain HTML, CSS and JavaScript with no build step.

```bash
python3 -m http.server 8000   # then open http://localhost:8000
node tests/run.js             # self-checks: ALU, Booth, division, IEEE 754 vs hardware, CPU programs, pipeline
```

## Deployment

`.github/workflows/pages.yml` runs the tests and then deploys the site to GitHub Pages on every push. If the first run fails at *configure-pages*, open **Settings → Pages**, set **Source** to **GitHub Actions** and re-run the workflow.

## Structure

```
index.html            UI (tabs)
assets/css/style.css  styles (light / dark)
assets/js/alu.js      Unit 2 – ALU, Booth, division, logic ops, IEEE 754, FP arithmetic
assets/js/cpu.js      Unit 3 – ISA, assembler, CPU, micro-ops, control memory, pipeline
assets/js/store.js    inventory data + status register (localStorage)
assets/js/app.js      rendering and interaction
tests/run.js          automated self-checks
reports/              PBL progress reports
```

## References

Class notes and lecture PPTs for Units 1–3 · M. Morris Mano, *Computer System Architecture* · W. Stallings, *Computer Organization and Architecture* · C. Hamacher, *Computer Organization* · IEEE Std 754-2019.
