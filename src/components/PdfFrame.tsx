import { useEffect, useRef } from 'react';
import { isSafeHttpUrl } from '@cloud-storage/core/safe-url';

interface PdfFrameProps {
  /** The file's address: signed for an hour on R2 and Supabase Storage. */
  url: string;
  /** How the frame is sent there. A test passes its own; a browser uses its window's. */
  open?: (frame: HTMLIFrameElement, url: string) => void;
}

/* http(s) or nowhere. The frame starts as about:blank, which is of the page's
   own origin, and a `javascript:` address sent there would run as the app.
   React refuses one in `src`; nothing refuses it here but this, since the
   page's CSP allows inline script (see safe-url). */
const navigate = (frame: HTMLIFrameElement, url: string) => {
  if (isSafeHttpUrl(url)) frame.contentWindow?.location.replace(url);
};

/**
 * A PDF, in a frame that is sent to its address rather than given it.
 *
 * As `src` the address would be an attribute of the page, and Hotjar records
 * a frame's attributes as they are, inside an element it hides or not
 * (src/test/hotjar.ts). This address carries the file's name in its path and,
 * on R2 and Supabase Storage, a signature that opens the file to whoever holds
 * it for the next hour. Sent there through the frame's own window, it is in no
 * attribute. The page's frame-src already allows those hosts, and applies to
 * the navigation the same way. `replace`, so that opening a file adds no step
 * to the back button.
 */
const PdfFrame: React.FC<PdfFrameProps> = ({ url, open = navigate }) => {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (frame.current) open(frame.current, url);
  }, [url, open]);

  return <iframe ref={frame} className="preview-pdf-frame" title="Preview of the file" />;
};

export default PdfFrame;
