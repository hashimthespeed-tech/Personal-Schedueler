/**
 * Domain naming and colour lookup.
 *
 * Kept out of the chart components: those are client components, and a plain
 * helper exported from one cannot be called by a server page.
 */

const LABELS: Record<string, string> = {
  school: "School",
  deen: "Deen",
  ai: "AI",
  money: "Money",
  physique: "Physique",
};

export function domainLabel(domain: string): string {
  return LABELS[domain] ?? domain;
}

export function domainColor(domain: string): string {
  return `var(--color-${domain})`;
}
