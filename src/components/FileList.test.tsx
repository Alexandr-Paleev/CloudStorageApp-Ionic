import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import FileList from './FileList';
import type { FileMetadata } from '../services/storage.service';
import { HttpError } from '../utils/http.utils';
import { whereHotjarWouldRead } from '../test/hotjar';
import { whereSentryWouldRead } from '../test/sentry';

const PDF = {
  id: 'f1',
  name: 'report.pdf',
  size: 2048,
  type: 'application/pdf',
  download_url: 'https://cdn.example.com/report.pdf',
  storage_path: 'user-1/report.pdf',
  storage_type: 'supabase_storage',
  created_at: '2026-10-01T10:00:00Z',
} as FileMetadata;

const PHOTO = {
  id: 'f2',
  name: 'sky.jpg',
  size: 4096,
  type: 'image/jpeg',
  download_url: 'https://res.cloudinary.com/demo/image/upload/v1/users/user-1/sky.jpg',
  storage_path: 'users/user-1/sky',
  storage_type: 'cloudinary',
  created_at: '2026-10-02T10:00:00Z',
} as FileMetadata;

type Props = React.ComponentProps<typeof FileList>;

function show(props: Partial<Props> = {}) {
  const callbacks = {
    onLoadMore: vi.fn().mockResolvedValue(undefined),
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    ...props,
  };
  render(
    <FileList
      files={[]}
      loading={false}
      error={null}
      searching={false}
      smartSearching={false}
      hasFolders={false}
      hasNextPage={false}
      {...callbacks}
    />
  );
  return callbacks;
}

const EMPTY = 'No files yet. Upload something!';
const errorText = () => document.querySelector('.files-error')?.textContent;

describe('FileList', () => {
  describe('a row', () => {
    it('names the file, with its size', () => {
      show({ files: [PDF] });

      expect(screen.getByText('report.pdf')).toBeInTheDocument();
      expect(document.querySelector('.file-meta-details')).toHaveTextContent(/^2\.00 KB • /);
    });

    it('opens the file that was pressed', () => {
      const { onOpen, onDelete } = show({ files: [PDF, PHOTO] });

      fireEvent.click(screen.getByRole('button', { name: 'Open sky.jpg' }));
      expect(onOpen).toHaveBeenCalledWith(PHOTO);
      expect(onDelete).not.toHaveBeenCalled();
    });

    /* The bin only asks. Whether anything is deleted is up to the dialog the
       page opens, and the row must not be opened on the way. */
    it('hands the bin’s file to the page, and does not open it', () => {
      const { onOpen, onDelete } = show({ files: [PDF, PHOTO] });

      fireEvent.click(screen.getByText('Delete report.pdf'));
      expect(onDelete).toHaveBeenCalledWith(PDF);
      expect(onOpen).not.toHaveBeenCalled();
    });

    /* Cloudinary resizes on the way out, the others hand back the original:
       a long list of photographs is fetched lazily either way. */
    it('shows an image as a small, lazily loaded picture of itself', () => {
      show({ files: [PHOTO] });

      const picture = document.querySelector('img.file-thumbnail-img');
      // Its name is the row's text, beside it.
      expect(picture).toHaveAttribute('alt', '');
      expect(picture).toHaveAttribute('loading', 'lazy');
      expect(picture?.getAttribute('src')).toContain('/upload/w_100,h_100,');
    });

    it('shows any other file as a document', () => {
      show({ files: [PDF] });

      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(document.querySelector('.file-icon-box ion-icon')).not.toBeNull();
    });

    /* A ranked list with no reason attached is indistinguishable from a wrong
       one. */
    it('says why a search by meaning returned it, when it did', () => {
      show({ files: [{ ...PHOTO, summary: 'A blue sky over a field.' } as FileMetadata] });
      expect(screen.getByText('A blue sky over a field.')).toBeInTheDocument();
    });

    it('says nothing under a file that was listed rather than searched for', () => {
      show({ files: [PDF] });
      expect(document.querySelector('.file-meta-summary')).toBeNull();
    });
  });

  it('shows a spinner while the first page is on its way', () => {
    show({ loading: true });

    expect(screen.getByLabelText('Loading files')).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  describe('a list that could not be had', () => {
    /* An ordinary listing fails for reasons the person cannot act on, and its
       message is for whoever reads the console. */
    it('says only that it failed, for a folder', () => {
      show({ error: new Error('relation "files" does not exist') });
      expect(errorText()).toBe('Error loading items.');
    });

    it('says why, for a search by meaning', () => {
      show({ smartSearching: true, error: new Error('The search index is not reachable') });
      expect(errorText()).toBe('The search index is not reachable');
    });

    /* The server's own sentence names environment variables, which is for
       whoever deploys this and not for whoever is looking at it. */
    it('says only that the deployment cannot search by meaning, when it cannot', () => {
      show({
        smartSearching: true,
        error: new HttpError('VOYAGE_API_KEY is not configured on the server', 501),
      });
      expect(errorText()).toBe('Smart search is not set up on this deployment.');
    });
  });

  describe('a folder with nothing in it', () => {
    it('says so, and what to do about it', () => {
      show();
      expect(screen.getByText(EMPTY)).toBeInTheDocument();
    });

    /* An empty result is not an empty account. */
    it('is not what a search that found nothing looks like', () => {
      show({ searching: true });
      expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    });

    it('is not a folder that holds folders', () => {
      show({ hasFolders: true });
      expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    });
  });

  describe('the next page', () => {
    /** Ionic's props are properties of the element, not attributes. */
    const scroller = () =>
      document.querySelector('ion-infinite-scroll') as HTMLElement & {
        disabled?: boolean;
        complete?: () => void;
      };

    it('is not asked for when there is none', () => {
      show({ files: [PDF], hasNextPage: false });
      expect(scroller().disabled).toBe(true);
    });

    it('is asked for as the list is scrolled to its end', () => {
      show({ files: [PDF], hasNextPage: true });
      expect(scroller().disabled).toBe(false);
    });

    /* Ionic waits for complete() before it fires again: called early, a quick
       scroll asks for the same page twice; never called, it asks for nothing
       more at all. */
    it('lets the scroll go on only once the page has arrived', async () => {
      let arrived!: () => void;
      const { onLoadMore } = show({
        files: [PDF],
        hasNextPage: true,
        onLoadMore: vi.fn(() => new Promise<void>((resolve) => (arrived = resolve))),
      });
      const element = scroller();
      element.complete = vi.fn();

      fireEvent(element, new CustomEvent('ionInfinite'));
      expect(onLoadMore).toHaveBeenCalledOnce();
      expect(element.complete).not.toHaveBeenCalled();

      await act(async () => arrived());
      expect(element.complete).toHaveBeenCalledOnce();
    });
  });
});

/* A file's name, the sentence a model wrote about it and its picture are the
   owner's. Hotjar leaves out of a recording only what is marked, and records
   any attribute it does not know whatever is around it: the label of a
   button among them. */
describe('FileList and what Hotjar may record', () => {
  it('shows it no name, no description and no picture', () => {
    const described = { ...PDF, summary: 'A quarterly report for the board' };
    show({ files: [described, PHOTO] });

    expect(whereHotjarWouldRead('report.pdf')).toEqual([]);
    expect(whereHotjarWouldRead('sky.jpg')).toEqual([]);
    expect(whereHotjarWouldRead('quarterly report')).toEqual([]);
    const pictures = document.querySelectorAll('img.file-thumbnail-img');
    expect(pictures.length).toBeGreaterThan(0);
    for (const picture of pictures) expect(picture.closest('[data-hj-suppress]')).not.toBeNull();
  });

  /* What a screen reader says is unchanged: the name is text in the buttons. */
  it('still names both buttons after the file', () => {
    show({ files: [PDF] });

    expect(screen.getByRole('button', { name: 'Open report.pdf' })).toBeInTheDocument();
    expect(screen.getByText('Delete report.pdf').closest('ion-button')).not.toBeNull();
  });
});

/* Sentry sends the last taps with an error, each described by the element
   tapped: its id, its classes and five attributes, the alt of a picture
   among them. */
describe('FileList and what Sentry may be told', () => {
  it('describes no tap on it by a name', () => {
    show({ files: [PDF, PHOTO] });

    expect(document.querySelector('img.file-thumbnail-img')).not.toBeNull();
    expect(whereSentryWouldRead('report.pdf')).toEqual([]);
    expect(whereSentryWouldRead('sky.jpg')).toEqual([]);
  });
});
