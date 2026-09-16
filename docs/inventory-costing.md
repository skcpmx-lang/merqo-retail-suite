# MERQO — Inventory Costing (FIFO)

## Layers

`cost_layers(product, purchase, qty_milli_remaining, unit_cost)` — one row per
purchase receipt (and per opening-stock import, per positive adjustment, per
sale-return restock at original cost).

## Consumption

On sale, layers are consumed oldest-first. Each `sale_item` stores the
weighted-average `unit_cost` actually consumed, so profit is computed from
real historical cost — never `selling − current purchase price`.

Shortfalls (stock without layers, e.g. legacy data) fall back to the
product's current `purchase_price` for that portion only.

## Reversals

- **Sale return**: pushes a new layer at the original `unit_cost`.
- **Sale void**: same, for net (unreturned) quantities.
- **Purchase return / void**: removes from newest layers first.

## Valuation

Stock value report uses last-cost valuation (`stock × purchase_price`) —
simple, explainable, and stable. FIFO layers drive COGS/profit only.

## Reports

Product/category profit reports show revenue, COGS, and margin from the
stored per-item costs, reconciling to gross profit by construction.
