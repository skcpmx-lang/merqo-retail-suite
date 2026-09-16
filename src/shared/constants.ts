/** MERQO domain constants: roles, permissions, transaction types. */

export const APP_NAME = 'MERQO Retail Suite';
export const BRAND = 'MERQO.';
export const APP_VERSION = '1.0.0';

export type Role = 'owner' | 'admin' | 'manager' | 'cashier' | 'sales' | 'inventory' | 'accountant';

export const ROLES: { id: Role; bn: string }[] = [
  { id: 'owner', bn: 'মালিক' },
  { id: 'admin', bn: 'অ্যাডমিন' },
  { id: 'manager', bn: 'ম্যানেজার' },
  { id: 'cashier', bn: 'ক্যাশিয়ার' },
  { id: 'sales', bn: 'বিক্রয়কর্মী' },
  { id: 'inventory', bn: 'স্টক কর্মী' },
  { id: 'accountant', bn: 'হিসাবরক্ষক' },
];

export const roleName = (r: string): string => ROLES.find((x) => x.id === r)?.bn ?? r;

/** Granular permission keys. */
export const PERMISSIONS = [
  'sale.create',
  'sale.return',
  'sale.void',
  'sale.discount',
  'sale.price_override',
  'sale.reprint',
  'purchase.create',
  'purchase.return',
  'product.create',
  'product.edit',
  'product.delete',
  'product.view_cost',
  'inventory.adjust',
  'inventory.count',
  'customer.create',
  'customer.edit',
  'customer.payment',
  'supplier.create',
  'supplier.edit',
  'supplier.payment',
  'expense.create',
  'expense.edit',
  'account.transfer',
  'account.manage',
  'mfs.create',
  'report.sales',
  'report.purchase',
  'report.inventory',
  'report.financial',
  'report.profit',
  'report.agent',
  'report.export',
  'user.manage',
  'permission.manage',
  'settings.edit',
  'backup.create',
  'backup.restore',
  'import.run',
  'audit.view',
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];

export const PERMISSION_BN: Record<PermissionKey, string> = {
  'sale.create': 'বিক্রয় করা',
  'sale.return': 'বিক্রয় ফেরত',
  'sale.void': 'ইনভয়েস বাতিল',
  'sale.discount': 'ছাড় দেওয়া',
  'sale.price_override': 'দাম পরিবর্তন',
  'sale.reprint': 'রসিদ পুনঃমুদ্রণ',
  'purchase.create': 'ক্রয় করা',
  'purchase.return': 'ক্রয় ফেরত',
  'product.create': 'পণ্য যোগ',
  'product.edit': 'পণ্য সম্পাদনা',
  'product.delete': 'পণ্য মুছে ফেলা',
  'product.view_cost': 'ক্রয়মূল্য দেখা',
  'inventory.adjust': 'স্টক সমন্বয়',
  'inventory.count': 'স্টক গণনা',
  'customer.create': 'কাস্টমার যোগ',
  'customer.edit': 'কাস্টমার সম্পাদনা',
  'customer.payment': 'কাস্টমার পেমেন্ট',
  'supplier.create': 'সরবরাহকারী যোগ',
  'supplier.edit': 'সরবরাহকারী সম্পাদনা',
  'supplier.payment': 'সরবরাহকারী পেমেন্ট',
  'expense.create': 'খরচ যোগ',
  'expense.edit': 'খরচ সম্পাদনা',
  'account.transfer': 'অ্যাকাউন্ট স্থানান্তর',
  'account.manage': 'অ্যাকাউন্ট ব্যবস্থাপনা',
  'mfs.create': 'এজেন্ট লেনদেন',
  'report.sales': 'বিক্রয় রিপোর্ট',
  'report.purchase': 'ক্রয় রিপোর্ট',
  'report.inventory': 'স্টক রিপোর্ট',
  'report.financial': 'আর্থিক রিপোর্ট',
  'report.profit': 'লাভ রিপোর্ট',
  'report.agent': 'এজেন্ট রিপোর্ট',
  'report.export': 'রিপোর্ট এক্সপোর্ট',
  'user.manage': 'ব্যবহারকারী ব্যবস্থাপনা',
  'permission.manage': 'অনুমতি ব্যবস্থাপনা',
  'settings.edit': 'সেটিংস পরিবর্তন',
  'backup.create': 'ব্যাকআপ তৈরি',
  'backup.restore': 'ব্যাকআপ পুনরুদ্ধার',
  'import.run': 'ইমপোর্ট করা',
  'audit.view': 'অডিট লগ দেখা',
};

/** Safe default permission matrix. Cashier is deliberately restricted. */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, PermissionKey[]> = {
  owner: [...PERMISSIONS],
  admin: [...PERMISSIONS],
  manager: [
    'sale.create', 'sale.return', 'sale.discount', 'sale.reprint',
    'purchase.create', 'purchase.return',
    'product.create', 'product.edit', 'product.view_cost',
    'inventory.adjust', 'inventory.count',
    'customer.create', 'customer.edit', 'customer.payment',
    'supplier.create', 'supplier.edit', 'supplier.payment',
    'expense.create', 'expense.edit',
    'account.transfer', 'mfs.create',
    'report.sales', 'report.purchase', 'report.inventory', 'report.financial', 'report.agent', 'report.export',
    'backup.create', 'import.run',
  ],
  cashier: ['sale.create', 'sale.reprint', 'customer.create', 'report.sales'],
  sales: ['sale.create', 'sale.reprint', 'customer.create', 'product.view_cost'],
  inventory: ['product.create', 'product.edit', 'inventory.adjust', 'inventory.count', 'purchase.create', 'report.inventory'],
  accountant: [
    'customer.payment', 'supplier.payment', 'expense.create', 'expense.edit',
    'account.transfer', 'account.manage', 'mfs.create',
    'report.sales', 'report.purchase', 'report.financial', 'report.profit', 'report.agent', 'report.export',
    'audit.view',
  ],
};

export type PaymentMethod = 'cash' | 'bank' | 'bkash' | 'nagad' | 'rocket' | 'upay' | 'card' | 'other';

export const PAYMENT_METHOD_BN: Record<PaymentMethod, string> = {
  cash: 'নগদ',
  bank: 'ব্যাংক',
  bkash: 'বিকাশ',
  nagad: 'নগদ',
  rocket: 'রকেট',
  upay: 'উপায়',
  card: 'কার্ড',
  other: 'অন্যান্য',
};

export type MfsProvider = 'bkash' | 'nagad' | 'rocket' | 'upay';
export const MFS_PROVIDERS: { id: MfsProvider; bn: string }[] = [
  { id: 'bkash', bn: 'বিকাশ' },
  { id: 'nagad', bn: 'নগদ' },
  { id: 'rocket', bn: 'রকেট' },
  { id: 'upay', bn: 'উপায়' },
];

export type MfsTxnType = 'CASH_IN' | 'CASH_OUT' | 'SEND_MONEY' | 'MERCHANT_PAYMENT' | 'OTHER';
export const MFS_TXN_BN: Record<MfsTxnType, string> = {
  CASH_IN: 'ক্যাশ ইন',
  CASH_OUT: 'ক্যাশ আউট',
  SEND_MONEY: 'সেন্ড মানি',
  MERCHANT_PAYMENT: 'মার্চেন্ট পেমেন্ট',
  OTHER: 'অন্যান্য',
};

export type MovementType =
  | 'OPENING'
  | 'PURCHASE'
  | 'SALE'
  | 'SALE_RETURN'
  | 'PURCHASE_RETURN'
  | 'DAMAGE'
  | 'LOST'
  | 'ADJUSTMENT'
  | 'COUNT';

export const MOVEMENT_BN: Record<MovementType, string> = {
  OPENING: 'প্রারম্ভিক স্টক',
  PURCHASE: 'ক্রয়',
  SALE: 'বিক্রয়',
  SALE_RETURN: 'বিক্রয় ফেরত',
  PURCHASE_RETURN: 'ক্রয় ফেরত',
  DAMAGE: 'ক্ষতিগ্রস্ত',
  LOST: 'হারানো',
  ADJUSTMENT: 'সমন্বয়',
  COUNT: 'গণনা',
};

export const EXPENSE_CATEGORIES_SEED = [
  'বাড়ি ভাড়া',
  'বিদ্যুৎ বিল',
  'ইন্টারনেট',
  'বেতন',
  'যাতায়াত',
  'প্যাকেজিং',
  'মেরামত',
  'মার্কেটিং',
  'বিবিধ',
];

export const UNITS_SEED = ['পিস', 'প্যাক', 'বাক্স', 'ডজন', 'কেজি', 'গ্রাম', 'লিটার', 'মিলি', 'মিটার', 'জোড়া'];

export const INVOICE_PREFIX_DEFAULT = 'MERQO';
