import { EMBEDDING_MODEL, ProviderNotConfigured } from '../../core/src/ai';
import {
  describeFile as describeWithClaude,
  type Description,
  type DescribeSource,
} from './describe';
import { embed as embedWithVoyage, type InputType } from './embeddings';
import {
  CF_EMBEDDING_MODEL,
  describeFile as describeWithWorkersAi,
  embed as embedWithWorkersAi,
  isConfigured as cloudflareConfigured,
} from './cloudflare-ai';

/**
 * Which pair of models this deployment describes and searches with.
 *
 * Two backends, chosen by which keys exist rather than by a flag somebody has
 * to remember to set:
 *
 *   Claude + Voyage   better sentences, paid per token
 *   Workers AI        free daily allowance, blunter sentences
 *
 * The point of the seam is that a deployment with no keys at all is a third,
 * legitimate state: the route answers 501, the searchbar says the feature is
 * not configured, and nothing else in the app changes. A portfolio project
 * that costs its author money every time a stranger opens it is a portfolio
 * project that gets switched off.
 *
 * What the choice may *not* do is change quietly. Vectors from two models are
 * not comparable, so `embeddingModel` is written on every row and
 * `match_files` filters by it (migrations/011). Switching backends therefore
 * hides the old rows rather than mixing them into the ranking, and the fix is
 * a re-index — which is what the backfill script is for.
 */

export interface AiBackend {
  /** Goes into `file_embeddings.embedding_model`, and into the search. */
  readonly embeddingModel: string;
  /** Whether this backend can look at that kind of file at all. */
  supports(kind: 'image' | 'pdf' | 'text'): boolean;
  describe(name: string, source: DescribeSource): Promise<Description>;
  embed(text: string, inputType: InputType): Promise<number[]>;
}

const anthropicBackend: AiBackend = {
  embeddingModel: EMBEDDING_MODEL,
  supports: () => true,
  describe: describeWithClaude,
  embed: embedWithVoyage,
};

const cloudflareBackend: AiBackend = {
  embeddingModel: CF_EMBEDDING_MODEL,
  // No PDF: nothing on this path renders a page, and describing a PDF by its
  // name alone would put a confident sentence about nothing into the index.
  supports: (kind) => kind !== 'pdf',
  describe: describeWithWorkersAi,
  embed: (text) => embedWithWorkersAi(text),
};

/**
 * The backend this deployment is configured for.
 *
 * Claude first when both are available: a deployment that went to the trouble
 * of adding paid keys meant to use them.
 */
export function activeBackend(): AiBackend {
  if (process.env.ANTHROPIC_API_KEY && process.env.VOYAGE_API_KEY) return anthropicBackend;
  if (cloudflareConfigured()) return cloudflareBackend;

  throw new ProviderNotConfigured(
    'No AI provider is configured — set ANTHROPIC_API_KEY and VOYAGE_API_KEY, ' +
      'or CLOUDFLARE_AI_TOKEN for the free Workers AI path'
  );
}
