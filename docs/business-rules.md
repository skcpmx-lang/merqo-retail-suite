# MERQO — Business Rules

Decisions below are normative; code and tests must match them.

## Sales / POS

1. Cart lines: qty > 0 (milli), price ≥ 0, line discount ≤ line gross.
2. `min_selling_price`: selling below it requires `sale.price_override`.
3. Any discount requires `sale.discount`.
4. Walk-in (no customer): `paid ≥ total`; excess is **change** (never due, never advance).
5. Customer sale: `due = total − paid`. `due > 0` without customer is rejected (`CUSTOMER_REQUIRED_FOR_DUE`).
6. Customer overpayment: `overpayment_policy=block` → reject; `=advance` → excess posted as customer ledger credit (`ADVANCE`).
7. Completion is atomic: invoice → items → FIFO consume → stock → money IN →
   customer ledger → audit. Any failure rolls back everything.
8. Held sales move **no** stock/money until completed.

## Void & returns

9. Completed docs are **voided/reversed**, never hard-deleted. Voids require reason + permission + audit.
10. Void reverses: net stock (restored at original FIFO cost), money, ledgers.
11. Returns are partial/full, capped at `qty − returned`; refund is pro-rata of `line_total`.
12. Returns update: stock, money OUT (sale) / IN-optional (purchase), ledgers, `sale.due`/`purchase.due`.

## Purchases

13. Purchase pushes FIFO layers, updates product cost (+ optional new selling price), optional batch/expiry rows.
14. `paid > total` is rejected. `due > 0` requires a supplier.

## Inventory

15. Every stock change writes `inventory_movements(prev → new)` with type/reason/ref/user.
16. Negative stock is blocked unless `businesses.negative_stock_allowed = 1`.
17. Adjustments/damage/loss/count all flow through the same movement engine + audit.

## Parties & money

18. Customer due = Σ(debit − credit); sale posts `debit=total, credit=paid`.
19. Supplier payable = Σ(credit − debit); purchase posts `credit=total, debit=paid`.
20. Transfers post matched OUT+IN atomically; same-account transfer rejected.
21. Expense edits post a visible reversal + new movement (no silent rewrites).

## MFS agent ledger (manual)

22. No live provider integration is claimed or attempted.
23. `CASH_IN`: cash IN (amount+charge), provider OUT (amount).
24. `CASH_OUT`: cash OUT (amount), provider IN (amount+charge).
25. Other types mirror like CASH_IN. Commission is tracked per row and counted as income in net profit.

## Numbers & dates

26. Invoice numbers: `{PREFIX}-{YEAR}-{000001}`, gapless per business counter (voids keep numbers).
27. Business timezone default `Asia/Dhaka`; presets resolve to inclusive local days → UTC bounds.
28. Aging buckets: current, 1–7, 8–30, 31–90, 90+ days.

## Safety

29. Destructive/financial actions need confirmation + permission + audit.
30. Master data with transaction history cannot be hard-deleted (archive/deactivate instead).
31. All user errors are Bengali (`src/shared/bn.ts`); raw SQL is never shown.
