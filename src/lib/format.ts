const nf = new Intl.NumberFormat('he-IL');
export const fmtCount = (n: number) => nf.format(n);
export const fmtRating = (r: number) => r.toFixed(1);
export const priceLabel = (p: 1 | 2 | 3 | null) => (p ? '₪'.repeat(p) : '');
