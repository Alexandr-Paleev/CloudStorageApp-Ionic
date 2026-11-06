import { shareLinkUrl } from '@cloud-storage/core/share-link';
import { CONTACT_EMAIL } from './site';

/**
 * A letter about one shared file, addressed and ready to send.
 *
 * Every page a link opens says where to report the file, because a link
 * shows whatever its owner uploaded, under this site's name. The letter
 * carries the link: nothing else finds the file, since the token is stored
 * only as its hash (`libs/server/src/share.ts`). A link the functions made is
 * written the way they wrote it.
 */
export function reportAddress(token: string): string {
  const subject = 'A shared file to look at';
  const body = `Link: ${shareLinkUrl(token)}\n\nWhat is wrong with it:\n`;
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
