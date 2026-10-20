import { afterEach, describe, expect, it } from 'vitest';
import { whereSentryWouldRead } from './sentry';

const NAME = 'payslip-march.pdf';

/* A helper that finds nothing would make every test that uses it pass. */
describe('whereSentryWouldRead', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it.each([
    ['the alt of a picture', `<img alt="${NAME}">`],
    ['the label of a button', `<button aria-label="Delete ${NAME}"></button>`],
    ['a title', `<div title="${NAME}"></div>`],
    ['the name of a field', `<input name="${NAME}">`],
    ['an id', `<p id="row-${NAME}"></p>`],
    ['a class', `<p class="row ${NAME}"></p>`],
  ])('finds %s', (_what, html) => {
    document.body.innerHTML = html;
    expect(whereSentryWouldRead(NAME)).not.toEqual([]);
  });

  /* What Sentry never describes an element by. */
  it.each([
    ['text', `<button><span>Delete ${NAME}</span></button>`],
    ['a name taken from other text', `<h1 id="title">${NAME}</h1><img aria-labelledby="title">`],
    ['an address', `<img src="https://storage.example/${NAME}">`],
    ['a data attribute', `<div data-name="${NAME}"></div>`],
  ])('leaves %s', (_what, html) => {
    document.body.innerHTML = html;
    expect(whereSentryWouldRead(NAME)).toEqual([]);
  });

  it('says it as Sentry would', () => {
    document.body.innerHTML = `<div class="row"><img class="thumb" alt="${NAME}"></div>`;
    expect(whereSentryWouldRead(NAME)).toEqual([`body > div.row > img.thumb[alt="${NAME}"]`]);
  });
});
