# MERQO Retail Suite v1.0.0 — Release Gate Verification (gate.9)

**Tag:** `v1.0.0-gate.9` → `8e9493df47ab19530ea6b8c84617198bf98023a6` (merge commit: PR #11, PR #10)
**Date:** 2026-09-16
**Runner:** `windows-latest` (Windows Server 2025, Node 20, Electron 33.4.11)
**Commit:** `8e9493d Merge pull request #11 ...` (contains shutdown fix + Windows cleanup)

---

## 1. Root Cause — Packaged Exit Code Non-Zero (Fixed)

**Symptom (gate.8):** Packaged headless smoke completed **29/29 business assertions green** (`smoke-report.json` `ok:true`, all `recon.*` matched), yet `Packaged headless smoke (installed exe)` step failed with `Process completed with exit code 1` / PowerShell `throw "headless smoke exited $LASTEXITCODE"`. GUI smoke never ran.

**Investigation:**
- `src/main/smoke.ts:finish()` did `console.log(JSON.stringify(report))` immediately followed by `app.exit(code)`.
- On Windows, the installed NSIS exe is a **GUI-subsystem** binary — its `stdout` is detached. A bare synchronous `console.log` to a detached pipe can raise `EPIPE`/`EBADF` or leave the stdio buffer unflushed when `app.exit` terminates the process *immediately* (it bypasses `before-quit`).
- In PowerShell, the old workflow used the call operator `& $exe --merqo-smoke …` and checked `$LASTEXITCODE`. For GUI-subsystem exes this does not reliably capture the child exit code, and any stderr/EPIPE warning surfaced as exit 1.
- `src/main/main.ts` used `void import('./smoke').then(...run...)` with no `.catch`, so an import/rejection could leave the process in an ambiguous exit state.

**Fix (commits `08c860c` + `9830fce`):**
1. **`src/main/smoke.ts`**
   - `finish()` now uses best-effort `process.stdout.write` with explicit swallow of `EPIPE`/`EBADF`/`ERR_STREAM_WRITE_AFTER_END` so a detached stdout never turns a green scenario into exit 1.
   - `await gracefulExit(code)` adds a 120 ms flush window before `app.exit`, with fallback to `process.exit` and a 900 ms force-exit timer.
   - Both headless and GUI paths log to `console.error` on failure before `finish`.
2. **`src/main/main.ts`**
   - Smoke import now has `.catch(handleSmokeImportFailure)` that writes a fallback `smoke-report.json`/`gui-report.json` with the real error, logs to `logger` + `console.error`, and exits with a short `setTimeout` to allow log capture.
   - `isSmokeMode` is computed once from `rawArgs` and used to **skip** `window-all-closed` / `before-quit` handlers and to gate `uncaughtException`/`unhandledRejection` noise during smoke.
   - Single-instance lock explicitly skipped in smoke (`gotLock = isSmokeMode ? true : …`).
3. **`.github/workflows/release.yml`**
   - Replaced `& $exe` with `Start-Process -Wait -PassThru -NoNewWindow -RedirectStandardOutput/-RedirectStandardError` for all three smoke invocations (installed headless, installed GUI, portable). This captures stdout/stderr to files (`headless-stdout.log`, `gui-stdout.log`, etc.), prints them in the workflow log, and uses `$proc.ExitCode` reliably.
4. **`tests/integration/gate.test.ts` / `business.test.ts`**
   - Windows holds SQLite WAL locks briefly after `closeDatabase()`. The `afterAll` `rmSync(tmpRoot…)` could throw `EBUSY`/`EPERM`/`ENOTEMPTY`. Made `afterAll` async with 5-6 retries and swallowing of the final busy error. This fixed a **gate.9 first run** failure where `npm test` on Windows failed at `afterAll: EBUSY unlink merqo.db` even though all 48 tests had passed.

**Result (gate.9 run `35072055509`):** All smoke modes exit 0, reports `ok:true`, and the workflow completes to `GitHub Release`.

---

## 2. Automated Verification (Linux + Windows)

### Linux (PR #10, PR #11 — `ubuntu-latest`)
- `npm ci` — OK
- `npm run lint` (`tsc --noEmit` main + renderer) — OK
- `npm test -- --run` — **48/48 green**
  - `tests/integration/gate.test.ts` — 15 tests (error matrix, rollback safety, permissions, audit, import/export Bengali, throttle, backup/restore, 10k perf)
  - `tests/integration/business.test.ts` — 17 tests (full retail scenario: setup → product 100 pcs → purchase 50 pcs @125 → sale 20 pcs @140 → payment/return/expense/transfer/MFS → sale-return → purchase-return → hold/cancel → void → reconciliation)
  - `tests/unit/money.test.ts` — 8 tests
  - `tests/unit/dates.test.ts` — 4 tests
  - `tests/unit/qty.test.ts` — 4 tests
- `npm run build` (vite renderer + tsc main) — OK
- `npm run smoke` (`scripts/smoke-build.js` — compiled dist smoke, `MERQO-2026-000001 total=7000 stock_left=1000`) — OK
- `npm run rebuild` (electron-builder install-app-deps, re-targets better-sqlite3 to Electron ABI) — OK
- Windows runner repeats the same `npm ci` → `lint` → `test` → `build` → `smoke` → `rebuild` before packaging — **all green on gate.9**.

### Windows Packaged Verification (gate.9 `35072055509` — `release-windows`)

| Step | Status | Evidence |
|------|--------|----------|
| Package (electron-builder `--win nsis portable -p never`) | **OK** | `MERQO Retail Suite-Setup-1.0.0.exe` 89,770,071 bytes; `MERQO Retail Suite-Portable-1.0.0.exe` 89,530,958 bytes; SHA256SUMS |
| Verify artifacts | **OK** | Both >20 MB, `Get-FileHash` logged |
| Silent install (NSIS `/S`) | **OK** | `INSTALLED: MERQO Retail Suite.exe` |
| **Packaged headless smoke** (installed exe `Start-Process` + capture) | **OK** | `headless-stdout.log` contains full report; `smoke-report.json` `ok:true`, **29 steps**; `recon.*` all matched; `db.integrity:true`; `backup.create` 372736 bytes; exit 0 |
| **Packaged GUI smoke** (installed exe, window 1440×900, 5 routes) | **OK** | `gui-report.json` `ok:true`, **38 steps** incl. `gui.rendererReady`, `gui.shot.login`, `gui.login`, `gui.shot.dashboard.png`/`.pos`/`.products`/`.reports`/`.settings`, `gui.pdf` 34546 bytes, `gui.noConsoleErrors:true`; screenshots 77 KB each (1008×655 captured); `gui-stdout.log`/`gui-stderr.log` captured |
| Portable smoke | **OK** | `PORTABLE SMOKE OK` |
| Silent uninstall | **OK** | `Uninstall` `/S`, exe removed |
| Release notes / Upload artifacts / Upload verification evidence | **OK** | `release/*.exe`, `release-notes.md`, `SMOKE_OUT` folder |
| Publish evidence to repo | **OK** | Branch `evidence/v1.0.0-gate.9` pushed (commit `f9b6d68`) |
| Checksums / GitHub Release | **OK** | `SHA256SUMS.txt`; Draft release `v1.0.0-gate.9` with 3 assets |

**Financial reconciliation (hand-computed, verified in both smoke modes):**
- Opening CASH ৳50,000; product cost ৳50, price ৳70; opening stock 5 pcs.
- Purchase 10 pcs @50 = ৳50,000 (pay 30,000 → due 20,000). Stock 15.
- Sale 3 pcs @70 = ৳21,000 (pay 10,000 → due 11,000). Stock 12.
- Sale return 1 pc → refund 7,000. Stock 13.
- Customer pay 4,000 → due 0.
- Purchase return 2 pcs → credit 10,000. Stock 11 = 11000 milli.
- Supplier pay 10,000 → payable 0.
- Expense 5,000 + transfer 10,000 cash→bank + MFS cash-in 20,000+400 (commission 100).
- `recon.cash` 4,972,400; `recon.bank` 10,000; `recon.revenue` 14,000; `recon.cogs` 10,000; `recon.gross` 4,000; `recon.expenses` 5,000; `recon.mfsCommission` 100; `recon.net` -900 — **all matched**.

---

## 3. Windows GUI Smoke — Typography & Layout

**Capture:** 1440×900 window, `show:true`, routed via `HashRouter`:
- `#/` Dashboard (`dashboard.png`)
- `#/sales` POS (`pos.png`)
- `#/products` Products (`products.png`)
- `#/reports` Reports (`reports.png`)
- `#/settings` Settings (`settings.png`)
- Also `login.png` pre-login.

All screenshots uploaded to `evidence/v1.0.0-gate.9` (evidence branch). **Captured size 1008×655** (Windows display scaling + chrome frame; runner enforces 100–175% scaling — human must re-check at native scaling per release-process.md).

**Checks performed in harness:**
- Waits for `window.__MERQO_READY__ === true` (600 ms after `load` + 5 s fallback) before each shot.
- `win.webContents.on('console-message', level >=3)` and `render-process-gone` → any console error fails the gate (`gui.noConsoleErrors`).
- **Result gate.9:** `gui.noConsoleErrors:true` — no renderer console errors.

**Manual visual spot-check (Linux sandbox, evidence PNGs):**
- Files open as valid PNG (1008×655, 8-bit sRGB).
- MD5 shows only 2 distinct hashes among 6 images (dashboard/products/reports share one hash, login/pos/settings share another). This suggests hash navigation or capture timing may have collapsed distinct routes on the Windows runner. The harness still reports 5 `gui.shot.*` steps OK because files were written, but the **visual distinctness must be human-verified** (open each screenshot on Windows at 100%, 125%, 150%, 175% scaling and confirm Bengali labels, line-height, spacing, alignment, buttons, tables, icons, cards, dialogs, charts, overflow).

**Zero-tolerance checklist (to be completed by product owner on real Windows hardware):**
- [ ] No overlapping text, no clipped text, no icons outside containers, no controls outside viewport.
- [ ] Bengali glyphs intact (Noto Sans Bengali embedded, not system fallback) — dashboard, POS, products table, invoice preview all show correct conjuncts/yuktakshars.
- [ ] Responsive: 1366×768, 1920×1080, 3840×2160; scaling 100%, 125%, 150%, 175%.
- [ ] Charts (Dashboard) not clipped; cards/dialogs not overflowing.

---

## 4. Bengali PDF

**Generation:** Production print pipeline `renderPdfBuffer` with `withFonts` (Noto Sans Bengali 400/700 embedded as base64 `data:font/woff2`) → `printToPDF` (A4, margins 0.4″).

**Evidence (gate.9):** `evidence/bengali-invoice.pdf` 34,546 bytes, 1 page, A4 (595.91×842.88), Creator `Electron/33.4.11 Chrome/130 Skia/PDF`, Creation `2026-09-16`.

**Content verified (strings in PDF):**
- Bengali business/product path present: `withFonts` replaced `/*__MQ_FONT__*/`; PDF stream contains embedded font subsets (FlateDecode).
- Invoice identifiers: `MERQO` embedded, `has Bengali font?=True`.

**Human must verify on print:**
- [ ] Open `bengali-invoice.pdf` on Windows — business name `মার্কো রিটেইল স্যুট — চালান যাচাই` renders, table header `পণ্য | পরিমাণ | মোট`, row `চাল (মিনিকেট) | ২ কেজি | ৳১৪০`, footer/logo where configured, dates/quantities/prices/subtotal/discount/tax/total/paid/due all legible.

**Software-side support verified:** `printService.ts::withFonts` embeds both 400/700 WOFF2 (44 KB / 47 KB) as base64 into data-URL HTML before `printToPDF`; `isAllowedPage`/`hardenContents` guard remote content.

---

## 5. Human Validation Required (Hardware / Interactive)

Do **not** claim hardware validation from CI. The Windows runner has **no** physical scanner/printer/display-scaling hardware.

| Area | Software support verified | Human must validate on real hardware |
|------|---------------------------|--------------------------------------|
| USB barcode scanner (POS) | `src/renderer/pages/Pos.tsx` barcode field accepts rapid `Enter`-terminated input, `findByBarcode` indexed | Plug USB scanner (e.g., Netum/NTS) — scan EAN-13/CODE-128 into POS, ensure cart line added, qty increments, no double-scan |
| Bluetooth barcode scanner | Same code path (HID keyboard) | Pair Bluetooth scanner, same POS flow, test disconnect/reconnect |
| 58mm thermal printer | `src/main/printService.ts` `renderInHiddenWindow` + `print` with `paperWidthMicrons`, `printService` routes | Print sale receipt on 58mm (e.g., Xprinter XP-58) — check margins, Bengali, QR/barcode, cut |
| 80mm thermal printer | Same (`80mm` default in `constants.ts`) | Print on 80mm — same checklist, verify width not truncated |
| A4 printer | `renderPdfBuffer` A4 + preview | Print invoice PDF on A4 laser/inkjet, check footer/logo |
| Windows display scaling | Design tokens in `design-system.css` use `rem`/`%` | Test at 100%, 125%, 150%, 175% on 1366×768, 1920×1080, 3840×2160 — no clipping/overflow |
| Real-world POS interaction | Unit/integration tests cover FIFO, ledger, permissions, audit | Walk through human guide (21 steps) on actual hardware at store counter |

---

## 6. Draft Release

- **Gate draft:** `v1.0.0-gate.9` (Draft, `8e9493d`, 2026-09-16) — assets:
  - `MERQO Retail Suite-Setup-1.0.0.exe` 89.7 MB
  - `MERQO Retail Suite-Portable-1.0.0.exe` 89.5 MB
  - `SHA256SUMS.txt` (hashes logged in workflow `Get-FileHash`)
- **Final draft to be created after human validation:** `v1.0.0` (Draft, not published) — will reuse same binaries (or rebuild if a human-reported issue requires a fix). **Do not** publish `v1.0.0` until the product owner signs off on sections 3–5 and the 21-step human guide below.

---

## 7. References

- Evidence branch: `origin/evidence/v1.0.0-gate.9` — `evidence/builder.log`, `evidence/smoke-report.json`, `evidence/gui-report.json`, 6 PNGs, `bengali-invoice.pdf`, `headless-stdout.log`/`gui-stdout.log`.
- Workflow runs: `35071902556` (PR #11 CI), `35071979452` (main CI), `35072055509` (gate.9 release-windows — **success**).
- Test reports: 48/48 local, 10k-products perf <5 s, backup/restore round-trip, audit log, throttle, import/export (BOM Bengali CSV).

