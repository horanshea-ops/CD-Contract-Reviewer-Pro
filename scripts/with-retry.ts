/**
 * Tries a call again after a failure that says nothing about the contract.
 *
 * DNS on this machine intermittently fails to resolve api.anthropic.com, and a
 * capture that gives up on the first one loses the whole run. A contract that
 * genuinely cannot be analysed still ends up recorded as failed, which is what
 * the scorer wants — its key items count as missed.
 *
 * A try that got as far as the model is billed whether or not it returns, so
 * the caller says how many tries it is willing to pay for. The default is 4.
 */
export async function withRetry<T>(attempt: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let n = 1; n <= tries; n++) {
    try {
      return await attempt();
    } catch (err) {
      last = err;
      console.log(`\n  attempt ${n}/${tries} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (n < tries) await new Promise((resolve) => setTimeout(resolve, 10_000 * n));
    }
  }
  throw last;
}

/** Sonnet rates, in dollars per million tokens. Sonnet 5 and Sonnet 5.5 cost the same. */
const RATE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

/** What a call cost, from its token counts. */
export function costOf(tokens: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }): number {
  return (
    ((tokens.input ?? 0) * RATE.input +
      (tokens.output ?? 0) * RATE.output +
      (tokens.cacheRead ?? 0) * RATE.cacheRead +
      (tokens.cacheWrite ?? 0) * RATE.cacheWrite) /
    1_000_000
  );
}
