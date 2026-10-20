import { htmlTreeAsString } from '@sentry/core';

/**
 * Where Sentry would read a piece of text, if a tap or a key landed here.
 *
 * Sentry keeps the page's last hundred taps and keys as breadcrumbs and sends
 * them with the next error. Each is described by the element it reached, and
 * a few above it, with Sentry's own `htmlTreeAsString`: the tag, the id, the
 * classes, and five attributes as they are, `aria-label`, `type`, `name`,
 * `title` and `alt`. Text is never part of it. So a name that is text is not
 * read, and a name in one of those attributes is, on whatever element.
 *
 * Every element here is described as the one tapped. The function is the one
 * the app runs: it comes from the copy of `@sentry/core` that `@sentry/react`
 * brings, rather than one declared beside it, which could be another version
 * and describe an element otherwise than the copy that sends.
 */
export function whereSentryWouldRead(text: string, root: Element = document.body): string[] {
  return [root, ...root.querySelectorAll('*')]
    .map((element) => htmlTreeAsString(element))
    .filter((described) => described.includes(text));
}
