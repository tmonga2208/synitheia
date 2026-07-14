import { AppError } from '../core/errors.js';
import { anthropicProvider } from './providers/anthropic.js';
import { geminiProvider } from './providers/gemini.js';
import type { AiProvider, StructuredCall } from './types.js';
import type { Env } from '../config/env.js';

export type { AiContent, JsonSchema } from './types.js';

/**
 * The one place this service talks to a model provider.
 *
 * "Synítheia AI" is our product name for this layer, not a third-party service. Which
 * model actually answers is a deployment detail: the domain code above this file — the
 * insight generator, the expense extractor, the food estimator — cannot tell, and does
 * not import an SDK.
 *
 * Two invariants hold for every call, whichever provider serves it:
 *
 *   - Structured output only, validated with zod. A response that does not validate is
 *     DROPPED, not coerced and not repaired. Providers differ in how strictly they
 *     honour a schema; they do not differ in what we are willing to show a user.
 *
 *   - No arithmetic. Every number the model sees was computed deterministically in
 *     application code. It interprets; it does not calculate.
 */

const PROVIDERS: Record<string, AiProvider> = {
  anthropic: anthropicProvider,
  gemini: geminiProvider,
};

/**
 * Resolve the provider for this deployment.
 *
 * Explicit `AI_PROVIDER` wins. Otherwise we pick whichever key is actually present,
 * because the most common failure here is a key set with no matching provider selected
 * — a silent no-op that looks like the feature is broken.
 */
export function resolveProvider(env: Env): AiProvider | null {
  if (env.AI_PROVIDER) {
    const chosen = PROVIDERS[env.AI_PROVIDER];
    if (!chosen) return null;

    const hasKey =
      env.AI_PROVIDER === 'anthropic' ? Boolean(env.ANTHROPIC_API_KEY) : Boolean(env.GEMINI_API_KEY);

    return hasKey ? chosen : null;
  }

  if (env.GEMINI_API_KEY) return geminiProvider;
  if (env.ANTHROPIC_API_KEY) return anthropicProvider;
  return null;
}

export async function callStructured<T>(request: StructuredCall<T>): Promise<T> {
  const provider = resolveProvider(request.env);

  if (!provider) {
    throw AppError.aiUnavailable('Synítheia AI is not configured on this server');
  }

  return provider.call(request);
}
