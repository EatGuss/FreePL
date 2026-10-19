/** Prices are integer tenths of £1m (75 = £7.5m). Formatting never divides by 10. */
export function formatPrice(tenths: number): string {
  if (!Number.isInteger(tenths) || tenths < 0) throw new Error(`price must be a non-negative integer in tenths, got ${tenths}`);
  return `£${Math.floor(tenths / 10)}.${tenths % 10}m`;
}
