import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import ResumableUploads from './ResumableUploads';
import type { PendingUpload } from '../services/storage.service';
import { renderWithProviders } from '../test/utils';

const MiB = 1024 * 1024;

function pending(overrides: Partial<PendingUpload> = {}): PendingUpload {
  return {
    key: 'users/user-1/1700000000_movie.mp4',
    uploadId: 'upload-1',
    fileName: 'movie.mp4',
    size: 80 * MiB,
    contentType: 'video/mp4',
    partSize: 8 * MiB,
    partCount: 10,
    completed: Array.from({ length: 4 }, (_, i) => ({ partNumber: i + 1, etag: `"e${i}"` })),
    file: new File([], 'movie.mp4'),
    folderId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function show(props: Partial<React.ComponentProps<typeof ResumableUploads>> = {}) {
  const onResume = vi.fn();
  const onDiscard = vi.fn();
  renderWithProviders(
    <ResumableUploads uploads={[pending()]} onResume={onResume} onDiscard={onDiscard} {...props} />
  );
  return { onResume, onDiscard };
}

describe('ResumableUploads', () => {
  it('shows nothing at all when there is nothing to resume', () => {
    show({ uploads: [] });
    expect(screen.queryByText('Unfinished uploads')).not.toBeInTheDocument();
  });

  it('says how much of the file is already in storage', () => {
    show();
    expect(screen.getByText(/40% sent \(4 of 10 parts\)/)).toBeInTheDocument();
  });

  it('names the file, so a person with two interrupted uploads can tell them apart', () => {
    show({
      uploads: [pending(), pending({ key: 'users/user-1/2_photo.raw', fileName: 'photo.raw' })],
    });

    expect(screen.getByText('movie.mp4')).toBeInTheDocument();
    expect(screen.getByText('photo.raw')).toBeInTheDocument();
  });

  it('keeps file names out of session recordings', () => {
    // Same rule as the upload page: a file name can be as revealing as the file.
    show();
    expect(screen.getByText('movie.mp4')).toHaveAttribute('data-hj-suppress');
  });

  it('hands the record back on resume', () => {
    const { onResume } = show();
    fireEvent.click(screen.getByText('Resume'));

    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'upload-1' }));
  });

  it('hands the record back on discard', () => {
    const { onDiscard } = show();
    fireEvent.click(screen.getByText('Discard'));

    expect(onDiscard).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'upload-1' }));
  });

  it('locks every row while one of them is working', () => {
    // Two uploads resuming at once would fight over the progress bar, and the
    // second would have no way to report anything.
    const { onResume } = show({
      uploads: [pending(), pending({ key: 'users/user-1/2_photo.raw', fileName: 'photo.raw' })],
      busyKey: 'users/user-1/1700000000_movie.mp4',
    });

    screen.getAllByText('Discard').forEach((button) => fireEvent.click(button));
    expect(onResume).not.toHaveBeenCalled();
  });

  it('treats a record with no parts as zero rather than as not-a-number', () => {
    show({ uploads: [pending({ partCount: 0, completed: [] })] });
    expect(screen.getByText(/0% sent/)).toBeInTheDocument();
  });
});
