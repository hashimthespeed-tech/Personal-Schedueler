import Anthropic from "@anthropic-ai/sdk";

/**
 * Opus 5 for every agent.
 *
 * The original plan put the specialists on a cheaper model. That was a cost
 * decision made on the user's behalf: at a few agent turns a day the
 * difference is pennies a month, and better tutoring and coaching is worth
 * more than the saving. Override with AGENT_MODEL if that stops being true.
 */
export const AGENT_MODEL = process.env.AGENT_MODEL ?? "claude-opus-5";

let cached: Anthropic | null = null;

/**
 * Strip what a paste into a hosting dashboard tends to carry along.
 *
 * A key with a trailing newline, or wrapped in quotes, is rejected with the
 * same 401 as a genuinely wrong key — so the error sends you looking at the
 * key itself when the value is fine and only its packaging is wrong.
 */
export function normalizeApiKey(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, "").trim();
}

export function anthropic(): Anthropic {
  const raw = process.env.ANTHROPIC_API_KEY;

  if (!raw || raw.trim() === "") {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env locally, or to your host's environment variables when deployed.",
    );
  }

  const apiKey = normalizeApiKey(raw);

  if (apiKey.startsWith("sk-ant-...") || apiKey === "sk-ant-...") {
    throw new Error(
      "ANTHROPIC_API_KEY is still the placeholder from .env.example. Replace it with a real key from console.anthropic.com.",
    );
  }

  if (!apiKey.startsWith("sk-ant-")) {
    throw new Error(
      `ANTHROPIC_API_KEY does not look like an Anthropic key — it starts with "${apiKey.slice(0, 8)}". ` +
        "Anthropic keys begin with sk-ant-. Check you copied it from console.anthropic.com and not another service.",
    );
  }

  cached ??= new Anthropic({ apiKey });
  return cached;
}

/** Turn an SDK error into something worth showing a user. */
export function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return (
      "Anthropic rejected the API key (401). Either it is wrong or revoked, or the " +
      "account has no credit. Check it at console.anthropic.com, and after changing " +
      "it on a host like Vercel, redeploy — environment variables only take effect " +
      "on a new deployment."
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Rate limited by Anthropic. Try again shortly.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `Bad request to Anthropic: ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach Anthropic. Check the network.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic error ${error.status}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
