# MERQO — Import Format (CSV)

Settings → Data → pick type → **টেমপ্লেট নিন** → fill → **ফাইল নির্বাচন ও প্রিভিউ** → confirm.

Files: UTF-8 (BOM ok) `.csv`, ≤ 10MB, ≤ 5000 rows. Parsed with a strict
built-in parser; never executed. Only valid rows import, transactionally.

## Products — header

```
name,sku,barcode,category,brand,unit,purchase_price,selling_price,opening_stock,min_stock
```

- `name` required. Prices in taka (decimals ok). `opening_stock`/`min_stock`
  in units (fractions ok). Unknown category/brand/unit names are created.
- Duplicate SKU/barcode rows are skipped and counted.

## Customers — header

```
name,phone,address,opening_due
```

- `name` required; `opening_due` in taka → creates an OPENING ledger row.

## Suppliers — header

```
name,phone,address,opening_payable
```

- Same semantics as customers (payable side).

## Exports

- CSV (BOM for Excel): products, sales, customers, suppliers.
- XLSX via local exceljs: any report grid (headers + rows).
- PDF/print: invoices, receipts, reports, statements.
- Exports respect `report.export` permission.
