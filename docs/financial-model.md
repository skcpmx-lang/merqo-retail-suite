# MERQO — Financial Model & Definitions

All values integer paisa.

## Core identities

```
Revenue (net)   = Σ sales.total (COMPLETED) − Σ sale_returns.total_refund
COGS (net)      = Σ (qty − returned) × FIFO unit_cost / 1000
Gross profit    = Revenue − COGS
Net profit      = Gross − Expenses + MFS commission
Cash movement   = Σ financial_transactions IN/OUT (by direction)
Receivable      = Σ customer_ledger (debit − credit)
Payable         = Σ supplier_ledger (credit − debit)
Stock value     = Σ stock_milli × purchase_price / 1000   (last-cost valuation)
```

Cash received ≠ revenue: credit sales increase receivable, not cash.
Dashboard KPIs and detail reports share these definitions (`reportService`);
`incomeExpense()` is the single implementation consumed by both the dashboard
profit tile and the profit report (asserted in integration tests).

## Ledger conventions

- **Customer**: debit increases what the customer owes (sale, opening);
  credit decreases it (payment, return, advance).
- **Supplier**: credit increases what we owe (purchase, opening);
  debit decreases it (payment, return).
- **Financial account**: IN/OUT rows; balance = opening + IN − OUT.

## Tax

- `tax_mode`: `none` | `item` (per-product `tax_bp`) | `invoice` (business `tax_default_bp`).
- Displayed explicitly on invoices; no legal-compliance claims.

## Precision

- Basis-point rates, half-up rounding, largest-remainder splits.
- Edge cases covered by unit tests: ৳0.10/৳0.30, fractional qty × price,
  pro-rata refunds, multi-payment splits.
