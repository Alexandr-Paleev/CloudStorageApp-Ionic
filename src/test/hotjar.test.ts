import { afterEach, describe, expect, it } from 'vitest';
import { whereHotjarWouldRead } from './hotjar';

const NAME = 'payslip-march.pdf';

/* A helper that finds nothing would make every test that uses it pass. */
describe('whereHotjarWouldRead', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('finds text that nothing hides', () => {
    document.body.innerHTML = `<div><span>${NAME}</span></div>`;
    expect(whereHotjarWouldRead(NAME)).toEqual(['text in <span>']);
  });

  it('leaves text under data-hj-suppress, however far above', () => {
    document.body.innerHTML = `<div data-hj-suppress=""><p><b>${NAME}</b></p></div>`;
    expect(whereHotjarWouldRead(NAME)).toEqual([]);
  });

  it('finds an aria-label even inside a hidden element', () => {
    document.body.innerHTML = `<div data-hj-suppress=""><button aria-label="Delete ${NAME}"></button></div>`;
    expect(whereHotjarWouldRead(NAME)).toEqual(['aria-label of <button>']);
  });

  it('finds the title and the address of a frame inside a hidden element', () => {
    document.body.innerHTML = `<div data-hj-suppress=""><iframe title="${NAME}" src="https://storage.example/${NAME}?token=t"></iframe></div>`;
    expect(whereHotjarWouldRead(NAME)).toEqual(['title of <iframe>', 'src of <iframe>']);
  });

  it('leaves the alt and the address of a hidden image', () => {
    document.body.innerHTML = `<div data-hj-suppress=""><img alt="${NAME}" src="https://storage.example/${NAME}"></div>`;
    expect(whereHotjarWouldRead(NAME)).toEqual([]);
  });

  it('finds the alt of an image nothing hides', () => {
    document.body.innerHTML = `<img alt="${NAME}">`;
    expect(whereHotjarWouldRead(NAME)).toEqual(['alt of <img>']);
  });

  it('finds what a dialog would draw, unless it is told to hide it', () => {
    const shown = document.createElement('ion-alert') as HTMLElement & { message?: string };
    shown.message = `Delete ${NAME}?`;
    const hidden = document.createElement('ion-alert') as HTMLElement & {
      message?: string;
      htmlAttributes?: Record<string, string>;
    };
    hidden.message = `Delete ${NAME}?`;
    hidden.htmlAttributes = { 'data-hj-suppress': '' };
    document.body.append(shown, hidden);

    expect(whereHotjarWouldRead(NAME)).toEqual(['what <ion-alert> draws']);
  });
});
