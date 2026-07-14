import Anthropic from '@anthropic-ai/sdk';
import { AppError } from '../../core/errors.js';
import type { AiContent, AiProvider, StructuredCall } from '../types.js';

let client: Anthropic | null = null;

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

function toBlocks(content: AiContent[]): Anthropic.MessageParam['content'] {
  return content.map((c) =>
    c.type === 'text'
      ? { type: 'text' as const, text: c.text }
      : {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: c.mediaType as ImageMediaType,
            data: c.base64,
          },
        },
  );
}

/**
 * Anthropic is driven through forced tool-use rather than free-text JSON.
 *
 * `tool_choice: { type: 'tool' }` removes the entire class of "the model wrote a
 * friendly paragraph instead of JSON and the parser exploded".
 */
export const anthropicProvider: AiProvider = {
  name: 'anthropic',

  async call<T>({
    env,
    system,
    content,
    outputName,
    outputDescription,
    schema,
    outputSchema,
    maxTokens = 2048,
  }: StructuredCall<T>): Promise<T> {
    if (!env.ANTHROPIC_API_KEY) {
      throw AppError.aiUnavailable('Synítheia AI is not configured on this server');
    }

    client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: env.ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: toBlocks(content) }],
        tools: [
          {
            name: outputName,
            description: outputDescription,
            input_schema: schema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: outputName },
      });
    } catch (err) {
      throw AppError.aiUnavailable(
        err instanceof Error ? `Synítheia AI request failed: ${err.message}` : 'Synítheia AI request failed',
      );
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (!toolUse) {
      throw AppError.aiUnavailable('Synítheia AI returned no structured output');
    }

    const parsed = outputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw AppError.aiUnavailable('Synítheia AI returned output that failed validation');
    }

    return parsed.data;
  },
};

/** Tests inject a stub; production never calls this. */
export function __resetAnthropicClient(): void {
  client = null;
}
