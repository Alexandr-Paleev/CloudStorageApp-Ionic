import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import PdfFrame from './PdfFrame';
import { whereHotjarWouldRead } from '../test/hotjar';
import { whereSentryWouldRead } from '../test/sentry';

const URL_OF_FILE =
  'https://storage.example/object/sign/files/user-1/1700000000_payslip-march.pdf?token=t';

describe('PdfFrame', () => {
  it('sends the frame to the file', () => {
    const open = vi.fn();
    render(<PdfFrame url={URL_OF_FILE} open={open} />);

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toBeInstanceOf(HTMLIFrameElement);
    expect(open.mock.calls[0]![1]).toBe(URL_OF_FILE);
  });

  it('writes neither the address nor the name into the page', () => {
    render(<PdfFrame url={URL_OF_FILE} open={vi.fn()} />);

    expect(document.querySelector('iframe')).not.toHaveAttribute('src');
    expect(whereHotjarWouldRead('payslip-march')).toEqual([]);
    expect(whereHotjarWouldRead('token=')).toEqual([]);
  });

  it('goes again when the address changes, as a signed one does', () => {
    const open = vi.fn();
    const { rerender } = render(<PdfFrame url={URL_OF_FILE} open={open} />);
    rerender(<PdfFrame url={`${URL_OF_FILE}2`} open={open} />);

    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[1]![1]).toBe(`${URL_OF_FILE}2`);
  });

  /* The frame is of the app's origin until it goes somewhere, so it goes only
     to an http(s) address. Its window is stood in for: jsdom navigates no
     frame, so the address it would have gone to is only seen this way. */
  describe('on its own', () => {
    const replace = vi.fn();
    const own = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')!;

    beforeEach(() => {
      replace.mockClear();
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        configurable: true,
        get: () => ({ location: { replace } }),
      });
    });

    afterEach(() => {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', own);
    });

    it('goes to an http(s) address', () => {
      render(<PdfFrame url={URL_OF_FILE} />);
      expect(replace).toHaveBeenCalledWith(URL_OF_FILE);
    });

    it('goes nowhere else', () => {
      render(<PdfFrame url={'javascript:alert(document.domain)'} />);
      expect(replace).not.toHaveBeenCalled();
    });
  });
});

describe('PdfFrame and what Sentry may be told', () => {
  it('describes no tap on the frame by the file’s name', () => {
    render(<PdfFrame url={URL_OF_FILE} open={vi.fn()} />);

    expect(whereSentryWouldRead('payslip-march')).toEqual([]);
  });
});
