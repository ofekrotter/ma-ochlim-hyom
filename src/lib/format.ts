const nf = new Intl.NumberFormat('he-IL');
export const fmtCount = (n: number) => nf.format(n);
export const fmtRating = (r: number) => r.toFixed(1);
export const priceLabel = (p: 1 | 2 | 3 | null) => (p ? '₪'.repeat(p) : '');

/**
 * Address for display: no postal code and no country. Places sends some
 * addresses as "street, city, 6473917" (or an old 5-digit code), others without.
 */
export function cleanAddress(address: string | null | undefined): string {
  if (!address) return '';
  return address
    .split(',')
    .map((part) => part.trim().replace(/\s+\d{7}$/, ''))
    .filter((part) => part && !/^\d{5,7}$/.test(part) && !/^(ישראל|Israel)$/i.test(part))
    .join(', ');
}
