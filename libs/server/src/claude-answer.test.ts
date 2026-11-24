import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderNotConfigured } from '../../core/src/ai';
import type { Excerpt } from './answer';

const { stream, events, final } = vi.hoisted(() => ({
  stream: vi.fn(),
  events: { value: [] as unknown[] },
  final: { value: { stop_reason: 'end_turn' } as { stop_reason: string } },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    beta = {
      messages: {
        stream: (params: unknown, options?: unknown) => {
          stream(params, options);
          return {
            async *[Symbol.asyncIterator]() {
              yield* events.value;
            },
            finalMessage: async () => final.value,
          };
        },
      },
    };
  },
}));

import { ANSWER_MODEL, AnswerRefused, answerWithClaude } from './claude-answer';
import { ANSWER_SYSTEM } from './answer';

const EXCERPTS: Excerpt[] = [
  { n: 1, fileId: 'f-1', fileName: 'lease.pdf', chunkIndex: 2, content: 'The rent is 950 euros.' },
];

const delta = (text: string) => ({
  type: 'content_block_delta',
  delta: { type: 'text_delta', text },
});

async function collect(): Promise<string[]> {
  const out: string[] = [];
  for await (const text of answerWithClaude(EXCERPTS, 'How much is the rent?')) out.push(text);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  events.value = [
    delta('950 euros '),
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '…' } },
    delta('[1].'),
  ];
  final.value = { stop_reason: 'end_turn' };
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('answerWithClaude', () => {
  it('yields the text of the answer, and nothing of the thinking', async () => {
    expect(await collect()).toEqual(['950 euros ', '[1].']);
  });

  it('hands each excerpt over as a document titled with its number, then the question', async () => {
    await collect();

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: ANSWER_MODEL,
        system: ANSWER_SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'text', media_type: 'text/plain', data: 'The rent is 950 euros.' },
                title: '[1] lease.pdf',
              },
              { type: 'text', text: 'How much is the rent?' },
            ],
          },
        ],
      }),
      expect.anything()
    );
  });

  it('answers at low effort, with a fallback model should this one decline', async () => {
    await collect();

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }),
      expect.anything()
    );
  });

  it('passes the signal on, so that a person leaving ends the turn at Anthropic too', async () => {
    const left = new AbortController();
    for await (const text of answerWithClaude(EXCERPTS, 'Rent?', left.signal)) void text;

    expect(stream).toHaveBeenCalledWith(expect.anything(), { signal: left.signal });
  });

  it('says so when the answer was refused, rather than ending with nothing', async () => {
    events.value = [];
    final.value = { stop_reason: 'refusal' };

    await expect(collect()).rejects.toBeInstanceOf(AnswerRefused);
  });

  it('asks nobody without a key', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    await expect(collect()).rejects.toBeInstanceOf(ProviderNotConfigured);
    expect(stream).not.toHaveBeenCalled();
  });
});
