/** The numbers the answer cites, in the order it first cites them. */
export function citedNumbers(text: string): number[] {
  const seen: number[] = [];
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}
