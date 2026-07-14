import { AppError } from '../../core/errors.js';
import type { AiContent, AiProvider, JsonSchema, StructuredCall } from '../types.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini, via REST.
 *
 * No SDK: the surface we need is one POST, and a dependency that wraps it would be one
 * more thing to keep in step with a fast-moving API for no benefit.
 *
 * Gemini expresses structured output as a `responseSchema` on the request rather than
 * as a forced tool call, so the two providers differ in *how* the shape is enforced.
 * They do not differ in whether it is: both results are parsed through the same zod
 * schema, and anything failing it is dropped.
 */

interface GeminiSchema {
  type: string;
  description?: string;
  nullable?: boolean;
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
  required?: string[];
  enum?: string[];
}

const TYPE_MAP: Record<string, string> = {
  object: 'OBJECT',
  array: 'ARRAY',
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
};

/**
 * Translate our lowest-common-denominator schema into Gemini's dialect.
 *
 * The one real mismatch: we express an optional field as `type: ['string', 'null']`
 * (JSON Schema's union), while Gemini wants `nullable: true` on a single type. Getting
 * this wrong is not a loud failure — Gemini rejects the whole request with a schema
 * error — so it is handled here rather than at each call site.
 */
function toGeminiSchema(schema: JsonSchema): GeminiSchema {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const nullable = types.includes('null');
  const primary = types.find((t) => t !== 'null') ?? 'string';

  const out: GeminiSchema = { type: TYPE_MAP[primary] ?? 'STRING' };

  if (nullable) out.nullable = true;
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.required?.length) out.required = schema.required;
  if (schema.items) out.items = toGeminiSchema(schema.items);

  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
  }

  return out;
}

/** Exported for tests only — the schema translation is where a silent 400 comes from. */
export const __toGeminiSchemaForTests = toGeminiSchema;

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

function toParts(content: AiContent[]): GeminiPart[] {
  return content.map((c) =>
    c.type === 'text'
      ? { text: c.text }
      : { inline_data: { mime_type: c.mediaType, data: c.base64 } },
  );
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/**
 * Thinking is DISABLED, deliberately.
 *
 * Gemini 2.5+ models reason before answering, and those thinking tokens are drawn from
 * `maxOutputTokens` BEFORE a single character of the answer is produced. The failure is
 * silent and bizarre: the model returns finishReason MAX_TOKENS with an empty candidate
 * and no text, which reads downstream as "the model returned nothing" rather than "the
 * model spent its whole budget thinking".
 *
 * We do not need it. Every prompt here is explicit, the schema is enforced, temperature
 * is 0, and none of these tasks — reading a receipt, naming a food, picking which
 * pre-computed metric is interesting — is a reasoning problem. Turning it off makes the
 * token budget mean what it says and removes a whole class of empty response.
 */
const THINKING_DISABLED = { thinkingBudget: 0 };

export const geminiProvider: AiProvider = {
  name: 'gemini',

  async call<T>({
    env,
    system,
    content,
    schema,
    outputSchema,
    maxTokens = 2048,
  }: StructuredCall<T>): Promise<T> {
    if (!env.GEMINI_API_KEY) {
      throw AppError.aiUnavailable('Synítheia AI is not configured on this server');
    }

    let res: Response;
    try {
      res = await fetch(
        `${ENDPOINT}/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: toParts(content) }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: toGeminiSchema(schema),
              maxOutputTokens: maxTokens,
              temperature: 0,
              thinkingConfig: THINKING_DISABLED,
            },
          }),
        },
      );
    } catch (err) {
      throw AppError.aiUnavailable(
        err instanceof Error
          ? `Synítheia AI request failed: ${err.message}`
          : 'Synítheia AI request failed',
      );
    }

    const body = (await res.json().catch(() => null)) as GeminiResponse | null;

    if (!res.ok) {
      // Surface Gemini's own message — a 400 here is almost always a schema mismatch,
      // and hiding it behind "something went wrong" makes that undebuggable.
      throw AppError.aiUnavailable(
        `Synítheia AI request failed: ${body?.error?.message ?? res.statusText}`,
      );
    }

    /**
     * A safety block is not a bug and must not read as one.
     *
     * Gemini will refuse some inputs outright. For a food photo that is a plausible
     * false positive, and the user deserves a sentence that tells them what happened
     * rather than a generic failure they will retry forever.
     */
    if (body?.promptFeedback?.blockReason) {
      throw AppError.ingestionFailed(
        `Synítheia AI declined to analyse that image (${body.promptFeedback.blockReason}). Try a different photo.`,
      );
    }

    const candidate = body?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;

    if (!text) {
      // Say which of the two very different things happened, rather than one vague
      // message covering both. A truncated response is a budget problem we can fix; an
      // empty one is a model problem we cannot.
      if (candidate?.finishReason === 'MAX_TOKENS') {
        throw AppError.aiUnavailable(
          'Synítheia AI ran out of output budget before finishing. This is a server misconfiguration, not your input.',
        );
      }
      throw AppError.aiUnavailable('Synítheia AI returned no structured output');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw AppError.aiUnavailable('Synítheia AI returned output that was not valid JSON');
    }

    const parsed = outputSchema.safeParse(raw);
    if (!parsed.success) {
      throw AppError.aiUnavailable('Synítheia AI returned output that failed validation');
    }

    return parsed.data;
  },
};
