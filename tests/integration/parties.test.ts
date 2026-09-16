/**
 * Flagship-hardening regression tests (spec §10, §11, §5, §36):
 *  - customer/supplier creation with fully-null optional fields (exact UI payload)
 *  - list sorting by due/payable (the released blocker: ORDER BY on a missing column
 *    made the Customers/Suppliers screens fail with a generic DB_ERROR)
 *  - persistence + searchability after creation
 *  - duplicate / invalid phone & email rejection with actionable codes
 *  - payment flows with running balances
 *  - professional, unambiguous payment terminology (cash ≠ Nagad MFS)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIsolatedDatabase, closeDatabase, type Db } from '../../src/main/db';
import { setUserDataRoot } from '../../src/main/paths';
import { AppError, type Ctx } from '../../src/main/services/_helpers';
import { runSetup } from '../../src/main/services/authService';
import {
  createCustomer, createSupplier, updateCustomer, listCustomers, listSuppliers,
  receiveCustomerPayment, paySupplier, customerLedger, supplierLedger,
} from '../../src/main/services/partyService';
import { listAccounts } from '../../src/main/services/accountService';
import { PAYMENT_METHOD_BN, PERMISSIONS } from '../../src/shared/constants';

let db: Db;
let tmpRoot: string;
let ctx: Ctx;
let cashId: number;

const codeOf = (fn: () => unknown): string => {
  try { fn(); } catch (e) { return (e as AppError).code; }
  throw new Error('expected AppError, none thrown');
};

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merqo-parties-'));
  setUserDataRoot(path.join(tmpRoot, 'userdata'));
  db = openIsolatedDatabase(path.join(tmpRoot, 'parties.db'));
  const s = runSetup(db, {
    business: { name: 'সাইমা অর্না হাউস' },
    openingBalances: { CASH: 5000000 },
    admin: { name: 'মালিক', username: 'owner', password: 'Passw0rd!' },
  });
  ctx = { businessId: s.business!.id, userId: s.user.id, permissions: [...PERMISSIONS] };
  const cash = listAccounts(db, ctx).find((a) => a.code === 'CASH');
  if (!cash) throw new Error('CASH account missing');
  cashId = cash.id;
});

afterAll(async () => {
  closeDatabase();
  for (let i = 0; i < 6; i++) {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 300)); }
  }
});

describe('customer creation (human-validation blocker)', () => {
  it('creates a customer with the exact UI payload (all optional fields null) and persists it', () => {
    const id = createCustomer(db, ctx, { name: 'করিম মিয়া', phone: null, address: null, email: null, opening_due: 0, notes: null });
    expect(id).toBeGreaterThan(0);
    const listed = listCustomers(db, ctx, { q: 'করিম', page: 1, pageSize: 50 });
    expect(listed.total).toBe(1);
    expect(listed.rows[0].name).toBe('করিম মিয়া');
  });

  it('lists customers sorted by due without SQL error (regression: ORDER BY due)', () => {
    const a = createCustomer(db, ctx, { name: 'বকেয়া কাস্টমার', phone: '01711111111', opening_due: 50000 });
    expect(a).toBeGreaterThan(0);
    const r = listCustomers(db, ctx, { sort: 'due', page: 1, pageSize: 50 });
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
    expect((r.rows[0] as { current_due?: number }).current_due).toBeGreaterThanOrEqual(50000);
  });

  it('rejects duplicate phone with actionable code', () => {
    createCustomer(db, ctx, { name: 'প্রথম', phone: '01811111111' });
    expect(codeOf(() => createCustomer(db, ctx, { name: 'দ্বিতীয়', phone: '01811111111' }))).toBe('PHONE_DUPLICATE');
  });

  it('rejects invalid phone / email with actionable codes', () => {
    expect(codeOf(() => createCustomer(db, ctx, { name: 'x', phone: '12345' }))).toBe('INVALID_PHONE');
    expect(codeOf(() => createCustomer(db, ctx, { name: 'x', email: 'not-an-email' }))).toBe('INVALID_EMAIL');
  });

  it('keeps optional contact details nullable on update', () => {
    const id = createCustomer(db, ctx, { name: 'নীরব গ্রাহক' });
    updateCustomer(db, ctx, id, { phone: null, address: null, email: null });
    const r = listCustomers(db, ctx, { q: 'নীরব' });
    expect(r.rows[0].phone).toBeNull();
  });

  it('receives payment and reduces running due (ledger initialized)', () => {
    const id = createCustomer(db, ctx, { name: 'পেমেন্ট গ্রাহক', phone: '01911111111', opening_due: 20000 });
    const res = receiveCustomerPayment(db, ctx, { customer_id: id, account_id: cashId, method: 'cash', amount: 8000 });
    expect(res.remaining_due).toBe(12000);
    const ledger = customerLedger(db, ctx, id, {});
    expect(ledger.rows.map((r) => r.ref_type)).toEqual(expect.arrayContaining(['OPENING', 'PAYMENT']));
  });
});

describe('supplier creation (human-validation blocker)', () => {
  it('creates a supplier with null optionals and persists it', () => {
    const id = createSupplier(db, ctx, { name: 'রহিম ট্রেডার্স', phone: null, address: null, email: null, opening_payable: 0, notes: null });
    expect(id).toBeGreaterThan(0);
    const listed = listSuppliers(db, ctx, { q: 'রহিম' });
    expect(listed.total).toBe(1);
  });

  it('lists suppliers sorted by payable without SQL error (regression: ORDER BY payable)', () => {
    createSupplier(db, ctx, { name: 'দেনাদার সরবরাহকারী', phone: '01722222222', opening_payable: 30000 });
    const r = listSuppliers(db, ctx, { sort: 'payable', page: 1, pageSize: 50 });
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
    expect((r.rows[0] as { current_payable?: number }).current_payable).toBeGreaterThanOrEqual(30000);
  });

  it('rejects duplicate supplier phone', () => {
    createSupplier(db, ctx, { name: 'এক', phone: '01833333333' });
    expect(codeOf(() => createSupplier(db, ctx, { name: 'দুই', phone: '01833333333' }))).toBe('PHONE_DUPLICATE');
  });

  it('pays supplier and reduces payable', () => {
    const id = createSupplier(db, ctx, { name: 'পেমেন্ট সরবরাহকারী', phone: '01922222222', opening_payable: 15000 });
    const res = paySupplier(db, ctx, { supplier_id: id, account_id: cashId, method: 'cash', amount: 5000 });
    expect(res.remaining_payable).toBe(10000);
    const ledger = supplierLedger(db, ctx, id, {});
    expect(ledger.rows.map((r) => r.ref_type)).toEqual(expect.arrayContaining(['OPENING', 'PAYMENT']));
  });
});

describe('professional payment terminology (spec §5)', () => {
  it('never labels physical cash and Nagad MFS identically', () => {
    expect(PAYMENT_METHOD_BN.cash).not.toBe(PAYMENT_METHOD_BN.nagad);
    expect(PAYMENT_METHOD_BN.cash).toBe('নগদ ক্যাশ');
    expect(PAYMENT_METHOD_BN.nagad).toBe('Nagad MFS');
    expect(PAYMENT_METHOD_BN.bkash).toBe('bKash');
    expect(PAYMENT_METHOD_BN.rocket).toBe('Rocket MFS');
    expect(PAYMENT_METHOD_BN.upay).toBe('Upay MFS');
    expect(PAYMENT_METHOD_BN.bank).toBe('ব্যাংক');
    expect(PAYMENT_METHOD_BN.card).toBe('কার্ড');
    expect(PAYMENT_METHOD_BN.other).toBe('অন্যান্য');
  });
});
