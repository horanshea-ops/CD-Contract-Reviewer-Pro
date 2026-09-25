export function titleCase(s: string): string {
  return s
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** Whole dollars with commas. Exposure figures are estimates, so cents would claim precision they don't have. */
export function formatCurrency(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}
