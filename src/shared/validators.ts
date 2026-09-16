/** Input validation shared by main (enforced) and renderer (UX hints). */

export function isValidPhoneBD(phone: string | null | undefined): boolean {
  if (!phone) return true; // optional
  const s = phone.replace(/[\s-]/g, '');
  return /^(?:\+?880|0)1[3-9]\d{8}$/.test(s);
}

export function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function isValidBarcode(code: string | null | undefined): boolean {
  if (!code) return true;
  return /^[A-Za-z0-9\-_.]{3,64}$/.test(code.trim());
}

export function sanitizeText(s: string | null | undefined, max = 500): string | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!t) return null;
  return t.slice(0, max);
}

export function requireText(s: string | null | undefined, max = 500): string {
  const t = sanitizeText(s, max);
  if (!t) throw new Error('REQUIRED');
  return t;
}

/** Guard against path traversal in file names. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9_.\-() ]/g, '_').slice(0, 120) || 'file';
}
