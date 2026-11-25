import { hasAlbumActivity } from '#lib/noodle/album-activity.ts';

describe('hasAlbumActivity', () => {
  it('enables activity on a private album that only has its owner', () => {
    expect(hasAlbumActivity({ albumUsers: [{ role: 'owner' }] })).toBe(true);
  });

  it('enables activity on an album shared with other users', () => {
    expect(hasAlbumActivity({ albumUsers: [{ role: 'owner' }, { role: 'editor' }] })).toBe(true);
  });

  it('has no activity without any album user', () => {
    expect(hasAlbumActivity({ albumUsers: [] })).toBe(false);
  });
});
