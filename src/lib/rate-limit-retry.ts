/**
 * Retry LLM calls when the provider returns HTTP 429 / rate limit errors.
 * Prefers structured Retry-After headers over parsing error message text.
 */

const DEFAULT_MAX_RETRIES = 5;

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function getHeader(
  headers: Headers | Record<string, string> | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}

function errorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; error?: { code?: string } };
  return e.code ?? e.error?.code ?? null;
}

export function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const code = errorCode(err);
  if (code === "insufficient_quota") return false;

  const e = err as { status?: number; type?: string };
  if (e.status === 429) return true;
  if (code === "rate_limit_exceeded") return true;
  if (e.type === "rate_limit_error") return true;

  const msg = errorMessage(err);
  return /429/.test(msg) && /rate limit/i.test(msg);
}

/** Parse retry delay from response headers (milliseconds). */
export function parseRetryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;

  const headers = (err as { headers?: Headers | Record<string, string> }).headers;

  const retryAfterMs = getHeader(headers, "retry-after-ms");
  if (retryAfterMs) {
    const ms = parseFloat(retryAfterMs);
    if (!Number.isNaN(ms)) return Math.ceil(ms);
  }

  const retryAfter = getHeader(headers, "retry-after");
  if (retryAfter) {
    const seconds = parseFloat(retryAfter);
    if (!Number.isNaN(seconds)) return Math.ceil(seconds * 1000);
    const dateMs = Date.parse(retryAfter);
    if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  }

  // Last resort: OpenAI sometimes embeds the hint only in error.message (no header).
  const msg = errorMessage(err);
  const match = msg.match(/try again in ([\d.]+)s/i);
  if (match) {
    return Math.ceil(parseFloat(match[1]) * 1000);
  }

  return null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RateLimitRetryOptions {
  maxRetries?: number;
  label?: string;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Invoke fn, retrying on rate limit errors with provider-suggested or exponential backoff.
 * Prefer configuring OpenAI's built-in maxRetries; this wraps calls when extra retries/logging are needed.
 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  options: RateLimitRetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? Number(process.env.LLM_MAX_RETRIES ?? DEFAULT_MAX_RETRIES);
  const sleep = options.sleep ?? defaultSleep;
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= maxRetries) throw err;

      attempt++;
      const parsed = parseRetryAfterMs(err);
      const delay = parsed ?? Math.min(60_000, 5000 * 2 ** (attempt - 1));

      const label = options.label ? ` (${options.label})` : "";
      process.stderr.write(
        `  [llm] Rate limited${label} — retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt}/${maxRetries})\n`,
      );
      await sleep(delay);
    }
  }
}
