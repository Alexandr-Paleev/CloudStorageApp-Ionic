import Anthropic from '@anthropic-ai/sdk';
import { ProviderNotConfigured } from '../../core/src/ai';
import { ANSWER_SYSTEM, excerptTitle, type Excerpt } from './answer';

/**
 * An answer from the pieces on the paid path (ADR 0019). Production answers
 * on Workers AI and never reaches this file: it runs only where a deployment
 * has set ANTHROPIC_API_KEY and VOYAGE_API_KEY.
 *
 * The excerpts go as document blocks, one per piece, titled with the number
 * they are cited by. A document block is how the Messages API is told that a
 * text is material to read rather than a turn of the conversation, which is
 * what a piece of someone's file is.
 */

/** The model that answers. The one that already describes files here. */
export const ANSWER_MODEL = 'claude-opus-5-5';

/**
 * Room for the answer and for the thinking in front of it, which this model
 * always does and which counts against the cap. The answer itself is a few
 * sentences; the cap only stops a turn that would not end.
 */
const MAX_TOKENS = 8000;

/** Said in place of an answer the model declined to give. */
export class AnswerRefused extends Error {}

export async function* answerWithClaude(
  excerpts: Excerpt[],
  question: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ProviderNotConfigured('ANTHROPIC_API_KEY is not configured on the server');
  }

  // Per call, for the reason describe.ts gives: the constructor throws without a key.
  const client = new Anthropic();

  const stream = client.beta.messages.stream(
    {
      model: ANSWER_MODEL,
      max_tokens: MAX_TOKENS,
      /* Low: reading a handful of short excerpts and saying what they say is
         recognition, not reasoning. Said by name, since this model's default is
         medium and thinking cannot be turned off. */
      output_config: { effort: 'low' },
      /* Should the model decline a question for safety reasons, the server runs
         the same request on the model Anthropic picks for that refusal, rather
         than the person getting no answer. */
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: ANSWER_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...excerpts.map((excerpt) => ({
              type: 'document' as const,
              source: {
                type: 'text' as const,
                media_type: 'text/plain' as const,
                data: excerpt.content,
              },
              title: excerptTitle(excerpt),
            })),
            { type: 'text' as const, text: question },
          ],
        },
      ],
    },
    // Aborting the request ends the turn on Anthropic's side as well.
    { signal }
  );

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }

  /* A refusal after the fallback as well ends the turn with no answer to show;
     saying so beats an empty bubble. */
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') {
    throw new AnswerRefused('The model would not answer this question.');
  }
}
