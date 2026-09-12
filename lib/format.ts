export function titleCase(s: string): string {
  return s
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}
