/**
 * "₱21.6K", "₱1.64M": chart labels only, where a full ₱1,636,023.20 would not
 * fit beside a phone-width chart. Never used for a figure the Admin acts on —
 * those go through <Money>.
 */
export function compactPesos(c: number): string {
  const pesos = c / 100
  const abs = Math.abs(pesos)
  const fmt = (n: number, unit: string) => `₱${Number(n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0)).toLocaleString('en-PH')}${unit}`
  if (abs >= 1e9) return fmt(pesos / 1e9, 'B')
  if (abs >= 1e6) return fmt(pesos / 1e6, 'M')
  if (abs >= 1e3) return fmt(pesos / 1e3, 'K')
  return `₱${Math.round(pesos).toLocaleString('en-PH')}`
}
