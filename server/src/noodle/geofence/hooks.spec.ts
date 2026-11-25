import { AlbumService } from 'src/services/album.service.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe('SyncNearbyAlbumNotes (noodle)', () => {
  let sut: AlbumService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(AlbumService));
  });

  it('touches nothing else when no nearby-albums workflow is configured', async () => {
    mocks.workflow.search.mockResolvedValue([]);
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-1']));
    const deleteSpy = mocks.album.delete.mockResolvedValue();

    await sut.delete(authStub.admin, 'album-1');

    expect(mocks.workflow.search).toHaveBeenCalledWith({ enabled: true });
    expect(mocks.workflow.getForWorkflowRun).not.toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledWith('album-1');
  });

  it('still runs the edit when preparing the notes fails', async () => {
    mocks.workflow.search.mockRejectedValue(new Error('database down'));
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-1']));
    mocks.album.delete.mockResolvedValue();

    await expect(sut.delete(authStub.admin, 'album-1')).resolves.toBeUndefined();
    expect(mocks.album.delete).toHaveBeenCalledWith('album-1');
  });
});
