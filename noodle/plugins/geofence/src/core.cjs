'use strict';
const KEY = 'noodle-geofence-v1';
const RADIUS = 250;
function point(asset) {
  const e = asset.exifInfo;
  return e && Number.isFinite(e.latitude) && Number.isFinite(e.longitude) &&
    Math.abs(e.latitude) <= 90 && Math.abs(e.longitude) <= 180
    ? [e.latitude, e.longitude] : null;
}
function distance(a, b) {
  const rad = Math.PI / 180;
  const dlat = (b[0] - a[0]) * rad, dlon = (b[1] - a[1]) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dlon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function run(payload, api) {
  const {config, data, trigger} = payload;
  const asset = data.asset;
  if (trigger !== 'AssetMetadataExtraction' || asset.type !== 'IMAGE' ||
      asset.deletedAt || asset.visibility === 'locked' || asset.ownerId !== config.ownerId) return {};
  const cutoff = Date.parse(config.enabledAfter), created = Date.parse(asset.createdAt);
  if (!Number.isFinite(cutoff)) throw new Error('enabledAfter must be an ISO timestamp');
  if (!Number.isFinite(created) || created <= cutoff) return {};
  const path = '/assets/' + encodeURIComponent(asset.id);
  function readState(id) {
    // Read the collection: a missing custom key is normal, an HTTP failure is not.
    const rows = api('GET', '/assets/' + encodeURIComponent(id) + '/metadata');
    return rows.find(row => row.key === KEY)?.value;
  }
  const save = state => api('PUT', path + '/metadata', {items: [{key: KEY, value: state}]});
  let state = readState(asset.id);
  if (state?.done) return {};
  function match(albumId) {
    const p = point(asset);
    if (!p) return {member: false, nearby: false};
    const tag = api('GET', '/tags').find(t => t.id === config.sourceTags?.[albumId] && t.value.startsWith('Standortquelle/'));
    if (!tag) return {member: false, nearby: false};
    let cursor, member = false, nearby = false;
    const visited = new Set();
    do {
      const request = {albumIds: [albumId], tagIds: [tag.id], type: 'IMAGE', withExif: true, size: 1000};
      if (cursor) request.cursor = cursor;
      const page = api('POST', '/search/metadata', request).assets;
      for (const seed of page.items) {
        if (seed.id === asset.id) { member = true; continue; }
        if (nearby) continue;
        const q = point(seed);
        if (!q || distance(p, q) > RADIUS || seed.isTrashed || seed.visibility === 'locked') continue;
        nearby = true;
      }
      cursor = page.nextCursor;
      if (cursor && visited.has(cursor)) throw new Error('Search returned a repeated cursor');
      if (cursor) visited.add(cursor);
    } while (cursor);
    return {member, nearby};
  }
  if (!state) {
    const targets = [];
    if (point(asset)) {
      const existing = new Set(api('GET', '/albums?assetId=' + encodeURIComponent(asset.id)).map(a => a.id));
      for (const album of api('GET', '/albums')) {
        if (!/^!/.test(album.albumName) || album.albumUsers?.[0]?.user?.id !== config.ownerId) continue;
        if (existing.has(album.id)) continue;
        const {member, nearby} = match(album.id);
        if (!member && nearby) targets.push(album.id);
      }
    }
    state = {version: 1, done: false, targets};
    // Persist the retry plan. Source status comes exclusively from the
    // Standortquelle tag, never from this processing metadata.
    save(state);
  }
  for (const albumId of state.targets) {
    // Removing ! or deleting the album stops retries too.
    const album = api('GET', '/albums').find(a => a.id === albumId);
    if (!album || !album.albumName.startsWith('!') || album.albumUsers?.[0]?.user?.id !== config.ownerId) continue;
    // A removed manual image stops covering this location, even on a retry.
    const {member, nearby} = match(albumId);
    if (member || !nearby) continue;
    const result = api('PUT', '/albums/' + encodeURIComponent(albumId) + '/assets', {ids: [asset.id]});
    const item = result.find(item => item.id === asset.id);
    if (!item || (!item.success && item.error !== 'duplicate')) throw new Error('Album addition failed');
  }
  save({...state, done: true});
  return {};
}
module.exports = {run, point, distance, KEY};
