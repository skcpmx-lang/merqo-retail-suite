# MERQO Retail Suite — Architecture

## 1. Stack decision

| Concern | Choice | License | Rationale |
|---|---|---|---|
| Desktop shell | Electron 33 (Chromium + Node) | MIT | Mature Windows support, offline, NSIS/portable packaging, Chromium printing + PDF, Bengali shaping |
| UI | React 18 + TypeScript + Vite | MIT | Type-safe, fast, component reuse; HashRouter for `file://` |
| Database | SQLite via better-sqlite3 | MIT | Embedded, zero-config, synchronous transactions, WAL, FK enforcement |
| Money | Integer paisa (`src/shared/money.ts`) | — | No float drift; half-up rounding; basis-point tax |
| Quantity | Integer milli-units (`src/shared/qty.ts`) | — | Exact fractional kg/liter support |
| Barcode/QR | jsbarcode + qrcode | MIT | Local generation, no APIs |
| Excel export | exceljs | MIT | Local `.xlsx`, Bengali-safe |
| Icons | lucide-react | ISC | Single coherent stroke icon set |
| Font | Noto Sans Bengali (bundled woff2) | OFL 1.1 | Correct conjuncts; embedded in print docs as base64 |
| Passwords | Node `crypto.scrypt` | — | No extra dep; timing-safe compare |
| Charts | Hand-rolled SVG | — | Zero deps, offline, print-friendly |

No GPL/AGPL dependencies. No runtime CDN, no paid APIs, no network calls in production paths.
A `webRequest` guard in `src/main/main.ts` blocks all non-local requests at runtime.

## 2. Process model

```
┌─ Main process (Node) ─────────────────────────────┐
│ main.ts: windows, lifecycle, print/PDF service     │
│ ipc.ts: single `merqo:invoke` router (action+args) │
│ services/*: domain logic + SQLite transactions     │
│ db.ts: connection, versioned migrations, seeds     │
└──────────────┬────────────────────────────────────┘
               │ contextIsolated preload bridge (no node in UI)
┌──────────────▼────────────────────────────────────┐
│ Renderer (React): pages, design system, print HTML │
│ api.ts: typed IPC client + session token           │
│ store.tsx: session, business, permissions, toasts  │
└───────────────────────────────────────────────────┘
```

All business rules execute in **main** (`services/`), inside SQLite transactions.
The renderer never touches the database. Every mutating IPC route checks the
caller's permission server-side (`requirePerm`).

## 3. Money & quantity invariants

- `amount_paisa INTEGER` everywhere; `qty_milli INTEGER` everywhere.
- Display formatting centralized in `src/shared/money.ts` / `src/shared/qty.ts`.
- Digit locale (`en`/`bn`) is a business setting; storage never changes.

## 4. Single source of truth

| Balance | Derivation |
|---|---|
| Financial account | `opening + Σ(IN) − Σ(OUT)` over `financial_transactions` |
| Customer due | `Σ(debit − credit)` over `customer_ledger` (+ running `balance` col for audit) |
| Supplier payable | `Σ(credit − debit)` over `supplier_ledger` |
| Stock | `Σ(qty_milli)` over `inventory_movements` == `products.stock_milli` (maintained transactionally) |

No screen writes a balance directly; all are transaction effects.

## 5. Transaction pattern

```
validate input → compute (money/qty) → db.transaction(() => {
  primary doc → stock/FIFO → money → ledgers → audit
})
```

If any step throws, the whole business operation rolls back. Printing is
**never** part of the transaction (transaction-first design).

## 6. Offline & storage layout

```
%AppData%/MERQO Retail Suite/
  merqo.db            SQLite database (WAL)
  backups/            timestamped .db snapshots
  exports/            CSV/XLSX/PDF outputs
  images/             product images (future)
  logs/merqo.log      structured log (rotated ~2MB)
  temp/               transient files
```

## 7. Testing

- `tests/unit`: money, qty, dates (deterministic, no DB).
- `tests/integration/business.test.ts`: full scenario on an isolated temp DB —
  setup → masters → purchase → sale → payments → expense → transfer → MFS →
  returns → void → permission denial → dashboard/report reconciliation →
  ledger-running-balance checks → `PRAGMA integrity_check`.
