# The Noodle Gallery fork

`patched` is the newest [open-noodle/gallery](https://github.com/open-noodle/gallery)
release plus the patches listed in `.fork-kit.toml`, for Photos on
`photos.quickme.at`. The patches are ordinary source commits in `server/` and
`web/`, each with its tests; fork-only code lives under `server/src/noodle/`,
`web/src/lib/noodle/` and `noodle/`.

Every push to `patched` builds and releases
`ghcr.io/bierdav/gallery-server:<release>-custom.<n>` (`custom-release.yml`).
`<release>` is the newest upstream release merged into `patched` (`5.11.1` for
`v5.11.1`); `<n>` counts the fork's releases on it. The cluster pins the image
by tag and digest in selfhosted-platform (`manifests/photos/`), where Renovate
proposes new releases. Keep the machine-learning image there
(`ghcr.io/open-noodle/gallery-ml`) on the same upstream release.

## What the patches do

| Patch | Behaviour |
| --- | --- |
| `disk-usage` | The storage meter asks `df` when `statfs` reports an implausible block size (virtiofs, some FUSE filesystems). |
| `storage-quota` | With `IMMICH_STORAGE_QUOTA_BYTES` set, server storage is that quota and the S3 bucket's summed object sizes (refreshed in the background every 15 minutes), not the local scratch volume. |
| `content-disposition` | `filename*` also percent-encodes `! ' ( ) *`. Backblaze B2 rejects raw parens in `response-content-disposition`, so redirect downloads of `NAME(0).jpg` failed. |
| `motion-download` | "Include embedded videos" decides for every motion part in zip downloads, including uploaded `.MOV`/`.MP4` halves. |
| `plugin-upgrades` | A new plugin version updates the installed row by name, so plugin, method and workflow IDs survive. |
| `local-file-delete` | Absolute (pod-local) paths in a `FileDelete` job are unlinked where the job is queued; only S3 keys are queued. The api and microservices pods need no shared volume. |
| `geofence-notes`, `geofence-metadata` | Album, tag and asset edits, and metadata extraction, keep the nearby-album `Standortquelle/<album>` tags and German notes in step. |
| `geofence-plugin` | The `noodle-geofence` WASM workflow plugin, built by `Dockerfile.custom` into `/opt/noodle-plugins/geofence`. See `noodle/plugins/geofence/README.md`. |
| `album-activity` | Comments and likes on every album, not only on albums shared with another user. |
| `spellcheck-focus` | Album title and description show spellcheck squiggles only while being edited. |
| `branding` | Favicons, wordmark, mark and loader; coral accent; Google Sans web fonts; top-bar and sidebar tweaks. See `noodle/brand/README.md`. |
| `container-build` | `docker-bake.hcl` builds upstream's own `server/Dockerfile` from this source and hands it to `Dockerfile.custom` as `gallery-server`, so `server/Dockerfile` stays untouched. |

The image used to be built on Gitea by patching upstream's compiled bundles.
Its `patch-cache-bust.js` renamed patched `_app/immutable` chunks so browsers
would not keep running cached pre-patch code; a source build gives every
changed chunk a new content hash, so it is gone, and so is the removal of
stale `.br`/`.gz` twins (the build precompresses the final files).

## Building and testing

```sh
# Server patches
pnpm --filter immich --filter @immich/sdk --filter @immich/plugin-sdk install --frozen-lockfile
pnpm --filter @immich/sdk build && pnpm --filter @immich/plugin-sdk build
cd server && pnpm exec vitest --config test/vitest.config.mjs run src/noodle

# Web patches (browser tests need Playwright's Chromium)
pnpm --filter immich-web install --frozen-lockfile
cd web && pnpm exec playwright install chromium --only-shell && pnpm exec vitest run src/lib/noodle

# The image
docker buildx bake --set '*.platform=linux/amd64' custom
```

`custom-release.yml` runs on every pull request into `patched` and every push
to it. Its jobs are the required checks:

- `test-server`: typecheck, lint and upstream's whole server unit suite (which
  includes the fork's specs), plus the plugin's own tests.
- `test-web`: svelte-check, typecheck, lint and the whole web unit suite.
- `build (amd64)` and `build (arm64)`: native image builds, each started
  against PostgreSQL and Valkey. The smoke test signs up an admin, checks that
  `noodle-geofence` is installed and that the branded assets are served.

Only a push to `patched` publishes: each architecture by digest, then the
multi-arch manifest as `<release>-custom.<n>`, `sha-<commit>` and `latest`,
plus a git tag and a GitHub release with the digest.

## Keeping up with upstream

[fork-kit](https://github.com/BierDav/fork-kit) runs centrally: the workflow in
`BierDav/fork-kit` syncs every repository where its GitHub App is installed
and `.fork-kit.toml` is on the default branch. It merges the newest
open-noodle/gallery release into `fork-kit/sync` and keeps one pull request
into `patched` open for it. This repository runs only the guard
(`.github/workflows/fork-kit.yml`) and holds no fork-kit credentials.

- **Clean merge, green checks, no upstream `.github/` changes:** the PR merges
  itself, and the push to `patched` publishes a new image.
- **Conflicts:** the PR is labelled `fork-kit:conflict` and lists the
  conflicting files with the patches they belong to. Resolve them on
  `fork-kit/sync` (`npx github:BierDav/fork-kit#v0.3.1 resolve`, or GitHub's
  conflict editor), keeping each patch's behaviour and running its tests, and
  merge the PR yourself.
- **Upstream changed `.github/`:** nothing is pushed until a human has reviewed
  the change and let fork-kit take it.
- **Holding a PR:** add the label `fork-kit:hold` to any PR into `patched`.
  The required check `fork-kit/hold` then fails and auto-merge goes off, so the
  PR cannot merge until the label is removed. It holds that PR only, not
  releases.

## Repository settings this relies on

- `patched` is the default branch.
- **Upstream's workflows are disabled** in this fork: they publish to
  upstream's registries, cut upstream releases (release-please, draft and
  prepare release), deploy docs, build mobile apps, or police upstream's pull
  request conventions. Only `custom-release.yml` and `fork-kit.yml` run.
  Disable any workflow upstream adds when you review its `.github/` change.
- **No fork-kit secrets, variables or environment** here; the central workflow
  has the App's credentials.
- **A ruleset on `patched`:** a pull request and the checks `test-server`,
  `test-web`, `build (amd64)`, `build (arm64)` and `fork-kit/hold`; no force
  pushes or deletion. Repository admins may bypass it.
- **Auto-merge and merge commits** are allowed; the default `GITHUB_TOKEN` is
  read-only (the workflows ask for what they need).
- **The `gallery-server` package is public**, so the cluster pulls it without
  credentials.
