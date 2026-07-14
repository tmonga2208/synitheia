import type { z } from 'zod';
import type { Env } from '../config/env.js';

/**
 * The provider-agnostic AI boundary.
 *
 * Everything above this line — the insight generator, the expense extractor, the food
 * vision estimator — speaks only these types. Nothing above it imports an SDK or knows
 * which model answered. Adding a provider means adding one file under providers/ and a
 * line in the dispatcher; it means touching no domain code at all.
 *
 * This was previously an Anthropic-shaped interface wearing a provider-agnostic label.
 * Adding Gemini is what forced it to become honest.
 */

export type AiContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; base64: string };

/**
 * A JSON-Schema-ish description of the output we require.
 *
 * Deliberately the lowest common denominator: objects, arrays, strings, numbers,
 * booleans, enums, and nullability. Anything richer would be a feature of one provider
 * that the others would have to fake.
 */
export interface JsonSchema {
  type: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
}

export interface StructuredCall<T> {
  env: Env;
  system: string;
  content: AiContent[];
  /** A name for the output shape. Anthropic uses it as a tool name; Gemini ignores it. */
  outputName: string;
  outputDescription: string;
  /** What the model must return. Enforced by the provider where possible. */
  schema: JsonSchema;
  /**
   * The real gate. Whatever the provider produces is parsed through this, and anything
   * that fails is DROPPED rather than repaired — a half-parsed insight or a malformed
   * calorie estimate is worse than none, and providers disagree about how strictly they
   * honour a schema.
   */
  outputSchema: z.ZodType<T>;
  maxTokens?: number;
}

export interface AiProvider {
  readonly name: string;
  call<T>(request: StructuredCall<T>): Promise<T>;
}
