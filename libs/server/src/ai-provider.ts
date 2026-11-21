import { EMBEDDING_MODEL, MAX_VISION_BYTES, ProviderNotConfigured } from '../../core/src/ai';
import {
  describeFile as describeWithClaude,
  type Description,
  type DescribeSource,
} from './describe';
import {
  embed as embedWithVoyage,
  embedMany as embedManyWithVoyage,
  type InputType,
} from './embeddings';
import {
  CF_EMBEDDING_MODEL,
  describeFile as describeWithWorkersAi,
  embed as embedWithWorkersAi,
  embedMany as embedManyWithWorkersAi,
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
 * a re-index: the dashboard counts a file whose row another model made as not
 * indexed yet, and offers it again.
 */

export interface AiBackend {
  /** Goes into `file_embeddings.embedding_model`, and into the search. */
  readonly embeddingModel: string;
  /** Whether this backend can look at that kind of file at all. */
  supports(kind: 'image' | 'pdf' | 'text'): boolean;
  /**
   * Whether `describe` takes a PDF as it is. When it does not, it is given the
   * PDF's text, read by Cloudflare's `toMarkdown` (libs/server/src/to-markdown.ts).
   */
  readonly readsPdf: boolean;
  describe(name: string, source: DescribeSource): Promise<Description>;
  embed(text: string, inputType: InputType): Promise<number[]>;
  /** One vector per text, in order: the pieces of a file (ADR 0019). */
  embedMany(texts: string[], inputType: InputType): Promise<number[][]>;
  /** The largest picture `describe` takes, when it has a limit of its own. */
  readonly maxImageBytes?: number;
}

const anthropicBackend: AiBackend = {
  embeddingModel: EMBEDDING_MODEL,
  supports: () => true,
  readsPdf: true,
  describe: describeWithClaude,
  embed: embedWithVoyage,
  embedMany: embedManyWithVoyage,
};

const cloudflareBackend: AiBackend = {
  embeddingModel: CF_EMBEDDING_MODEL,
  // A PDF too, since its text can be read on the same account: no model on
  // this path takes a PDF, so it is described from the text `toMarkdown`
  // gives (ADR 0019). Until then it was refused, rather than described by its
  // name alone.
  supports: () => true,
  readsPdf: false,
  // The picture goes to the model as bytes, and Workers AI takes no more.
  maxImageBytes: MAX_VISION_BYTES,
  describe: describeWithWorkersAi,
  embed: (text) => embedWithWorkersAi(text),
  embedMany: (texts) => embedManyWithWorkersAi(texts),
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
