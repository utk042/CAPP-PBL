# Pharmacy Inventory Computing System

PBL project for **Computer Architecture & Parallel Processing (CAPP, CCSE0304)**, B.Tech CSE-F, NIET. Group 91: Utkarsh Raj Shukla (2501330100398), Vivek Kumar (2501330100414), Vishal Gupta (2501330100411), Yash Srivastava (2501330100422) and Nishant Kumar Mahto (0261DCS009). Faculty: Dr. Amrita Bhatnagar. SDG 3: Good Health & Well-Being.

**Live web app:** https://utk042.github.io/CAPP-PBL/
**Repository:** https://github.com/utk042/CAPP-PBL

The app manages a pharmacy's medicines: stock, reorder levels, expiry dates, sales and purchases. Every computation it makes is shown as the CAPP hardware concept that carries it out, such as an ALU operation, an IEEE 754 operation or an instruction on a small simulated CPU.

## Features

| View | What it does | Syllabus |
|---|---|---|
| Stock | Medicine list with search and filters. Click a medicine to sell or restock it. Each sale is an ALU `SUB` (a borrow blocks overselling) and each restock an ALU `ADD`. The detail sheet shows the hardware behind each value: the 8-bit status register, packs by restoring division, the IEEE 754 price and the float32 stock value. | Units 1–2 |
| Lab · Unit 2 | ALU design with flags, restoring and non-restoring division, Booth's multiplication, IEEE 754 representation, and step-by-step floating point arithmetic | Unit 2 |
| Lab · Unit 3 | Instruction set and formats; a clock-by-clock instruction cycle running inventory programs; hardwired vs microprogrammed control (horizontal and vertical microcode); 5-stage pipelining with hazards and forwarding; RISC vs CISC; Flynn's taxonomy (SISD vs SIMD) | Unit 3 |
| About | Project summary, team, 50% progress and syllabus coverage | — |

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
