export function formatRow(sku: string, quantity: number, supplier: string): string {
  return `${sku.padEnd(12)} ${String(quantity).padStart(6)}  ${supplier}`;
}
