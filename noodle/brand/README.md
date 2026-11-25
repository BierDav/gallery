# Noodle Gallery branding

The branding is part of the web app's source. This folder holds only the
artwork sources and the scripts that rasterise them.

## Where to change what

| I want to change...                                   | Edit this |
|-------------------------------------------------------|-----------|
| Which web fonts load (Google Fonts)                   | `web/src/lib/noodle/brand/NoodleBrand.svelte` (`fonts`) |
| UI font families (Google Sans / Google Sans Code)     | `web/src/lib/noodle/brand/css/05-ui-fonts.css` |
| Accent colour (blue → coral ramp, light + dark)       | `web/src/lib/noodle/brand/css/10-accent-colors.css` |
| Top-bar wordmark size / left spacing                  | `web/src/lib/noodle/brand/css/20-logo.css` |
| Upload / notifications / profile-avatar buttons       | `web/src/lib/noodle/brand/css/30-topbar-controls.css` |
| Sidebar section label (rename "Other" + font)         | `web/src/lib/noodle/brand/css/40-sidebar-labels.css` |
| Album title (font, colour, uppercase, casing on edit) | `web/src/lib/noodle/brand/css/50-album-title.css` |
| Album title/description spellcheck squiggles          | `web/src/lib/noodle/spellcheck-focus.ts` |
| Logos @immich/ui's own `Logo` shows (admin, palettes) | `NoodleBrand.svelte` (`logoManager.setLogo`) |
| Top-bar wordmark artwork ("Noodle Gallery" text)      | `web/static/gallery-logo-inline-{light,dark}.svg` (regenerate: `build-logo.mjs`) |
| Favicon / mark / loader artwork                       | `noodle-gallery-mark.svg` here → favicons via `build-assets.mjs`; copied over `web/static/gallery-logo-mark*.svg` and `gallery-loader*.svg` |

`NoodleBrand.svelte` is mounted once from the root layout
(`web/src/routes/+layout.svelte`) and imports the CSS partials in their
numeric order. Every selector outranks upstream's own (`html.light` over
`.light`, `!important` where components use scoped styles), so the order
against upstream's stylesheet does not matter.

The static files are built and precompressed (`.br`/`.gz`) with the rest of
the web app, so there are no stale precompressed twins to remove any more.

## Assets

- `web/static/favicon*.png`, `favicon.ico`, `apple-icon-180.png`: rasterised
  from `noodle-gallery-mark.svg` (`build-assets.mjs`, needs `sharp` and
  `png-to-ico`).
- `web/static/gallery-logo-inline-{light,dark}.svg`: the top-bar wordmark. Its
  text is outlined from Google Sans, so no runtime font is needed.
- `web/static/gallery-logo-mark*.svg`, `gallery-loader*.svg`: the aperture
  mark (copies of `noodle-gallery-mark.svg`).
- `web/static/icon.svg` (the SVG favicon) is still upstream's, as it was in the
  image-patching build.

## Regenerating artwork

`build-logo.mjs` needs `GoogleSansGF.ttf`, Google Sans decompressed from the
Google Fonts CDN woff2 (it is not checked in here):

    npm i fontkit subset-font sharp png-to-ico
    node build-logo.mjs     # -> gallery-logo-inline-{light,dark}.svg
    node build-assets.mjs   # -> favicons

Copy the results into `web/static/`.
