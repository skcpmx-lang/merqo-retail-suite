# MERQO — Printer Setup

## Supported outputs

| Document | A4 | 80mm thermal | 58mm thermal | PDF |
|---|---|---|---|---|
| Sale invoice/receipt | ✅ | ✅ | ✅ | ✅ |
| Purchase record | ✅ | — | — | ✅ |
| Payment receipt | ✅ | — | — | ✅ |
| Reports/statements | ✅ | — | — | ✅ |

Thermal templates are purpose-built for narrow widths (not shrunk A4).

## Configuration

Settings → Printer:

1. Choose invoice printer (A4) and receipt printer (thermal) — or leave default.
2. Run **Test print** (includes Bengali glyph + digit check).
3. In POS, receipt width follows Business settings (58/80mm).

## How it works

- The renderer builds standalone HTML (`PrintDocs.tsx`).
- Main renders it in a hidden window with the **embedded** Noto Sans Bengali
  font (base64 `@font-face`), so output never depends on printer fonts.
- `print` uses the OS driver dialog; `pdf` uses Chromium `printToPDF`
  (local, offline). Preview opens the exact document before printing.

## Failure handling (transaction-first)

Printing is presentation, not truth: the sale is saved **before** print is
attempted. If the printer is unavailable, a Bengali message offers retry /
preview / PDF — the business record is never at risk.

## Scanner note

USB/Bluetooth/QR scanners that emulate keyboards work out of the box:
focus the barcode field, scan, Enter. No scanner API or driver needed.
