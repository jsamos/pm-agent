export interface TokenBucketOptions {
  limit: number;
  windowMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface WindowEntry {
  timestamp: number;
  tokens: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TokenBucket {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private entries: WindowEntry[] = [];

  constructor(options: TokenBucketOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs ?? 60_000;
    this.sleep = options.sleep ?? defaultSleep;
  }

  usedTokens(now = Date.now()): number {
    this.prune(now);
    return this.entries.reduce((sum, entry) => sum + entry.tokens, 0);
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    this.entries = this.entries.filter((entry) => entry.timestamp > cutoff);
  }

  /** Wait until `tokens` fit in the rolling window, then reserve them. */
  async acquire(tokens: number): Promise<void> {
    if (tokens <= 0) return;

    while (true) {
      const now = Date.now();
      this.prune(now);
      const used = this.usedTokens(now);

      if (used + tokens <= this.limit) {
        this.entries.push({ timestamp: now, tokens });
        return;
      }

      const oldest = this.entries[0];
      const waitMs = oldest
        ? Math.max(1, oldest.timestamp + this.windowMs - now + 1)
        : 100;

      process.stderr.write(
        `  [llm] TPM wait — ${(waitMs / 1000).toFixed(1)}s (${used}/${this.limit} used, reserving ~${tokens})\n`,
      );
      await this.sleep(waitMs);
    }
  }

  /** Reconcile reservation with actual usage after the call completes. */
  record(actualTokens: number, reservedTokens: number): void {
    const adjustment = actualTokens - reservedTokens;
    if (adjustment === 0) return;
    this.entries.push({ timestamp: Date.now(), tokens: adjustment });
  }

  /** Align local tracking when OpenAI reports remaining TPM budget. */
  syncFromHeaders(remainingTokens: number | null): void {
    if (remainingTokens == null || !Number.isFinite(remainingTokens)) return;

    const now = Date.now();
    this.prune(now);
    const localUsed = this.usedTokens(now);
    const providerUsed = this.limit - remainingTokens;

    if (providerUsed > localUsed) {
      this.entries.push({ timestamp: now, tokens: providerUsed - localUsed });
    }
  }
}

export function tokenEstimate(): number {
  const n = Number(process.env.LLM_TOKEN_ESTIMATE ?? 3000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3000;
}

export function tpmLimitFromEnv(): number | null {
  const raw = process.env.OPENAI_TPM_LIMIT;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
