import { env } from '../env';

/**
 * Whether this deployment may offer search by meaning.
 *
 * The same shape as `billingIsOffered()` next door, and for the same kind of
 * reason: a switch that cannot work should not be on screen at all. Without
 * a model provider `/api/ai/*` answers 501 — correctly, and with a message
 * naming environment variables, which is a sentence for whoever deploys this
 * and not for whoever is looking at it.
 *
 * Unlike billing there is no platform clause here: the native shell may use
 * this exactly as the web does. Nothing is being sold.
 */
export function smartSearchIsOffered(): boolean {
  return env.VITE_SMART_SEARCH_ENABLED;
}
