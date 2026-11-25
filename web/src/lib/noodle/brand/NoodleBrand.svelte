<!--
  Noodle Gallery branding, mounted once from the root layout. See noodle/brand/README.md.

  - Web fonts: Google Sans (UI), Google Sans Flex (album titles, requested with axis
    ranges so the CDN serves the variable font) and Google Sans Text (sidebar labels).
    The shipped GoogleSans/GoogleSansCode stay as offline fallbacks.
  - CSS overrides by concern, in ./css (imported in order below).
  - @immich/ui's own Logo component (admin pages, palettes) shows the Noodle wordmark
    and mark instead of the Immich ones.
  - Spellcheck squiggles only while a title/description field is focused.
-->
<script lang="ts">
  import { installSpellcheckOnFocus } from '#lib/noodle/spellcheck-focus.ts';
  import {
    immichFutoDark,
    immichFutoLight,
    immichLogoStackedDark,
    immichLogoStackedLight,
    logoManager,
  } from '@immich/ui';
  import { onMount } from 'svelte';
  import './css/05-ui-fonts.css';
  import './css/10-accent-colors.css';
  import './css/20-logo.css';
  import './css/30-topbar-controls.css';
  import './css/40-sidebar-labels.css';
  import './css/50-album-title.css';

  const fonts =
    'https://fonts.googleapis.com/css2?family=Google+Sans:wght@400..700&family=Google+Sans+Code:wght@300..800&family=Google+Sans+Flex:wdth,wght,ROND@25..151,1..1000,0..100&family=Google+Sans+Text:wght@500;700&display=swap';

  logoManager.setLogo({
    stacked: { light: immichLogoStackedLight, dark: immichLogoStackedDark },
    unstacked: { light: '/gallery-logo-inline-light.svg', dark: '/gallery-logo-inline-dark.svg' },
    stacked_futo: { light: immichFutoLight, dark: immichFutoDark },
    icon: '/gallery-logo-mark.svg',
  });

  onMount(() => installSpellcheckOnFocus(document));
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link rel="stylesheet" href={fonts} />
</svelte:head>
