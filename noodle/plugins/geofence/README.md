# Nearby albums

`!` at the start of an album name enables automatic collection within 250 metres.
Each album has its own nested image tag, for example `Standortquelle/Urlaub` for
`!Urlaub`. Only images carrying that album's tag AND currently belonging to that
album supply locations. The tags are the sole source of truth for source status.
The same image may be a source in one album and an ordinary image in another.

Manually adding an image to an enabled album attaches its nested tag, even
before its location metadata is ready (including direct uploads from the web). Normal
automatic additions do not receive a source tag. Removing an image from an album
stops its location being used there. Removing `!` disables that album. Tags are
NEVER removed automatically, so re-enabling the album restores its tagged
sources. Existing album photos stay in place; no library backfill occurs.

Renaming the album renames its nested tag while retaining the tag ID and image
assignments. Adding/removing only `!` leaves the tag name unchanged. Identical
album names receive a unique suffix if needed. Album slashes are displayed as
`∕` in the tag name, since `/` separates tag levels.

## German image notes

Active source images receive this explanation (with the current album name):

> Neue Bilder aus der Nähe dieses Ortes (bis zu 250 Meter) kommen automatisch in
> das Album „!Urlaub“. Entferne den Standortquellen Tag, wenn du das nicht mehr möchtest.

Removing an image from an album or disabling it removes that album's note. If an
image has no Standortquelle tag left, the managed note is always removed. Other
albums' active source notes remain. Existing user descriptions are retained;
only exact text previously written by this integration is removed. Removing or
renaming source tags in the tag UI also updates the notes immediately.

## Deployment

`Dockerfile.custom` at the repository root compiles and tests the WebAssembly
plugin for amd64 and arm64 and installs it under `/opt/noodle-plugins/geofence`.
The server source keeps tags and notes in step with album, tag and asset edits
(`server/src/noodle/geofence/`); Immich has no built-in album membership
workflow trigger. The workload enables external plugins under
`/opt/noodle-plugins`. No companion pod, timer, service, volume or database is
needed.

After the image is deployed, run this from the selfhosted-platform
repository, which deploys Photos (`manifests/photos/`):

```sh
python3 scripts/configure-geofence.py
```

The script securely prompts for a management API key, confirms the plugin is
installed, and configures one `AssetMetadataExtraction` workflow. It provisions
or reuses a dedicated runtime key with only these permissions:

- `album.read`, `albumAsset.create`
- `asset.read`, `asset.update`
- `tag.read`, `tag.create`, `tag.update`, `tag.asset`

The management key needs user/plugin/workflow reads, workflow creation/update,
and API key creation/update. It is not stored in the workflow. Rerunning setup
preserves the activation timestamp, runtime credential, and album-to-tag IDs.
The runtime key is stored in the owner's workflow configuration, never in Git or
the image. Do not share that workflow's JSON. The plugin avoids the standard
SDK wrapper's configuration debug dump. HTTP access is restricted to
photos.quickme.at.

## State, retries and synchronization

The workflow's `sourceTags` map binds album IDs to tag IDs, allowing album/tag
renames without losing image assignments. It stores no image source membership:
that comes exclusively from tags. Server hooks update this identity map under a
database row lock, safely across both server pods. A request made with the
runtime key is recognized as automatic, so it does not attach new source tags.

Asset metadata `noodle-geofence-v1` stores per-image processing completion and
planned target albums. Retries recheck current membership, source tags and the
album's `!`. Already processed images and images uploaded before activation are
never retrospectively sorted. `noodle-geofence-description-v1` records the exact
text fragments added to descriptions for safe removal and retry.

Create albums and add sources before uploading the images to collect. Upload
time determines eligibility, not the date the picture was taken. Images without
valid GPS cannot supply a location or match a nearby source yet. Their source
tag is retained and the German note explains that a location must be added.
Metadata extraction and manual location edits refresh the note automatically.
Locked images and videos are excluded. Only this account's owned
albums and editable source images are managed. Large albums may increase job
latency. A failed tag/note update is logged without failing the album operation;
a subsequent album/tag edit retries synchronization.

## Development

```sh
cd noodle/plugins/geofence
npm ci
npm test
npm run build
# Install Binaryen (wasm-merge/wasm-opt) and extism-js v1.7.0 first.
# This compiler release reports 1.6.1.
extism-js dist/index.js -i dist/index.d.ts -o dist/plugin.wasm
npm run test:wasm
```

Tests cover GPS/radius checks, no backfill, source removal and retries here;
nested tag isolation, retained tags, description preservation and tag identity
on rename are tested with the server code
(`server/src/noodle/geofence/source-notes.spec.ts`).
The WASM test exercises the exported HTTP host ABI using the deployment's Extism
runtime version. Interfaces were checked against Immich v3.3.5 and the deployed
Gallery service code.

When a tagged image has no location yet, its note reads:

> Diesem Bild fehlt ein Ort. Füge einen Ort hinzu, damit neue Bilder aus der Nähe
> (bis zu 250 Meter) automatisch in das Album „!Urlaub“ kommen. Entferne den
> Standortquellen Tag, wenn du das nicht mehr möchtest.

Note synchronization uses a per-process queue and an advisory database lock per
image, avoiding stale notes when direct uploads, tagging and metadata extraction
overlap. Automatic description writes skip the asset-edit hook; sidecar writes
skip the extraction hook to prevent loops.
