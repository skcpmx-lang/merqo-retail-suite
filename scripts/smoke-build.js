// Post-build smoke test: exercises the COMPILED output in dist/ (not TS sources).
// Fails the process (exit 1) on any error. Run after `npm run build`.
// Usage: node scripts/smoke-build.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
for (const f of ['dist/main/main.js', 'dist/preload/preload.js', 'dist/renderer/index.html']) {
  if (!fs.existsSync(path.join(root, f))) {
    console.error(`SMOKE FAIL: missing ${f}`);
    process.exit(1);
  }
}
const html = fs.readFileSync(path.join(root, 'dist/renderer/index.html'), 'utf8');
if (!/\.\/assets\//.test(html)) {
  console.error('SMOKE FAIL: renderer bundle does not use relative asset paths');
  process.exit(1);
}

const { openIsolatedDatabase } = require(path.join(root, 'dist/main/db.js'));
const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'merqo-smoke-')), 'smoke.db');
const db = openIsolatedDatabase(tmpFile);
try {
  const auth = require(path.join(root, 'dist/main/services/authService.js'));
  const s = auth.runSetup(db, {
    business: { name: 'স্মোক টেস্ট' },
    admin: { name: 'মালিক', username: 'owner', password: 'Passw0rd!' },
  });
  const { PERMISSIONS } = require(path.join(root, 'dist/shared/constants.js'));
  const ctx = { businessId: s.business.id, userId: s.user.id, permissions: [...PERMISSIONS] };
  const prod = require(path.join(root, 'dist/main/services/productService.js'));
  const pid = prod.createProduct(db, ctx, {
    name: 'চাল', purchase_price: 5000, selling_price: 7000, opening_stock_milli: 2000,
  });
  const sales = require(path.join(root, 'dist/main/services/salesService.js'));
  const inv = sales.completeSale(db, ctx, {
    items: [{ product_id: pid, qty_milli: 1000, unit_price: 7000 }],
    payments: [{ account_id: 1, method: 'cash', amount: 7000 }],
  });
  const stock = db.prepare('SELECT stock_milli FROM products WHERE id=?').get(pid).stock_milli;
  if (inv.total !== 7000 || stock !== 1000) throw new Error(`unexpected totals: ${inv.total}/${stock}`);
  console.log(`SMOKE OK: invoice=${inv.invoice_no} total=${inv.total} stock_left=${stock}`);
} finally {
  db.close();
  try { fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true }); } catch { /* ignore */ }
}
