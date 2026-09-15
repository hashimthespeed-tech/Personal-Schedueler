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

export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env locally, or to your host's environment variables when deployed.",
    );
  }
  cached ??= new Anthropic();
  return cached;
}

/** Turn an SDK error into something worth showing a user. */
export function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY.";
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
