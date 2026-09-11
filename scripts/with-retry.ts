/**
 * Retries a failure that says nothing about the contract.
 *
 * DNS on this machine intermittently fails to resolve api.anthropic.com, and a
 * capture that gives up on the first one loses the whole run. A contract that
 * genuinely cannot be analysed still ends up recorded as failed, which is what
 * the scorer wants — its key items count as missed.
 */
export async function withRetry<T>(attempt: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let tries = 1; tries <= 4; tries++) {
    try {
      return await attempt();
    } catch (err) {
      last = err;
      console.log(`\n  attempt ${tries}/4 failed: ${err instanceof Error ? err.message : String(err)}`);
      if (tries < 4) await new Promise((resolve) => setTimeout(resolve, 10_000 * tries));
    }
  }
  throw last;
}
