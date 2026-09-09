/**
 * §1.10 — the AI-use provision pre-check. Runs entirely locally, before any
 * network call: a document may restrict AI-assisted or automated review, and
 * the model itself can't be the one to check that (same circularity as using
 * AI to strip PII before sending to AI).
 *
 * A match here doesn't decide anything — it stops the pipeline before the
 * model call and hands the matched language to an associate, who decides
 * whether to proceed (lib/analysis-pipeline.ts, app/api/analyses/[id]/ai-clause-decision/route.ts).
 */

export interface AiUseMatch {
  term: string;
  excerpt: string;
  matchStart: number;
  matchLength: number;
}

// §1.10.2's list verbatim. Word boundaries are load-bearing: \bAI\b must not
// match inside "chair", "available", or "detail" — JS's \b already handles
// this correctly against \w boundaries, so no custom logic is needed here,
// just not breaking the boundary when adding a term.
const AI_USE_TERMS: RegExp[] = [
  /\bartificial intelligence\b/i,
  /\bmachine learning\b/i,
  /\blarge language model\b/i,
  /\bgenerative (ai|artificial)\b/i,
  /\bautomated (processing|decision)/i,
  /\balgorithmic\b/i,
  /\bAI\b/i,
  /\bLLM\b/i,
  /\b(text|data) mining\b/i,
  /\btrain(ing)? (a |any )?model\b/i,
  /\bnatural language processing\b/i,
];

// §1.10.5 — adjacent language that doesn't block anything, but feeds the
// pending client confidentiality review (see ROADMAP.md). Recorded now
// because retrofitting it onto documents already processed isn't possible;
// nothing surfaces it in the UI yet since that review process doesn't exist.
const ADJACENT_TERMS: RegExp[] = [
  /\bthird[- ]party (processor|service provider|vendor)\b/i,
  /\bpermitted recipients?\b/i,
  /\bconfidential information\b/i,
  /\bdata residency\b/i,
  /\bdata localization\b/i,
  /\bpersonally identifiable information\b/i,
];

const EXCERPT_RADIUS = 200;

function excerptAround(text: string, start: number, length: number): { excerpt: string; matchStart: number; matchLength: number } {
  const rawStart = Math.max(0, start - EXCERPT_RADIUS);
  const rawEnd = Math.min(text.length, start + length + EXCERPT_RADIUS);

  // Extend outward to the edges of whatever word rawStart/rawEnd landed
  // inside, so the excerpt never opens or closes mid-word. This only ever
  // grows the window (never shrinks it), so it can't cut a match in half —
  // capped defensively against a pathological run of non-whitespace input.
  let windowStart = rawStart;
  while (windowStart > 0 && /\S/.test(text[windowStart - 1]) && rawStart - windowStart < 40) windowStart--;
  let windowEnd = rawEnd;
  while (windowEnd < text.length && /\S/.test(text[windowEnd]) && windowEnd - rawEnd < 40) windowEnd++;

  const prefix = windowStart > 0 ? "…" : "";
  const suffix = windowEnd < text.length ? "…" : "";
  const excerpt = prefix + text.slice(windowStart, windowEnd) + suffix;

  return {
    excerpt,
    matchStart: prefix.length + (start - windowStart),
    matchLength: length,
  };
}

function scan(text: string, patterns: RegExp[]): AiUseMatch[] {
  const matches: AiUseMatch[] = [];
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    for (const m of text.matchAll(re)) {
      if (m.index == null) continue;
      const { excerpt, matchStart, matchLength } = excerptAround(text, m.index, m[0].length);
      matches.push({ term: m[0], excerpt, matchStart, matchLength });
    }
  }
  return matches;
}

export function scanForAiUseTerms(text: string): AiUseMatch[] {
  return scan(text, AI_USE_TERMS);
}

export function scanForAdjacentTerms(text: string): AiUseMatch[] {
  return scan(text, ADJACENT_TERMS);
}
