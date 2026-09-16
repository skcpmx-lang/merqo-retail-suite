import { formatMoney } from '@shared/money';
import { formatQty } from '@shared/qty';
import { PAYMENT_METHOD_BN } from '@shared/constants';
import type { Business } from '@shared/types';

/** Standalone print documents. `__MQ_FONT__` is replaced by main with embedded font CSS. */

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrap(title: string, css: string, body: string): string {
  return `<!DOCTYPE html><html lang="bn"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>/*__MQ_FONT__*/
${css}</style></head><body>${body}
<script>window.onload=()=>{document.title=${JSON.stringify(title)}};</script></body></html>`;
}

const BASE_CSS = `
body{font-family:'Noto Sans Bengali','Segoe UI',sans-serif;color:#111;margin:0;padding:0;}
table{border-collapse:collapse;width:100%;}
.muted{color:#555;}
.center{text-align:center;} .right{text-align:right;}
.num{font-variant-numeric:tabular-nums;}
`;

export interface InvoiceItemRow {
  product_name: string;
  qty_milli: number;
  unit_name?: string | null;
  unit_price: number;
  discount: number;
  tax: number;
  line_total: number;
}

export function saleInvoiceHtml(biz: Business, sale: Record<string, unknown>, items: InvoiceItemRow[], payments: Record<string, unknown>[], paper: 'A4' | '80mm' | '58mm'): string {
  const m = (v: unknown): string => formatMoney(Number(v ?? 0));
  const dt = new Date(String(sale.sold_at)).toLocaleString('bn-BD', { timeZone: biz.timezone || 'Asia/Dhaka' });
  const payNames = payments.map((p) => `${PAYMENT_METHOD_BN[(p.method as string) as keyof typeof PAYMENT_METHOD_BN] || p.method}: ${m(p.amount)}`).join(', ') || '—';

  if (paper === 'A4') {
    const css = BASE_CSS + `
body{padding:32px;}
.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0e63b6;padding-bottom:14px;margin-bottom:14px;}
.brand{font-size:26px;font-weight:800;} .brand small{font-size:13px;color:#0e63b6;}
.meta{font-size:12.5px;color:#333;line-height:1.7;}
.inv-title{font-size:20px;font-weight:800;margin:12px 0 8px;}
th{background:#f0f4f9;font-size:12.5px;padding:9px 8px;border:1px solid #d5dce6;text-align:left;}
td{font-size:13px;padding:8px;border:1px solid #d5dce6;}
.tot{width:320px;margin-left:auto;margin-top:12px;font-size:13.5px;}
.tot td{border:none;padding:4px 2px;}
.grand{font-size:17px;font-weight:800;border-top:2px solid #0e63b6 !important;}
.footer{margin-top:22px;font-size:12px;color:#444;border-top:1px dashed #aaa;padding-top:10px;}
`;
    const rows = items.map((it, i) => `<tr><td class="center">${i + 1}</td><td>${esc(it.product_name)}</td><td class="right num">${formatQty(it.qty_milli)} ${esc(it.unit_name || '')}</td><td class="right num">${m(it.unit_price)}</td><td class="right num">${m(it.discount)}</td><td class="right num">${m(it.line_total)}</td></tr>`).join('');
    const body = `
<div class="hd"><div style="display:flex;align-items:flex-start;gap:14px">${/^data:image\//.test(String(biz.logo_path || '')) ? `<img src="${esc(biz.logo_path)}" alt="" style="width:64px;height:64px;object-fit:contain;object-position:center;border-radius:10px" />` : ''}<div><div class="brand">${esc(biz.name)}</div>
<div class="meta">${esc(biz.address || '')}<br>ফোন: ${esc(biz.phone || '—')}${biz.email ? ' • ' + esc(biz.email) : ''}</div></div></div>
<div class="right meta"><strong>ইনভয়েস:</strong> ${esc(sale.invoice_no)}<br><strong>তারিখ:</strong> ${esc(dt)}<br><strong>কাস্টমার:</strong> ${esc((sale.customer_name as string) || 'ওয়াক-ইন')}<br><strong>বিক্রেতা:</strong> ${esc((sale.employee_name as string) || '—')}</div></div>
<div class="inv-title">বিক্রয় ইনভয়েস</div>
<table><thead><tr><th style="width:40px">ক্র.</th><th>পণ্য</th><th class="right">পরিমাণ</th><th class="right">দর</th><th class="right">ছাড়</th><th class="right">মোট</th></tr></thead><tbody>${rows}</tbody></table>
<table class="tot">
<tr><td>উপমোট:</td><td class="right num">${m(sale.subtotal)}</td></tr>
<tr><td>ছাড়:</td><td class="right num">${m(sale.discount)}</td></tr>
<tr><td>ভ্যাট/ট্যাক্স:</td><td class="right num">${m(sale.tax)}</td></tr>
<tr><td class="grand">সর্বমোট:</td><td class="right num grand">${m(sale.total)}</td></tr>
<tr><td>পরিশোধ:</td><td class="right num">${m(sale.paid)}</td></tr>
<tr><td>বকেয়া:</td><td class="right num">${m(sale.due)}</td></tr>
${Number(sale.change_amount) > 0 ? `<tr><td>ফেরত:</td><td class="right num">${m(sale.change_amount)}</td></tr>` : ''}
</table>
<div class="meta" style="margin-top:8px"><strong>পেমেন্ট:</strong> ${esc(payNames)}</div>
<div class="footer">${esc(biz.footer || 'ধন্যবাদ! আবার আসবেন।')}<br><span class="muted">${esc(biz.terms || '')}</span><br><br><div style="display:flex;justify-content:space-between"><span>ক্রেতার স্বাক্ষর</span><span>বিক্রেতার স্বাক্ষর</span></div></div>`;
    return wrap(`ইনভয়েস ${sale.invoice_no}`, css, body);
  }

  // Thermal 58/80mm — compact, purpose-built
  const width = paper === '58mm' ? '54mm' : '72mm';
  const fs = paper === '58mm' ? '11px' : '12px';
  const css = BASE_CSS + `
@page{size:auto;margin:0;}
body{width:${width};margin:0 auto;padding:6px 4px;font-size:${fs};line-height:1.5;}
h1{font-size:${paper === '58mm' ? '15px' : '17px'};margin:2px 0;}
h2{font-size:${fs};margin:2px 0;}
hr{border:none;border-top:1px dashed #000;margin:6px 0;}
table{font-size:${fs};}
td{padding:1.5px 0;vertical-align:top;}
.tot td{font-weight:700;}
.grand{font-size:${paper === '58mm' ? '14px' : '16px'};}
.small{font-size:${paper === '58mm' ? '9.5px' : '10.5px'};}
`;
  const rows = items.map((it) => `<tr><td colspan="2">${esc(it.product_name)}<br><span class="small muted">${formatQty(it.qty_milli)} ${esc(it.unit_name || '')} × ${m(it.unit_price)}${it.discount ? ' (ছাড় ' + m(it.discount) + ')' : ''}</span></td><td class="right num">${m(it.line_total)}</td></tr>`).join('');
  const body = `
<div class="center"><h1>${esc(biz.name)}</h1><div>${esc(biz.address || '')}</div><div>ফোন: ${esc(biz.phone || '—')}</div><h2>বিক্রয় রসিদ</h2></div><hr>
<div>ইনভয়েস: <strong>${esc(sale.invoice_no)}</strong><br>তারিখ: ${esc(dt)}<br>কাস্টমার: ${esc((sale.customer_name as string) || 'ওয়াক-ইন')}</div><hr>
<table>${rows}</table><hr>
<table class="tot">
<tr><td>উপমোট</td><td class="right num">${m(sale.subtotal)}</td></tr>
${Number(sale.discount) ? `<tr><td>ছাড়</td><td class="right num">${m(sale.discount)}</td></tr>` : ''}
${Number(sale.tax) ? `<tr><td>ভ্যাট</td><td class="right num">${m(sale.tax)}</td></tr>` : ''}
<tr><td class="grand">মোট</td><td class="right num grand">${m(sale.total)}</td></tr>
<tr><td>পরিশোধ</td><td class="right num">${m(sale.paid)}</td></tr>
<tr><td>বকেয়া</td><td class="right num">${m(sale.due)}</td></tr>
${Number(sale.change_amount) > 0 ? `<tr><td>ফেরত</td><td class="right num">${m(sale.change_amount)}</td></tr>` : ''}
</table><hr>
<div class="small">পেমেন্ট: ${esc(payNames)}</div><hr>
<div class="center">${esc(biz.footer || 'ধন্যবাদ! আবার আসবেন।')}<br><span class="small muted">MERQO Retail Suite</span></div>`;
  return wrap(`রসিদ ${sale.invoice_no}`, css, body);
}

export function purchaseHtml(biz: Business, pur: Record<string, unknown>, items: Record<string, unknown>[]): string {
  const m = (v: unknown): string => formatMoney(Number(v ?? 0));
  const dt = new Date(String(pur.purchased_at)).toLocaleString('bn-BD', { timeZone: biz.timezone || 'Asia/Dhaka' });
  const css = BASE_CSS + `
body{padding:32px;} .hd{border-bottom:3px solid #0e63b6;padding-bottom:12px;margin-bottom:12px;}
.brand{font-size:24px;font-weight:800;}
th{background:#f0f4f9;font-size:12.5px;padding:8px;border:1px solid #d5dce6;text-align:left;}
td{font-size:13px;padding:7px 8px;border:1px solid #d5dce6;}
.tot{width:320px;margin-left:auto;margin-top:12px;} .tot td{border:none;}
.grand{font-size:16px;font-weight:800;border-top:2px solid #0e63b6 !important;}`;
  const rows = (items as { product_name: string; qty_milli: number; unit_cost: number; line_total: number }[]).map((it, i) =>
    `<tr><td class="center">${i + 1}</td><td>${esc(it.product_name)}</td><td class="right num">${formatQty(it.qty_milli)}</td><td class="right num">${m(it.unit_cost)}</td><td class="right num">${m(it.line_total)}</td></tr>`).join('');
  const body = `<div class="hd"><div class="brand">${esc(biz.name)}</div>
<div class="muted">${esc(biz.address || '')} • ফোন: ${esc(biz.phone || '—')}</div></div>
<h2>ক্রয় রেকর্ড — ${esc(pur.reference)}</h2>
<div>তারিখ: ${esc(dt)} • সরবরাহকারী: ${esc((pur.supplier_name as string) || '—')} • সরবরাহকারী ইনভয়েস: ${esc((pur.supplier_invoice as string) || '—')}</div><br>
<table><thead><tr><th>ক্র.</th><th>পণ্য</th><th class="right">পরিমাণ</th><th class="right">ক্রয়দর</th><th class="right">মোট</th></tr></thead><tbody>${rows}</tbody></table>
<table class="tot"><tr><td>উপমোট:</td><td class="right num">${m(pur.subtotal)}</td></tr>
<tr><td>ছাড়:</td><td class="right num">${m(pur.discount)}</td></tr>
<tr><td class="grand">সর্বমোট:</td><td class="right num grand">${m(pur.total)}</td></tr>
<tr><td>পরিশোধ:</td><td class="right num">${m(pur.paid)}</td></tr>
<tr><td>বকেয়া:</td><td class="right num">${m(pur.due)}</td></tr></table>`;
  return wrap(`ক্রয় ${pur.reference}`, css, body);
}

export function paymentReceiptHtml(biz: Business, kind: 'customer' | 'supplier', ref: Record<string, unknown>, partyName: string, prevBalance: number, remaining: number): string {
  const m = (v: unknown): string => formatMoney(Number(v ?? 0));
  const dt = new Date(String(ref.paid_at)).toLocaleString('bn-BD', { timeZone: biz.timezone || 'Asia/Dhaka' });
  const css = BASE_CSS + `
body{padding:32px;max-width:640px;margin:0 auto;} .box{border:2px solid #0e63b6;border-radius:12px;padding:24px;}
.brand{font-size:22px;font-weight:800;} h2{color:#0e63b6;}
.kv{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #ccd;font-size:14px;}
.grand{font-size:18px;font-weight:800;}`;
  const body = `<div class="box"><div class="brand">${esc(biz.name)}</div>
<div class="muted">${esc(biz.address || '')} • ${esc(biz.phone || '')}</div>
<h2>${kind === 'customer' ? 'পেমেন্ট গ্রহণ রসিদ' : 'পেমেন্ট প্রদান রসিদ'}</h2>
<div class="kv"><span>রেফারেন্স</span><strong>${esc(ref.reference)}</strong></div>
<div class="kv"><span>তারিখ</span><strong>${esc(dt)}</strong></div>
<div class="kv"><span>${kind === 'customer' ? 'কাস্টমার' : 'সরবরাহকারী'}</span><strong>${esc(partyName)}</strong></div>
<div class="kv"><span>মাধ্যম</span><strong>${esc(PAYMENT_METHOD_BN[(ref.method as string) as keyof typeof PAYMENT_METHOD_BN] || String(ref.method))} (${esc(String(ref.account_name || ''))})</strong></div>
<div class="kv"><span>পূর্বের ${kind === 'customer' ? 'বকেয়া' : 'দেনা'}</span><strong>${m(prevBalance)}</strong></div>
<div class="kv grand"><span>পেমেন্ট</span><strong>${m(ref.amount)}</strong></div>
<div class="kv"><span>অবশিষ্ট ${kind === 'customer' ? 'বকেয়া' : 'দেনা'}</span><strong>${m(remaining)}</strong></div>
<br><div style="display:flex;justify-content:space-between"><span>গ্রহণকারীর স্বাক্ষর</span><span>প্রদানকারীর স্বাক্ষর</span></div></div>`;
  return wrap(`রসিদ ${ref.reference}`, css, body);
}

export function reportPrintHtml(biz: Business, title: string, meta: string, headers: string[], rows: string[][], footer?: string): string {
  const css = BASE_CSS + `
body{padding:28px;} .hd{text-align:center;border-bottom:3px solid #0e63b6;padding-bottom:10px;margin-bottom:10px;}
.brand{font-size:22px;font-weight:800;} h2{margin:8px 0 2px;}
th{background:#f0f4f9;font-size:12px;padding:7px;border:1px solid #c9d2e0;text-align:left;}
td{font-size:12px;padding:6px 7px;border:1px solid #d5dce6;}
.meta{font-size:12px;color:#444;text-align:center;margin-bottom:10px;}`;
  const body = `<div class="hd"><div class="brand">${esc(biz.name)}</div><div class="muted">${esc(biz.address || '')} • ${esc(biz.phone || '')}</div></div>
<h2 class="center">${esc(title)}</h2><div class="meta">${esc(meta)}</div>
<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>
${footer ? `<div style="margin-top:10px;font-size:12.5px">${footer}</div>` : ''}
<div class="muted" style="margin-top:14px;font-size:11px">তৈরি: ${new Date().toLocaleString('bn-BD')} • MERQO Retail Suite</div>`;
  return wrap(title, css, body);
}
