import { describe, it, expect } from 'vitest';
import { DESCRIBE_COPY, cloudinaryCopyForDescribing } from './cloudinary-resize';

const PHOTO = 'https://res.cloudinary.com/demo/image/upload/v1732000000/users/user-1/IMG_0412.jpg';

describe('cloudinaryCopyForDescribing', () => {
  it('asks for the copy in the address, after the delivery type', () => {
    expect(cloudinaryCopyForDescribing(PHOTO)).toBe(
      `https://res.cloudinary.com/demo/image/upload/${DESCRIBE_COPY}/v1732000000/users/user-1/IMG_0412.jpg`
    );
  });

  it('keeps a name that needed encoding as it was', () => {
    const named =
      'https://res.cloudinary.com/demo/image/upload/v1/users/user-1/Foto%20de%20M%C3%A1laga.heic';
    expect(cloudinaryCopyForDescribing(named)).toBe(
      `https://res.cloudinary.com/demo/image/upload/${DESCRIBE_COPY}/v1/users/user-1/Foto%20de%20M%C3%A1laga.heic`
    );
  });

  it.each([
    ['another host', 'https://evil.example/demo/image/upload/v1/users/user-1/a.jpg'],
    [
      'a host that only starts like it',
      'https://res.cloudinary.com.evil.example/demo/image/upload/v1/a.jpg',
    ],
    ['plain http', 'http://res.cloudinary.com/demo/image/upload/v1/users/user-1/a.jpg'],
    [
      'a raw file, not an image',
      'https://res.cloudinary.com/demo/raw/upload/v1/users/user-1/a.pdf',
    ],
    ['not an address', 'photo.jpg'],
  ])('is null for %s', (_, url) => {
    expect(cloudinaryCopyForDescribing(url)).toBeNull();
  });
});
