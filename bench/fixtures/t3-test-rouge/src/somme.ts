/** Additionne deux nombres. */
export function somme(a: number, b: number): number {
  // BUG volontaire : l'opérateur est faux. Le test doit rester rouge.
  return a - b;
}
