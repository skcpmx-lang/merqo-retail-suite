/**
 * Business-brand invoice rule (spec §2): customer-facing documents must lead
 * with the merchant's configured business identity — never MERQO as the store.
 */
import { describe, it, expect } from 'vitest';
import { saleInvoiceHtml } from '../../src/renderer/components/PrintDocs';
import type { Business } from '../../src/shared/types';

const biz = {
  id: 1, name: 'Saima Orna House', owner_name: 'সাইমা', phone: '01700000000', email: 'shop@example.com',
  address: 'মিরপুর, ঢাকা', business_type: null, logo_path: 'data:image/png;base64,QUJD', currency: 'BDT',
  timezone: 'Asia/Dhaka', invoice_prefix: 'SOH', footer: 'ধন্যবাদ! আবার আসবেন।', terms: null, tax_default_bp: 0,
  tax_mode: 'off', negative_stock_allowed: 0, overpayment_policy: 'advance', digit_locale: 'bn',
  receipt_width: '80mm', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
} as unknown as Business;

const sale = {
  invoice_no: 'SOH-000001', sold_at: '2026-09-16T10:00:00.000Z',
  subtotal: 10000, discount: 0, tax: 0, total: 10000, paid: 10000, due: 0, change_amount: 0,
  customer_name: 'করিম মিয়া', employee_name: 'মালিক',
};

const items = [{ product_name: 'চাল (মিনিকেট)', qty_milli: 1000, unit_name: 'কেজি', unit_price: 1000, discount: 0, tax: 0, line_total: 1000 }];

describe('business-branded invoice', () => {
  it('A4 invoice leads with the merchant identity and embeds the business logo', () => {
    const html = saleInvoiceHtml(biz, sale, items, [{ method: 'cash', amount: 10000 }], 'A4');
    expect(html).toContain('class="brand">Saima Orna House</div>');
    expect(html).toContain('<img src="data:image/png;base64,QUJD"');
    // merchant contact block present
    expect(html).toContain('মিরপুর, ঢাকা');
    // MERQO must not appear as the merchant brand line
    expect(html).not.toMatch(/class="brand">[^<]*MERQO/);
  });

  it('thermal receipts carry the business name, not the product name, as header', () => {
    const html = saleInvoiceHtml(biz, sale, items, [], '80mm');
    expect(html).toContain('Saima Orna House');
  });
});
