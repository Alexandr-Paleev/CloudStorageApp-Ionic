import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import Ask from './Ask';
import { citedNumbers } from '../utils/citations';
import { renderWithProviders } from '../test/utils';
import { whereHotjarWouldRead } from '../test/hotjar';
import { whereSentryWouldRead } from '../test/sentry';
import { HttpError } from '../utils/http.utils';
import type { AnswerEvent } from '../services/ai.service';

const { ask } = vi.hoisted(() => ({ ask: vi.fn() }));

vi.mock('../services/ai.service', () => ({ default: { ask } }));

const SOURCES = [
  {
    n: 1,
    fileId: 'f-1',
    fileName: 'lease.pdf',
    chunkIndex: 2,
    content: 'The lease ends on 31 January 2027.',
  },
  { n: 2, fileId: 'f-2', fileName: 'bill.pdf', chunkIndex: 0, content: 'Total: 86,40 euros.' },
];

/** An answer the route streams: these lines, in order. */
const answering =
  (...events: AnswerEvent[]) =>
  async (_q: string, onEvent: (e: AnswerEvent) => void) => {
    for (const event of events) onEvent(event);
  };

function show() {
  return renderWithProviders(
    <Routes>
      <Route path="/ask" element={<Ask />} />
      <Route path="/file/:fileId" element={<p>File page</p>} />
      <Route path="/dashboard" element={<p>Dashboard page</p>} />
    </Routes>,
    { route: '/ask' }
  );
}

function askAloud(question: string) {
  fireEvent.change(screen.getByTestId('ask-question'), { target: { value: question } });
  fireEvent.click(screen.getByTestId('ask-send'));
}

beforeEach(() => {
  vi.clearAllMocks();
  ask.mockImplementation(
    answering(
      { type: 'sources', model: 'm', sources: SOURCES },
      { type: 'text', text: 'Your lease ends on 31 January 2027 ' },
      { type: 'text', text: '[1].' },
      { type: 'done' }
    )
  );
});

describe('Ask', () => {
  it('shows the answer as it is written, with the source it cites', async () => {
    show();
    askAloud('  When does my lease end?  ');

    expect(await screen.findByText(/Your lease ends on 31 January 2027/)).toBeInTheDocument();
    expect(ask).toHaveBeenCalledWith(
      'When does my lease end?',
      expect.any(Function),
      expect.any(AbortSignal)
    );
    const sources = screen.getByRole('list', { name: 'Sources' });
    expect(sources).toHaveTextContent('[1] lease.pdf');
    expect(sources).toHaveTextContent('The lease ends on 31 January 2027.');
    // Only what the answer cites: the bill was read, and is not what it says.
    expect(sources).not.toHaveTextContent('bill.pdf');
  });

  it('opens the file a citation points at', async () => {
    show();
    askAloud('When does my lease end?');

    // Read out as "Source 1: lease.pdf", though only the 1 is shown.
    const cite = (await screen.findByText(': lease.pdf')).closest('button')!;
    expect(cite).toHaveTextContent('Source 1: lease.pdf');
    fireEvent.click(cite);

    expect(await screen.findByText('File page')).toBeInTheDocument();
  });

  /* The answer is a model's writing about a file, and a file can ask a model
     to write anything. */
  it('shows the answer as text, never as markup', async () => {
    ask.mockImplementation(
      answering(
        { type: 'sources', model: 'm', sources: SOURCES },
        { type: 'text', text: '<img src=x onerror="alert(1)"> [1]' },
        { type: 'done' }
      )
    );
    const { container } = show();
    askAloud('Anything?');

    expect(await screen.findByText(/<img src=x onerror="alert\(1\)">/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('says what to do when nothing is indexed', async () => {
    ask.mockImplementation(
      answering({ type: 'sources', model: 'm', sources: [] }, { type: 'done', empty: true })
    );
    show();
    askAloud('When does my lease end?');

    expect(await screen.findByText(/None of your files are indexed yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Index them on the dashboard'));
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
  });

  it('says when the person can ask again, as the limit said it', async () => {
    ask.mockRejectedValue(
      new HttpError(
        'You have asked as many questions today as a day allows. Searching still works. You can try again after 01:00.',
        429
      )
    );
    show();
    askAloud('When does my lease end?');

    expect(await screen.findByRole('alert')).toHaveTextContent('You can try again after 01:00.');
  });

  it('says plainly where the site cannot answer at all', async () => {
    ask.mockRejectedValue(new HttpError('No AI provider is configured — set …', 501));
    show();
    askAloud('When does my lease end?');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Questions are not available on this site.'
    );
  });

  it('says so when the answer breaks off after it began', async () => {
    ask.mockImplementation(
      answering(
        { type: 'sources', model: 'm', sources: SOURCES },
        { type: 'text', text: 'Your lease' },
        { type: 'error', message: 'The answer could not be finished. Try asking again.' }
      )
    );
    show();
    askAloud('When does my lease end?');

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be finished');
    expect(screen.getByText('Your lease')).toBeInTheDocument();
  });

  it('says so when the connection ends without the last line', async () => {
    ask.mockImplementation(
      answering({ type: 'sources', model: 'm', sources: SOURCES }, { type: 'text', text: 'Your' })
    );
    show();
    askAloud('When does my lease end?');

    expect(await screen.findByRole('alert')).toHaveTextContent('cut off');
  });

  describe('Stop', () => {
    /** An answer that writes one word and then waits, until it is stopped. */
    const hanging = () => {
      let seen: AbortSignal | undefined;
      ask.mockImplementation(
        (_q: string, onEvent: (e: AnswerEvent) => void, signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            seen = signal;
            onEvent({ type: 'sources', model: 'm', sources: SOURCES });
            onEvent({ type: 'text', text: 'Your lease ends [1]' });
            signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      );
      return () => seen;
    };

    it('ends the request, keeps what was written, and says it stopped', async () => {
      const signal = hanging();
      show();
      askAloud('When does my lease end?');

      fireEvent.click(await screen.findByTestId('ask-stop'));

      expect(await screen.findByText('Stopped.')).toBeInTheDocument();
      expect(signal()?.aborted).toBe(true);
      expect(screen.getByText(/Your lease ends/)).toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Sources' })).toHaveTextContent('lease.pdf');
      expect(screen.getByTestId('ask-send')).toBeInTheDocument();
    });

    it('happens on leaving the page, too: nobody reads the rest', async () => {
      const signal = hanging();
      const { unmount } = show();
      askAloud('When does my lease end?');
      await screen.findByTestId('ask-stop');

      unmount();

      expect(signal()?.aborted).toBe(true);
    });
  });

  it('asks on Enter, and keeps Shift+Enter for a new line', async () => {
    show();
    const box = screen.getByTestId('ask-question');
    fireEvent.change(box, { target: { value: 'When does my lease end?' } });

    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(ask).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
  });

  /* Typing Chinese or Japanese, Enter picks the word; the question goes on. */
  it('leaves an Enter that ends a composed word to the keyboard', async () => {
    show();
    const box = screen.getByTestId('ask-question');
    fireEvent.change(box, { target: { value: '租约什么时候' } });

    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });

    await act(() => Promise.resolve());
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks nothing for an empty question', async () => {
    show();
    fireEvent.change(screen.getByTestId('ask-question'), { target: { value: '   ' } });
    fireEvent.keyDown(screen.getByTestId('ask-question'), { key: 'Enter' });

    await act(() => Promise.resolve());
    expect(ask).not.toHaveBeenCalled();
  });

  /* The question, the answer and the files' names are the owner's. */
  it('lets neither Hotjar nor Sentry read what was asked, answered or cited', async () => {
    show();
    askAloud('Until when is my flat rented?');
    await screen.findByText(/Your lease ends on 31 January 2027/);

    for (const text of ['my flat rented', 'Your lease ends', 'lease.pdf']) {
      expect(whereHotjarWouldRead(text)).toEqual([]);
      expect(whereSentryWouldRead(text)).toEqual([]);
    }
  });
});

describe('citedNumbers', () => {
  it('lists each cited number once, in the order first cited', () => {
    expect(citedNumbers('A [2]. B [1][2]. C [3].')).toEqual([2, 1, 3]);
    expect(citedNumbers('Your files don’t say.')).toEqual([]);
  });
});
