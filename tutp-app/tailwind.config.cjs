/**
 * Tut-P Tailwind build config — replaces the per-page CDN
 * (cdn.tailwindcss.com?plugins=forms,container-queries) + inline/shared
 * <script id="tailwind-config"> / public/shared/tailwind-tokens.js setup.
 *
 * theme.extend below is ported straight from public/shared/tailwind-tokens.js
 * (colors/borderRadius/spacing/fontFamily/fontSize, including the "success"
 * color and the caption/display-lg-mobile/headline/display/body/label
 * fontFamily+fontSize aliases used by app/register, app/family, app/mother,
 * and app/father) so every page can eventually share this one build output.
 */
module.exports = {
  darkMode: 'class',
  content: ['./public/**/*.html'],
  theme: {
    extend: {
      colors: {
        'inverse-surface': '#2d3135', 'surface-container-highest': '#dfe3e8', 'secondary': '#805600',
        'inverse-primary': '#adc7ff', 'on-secondary-fixed-variant': '#614000', 'primary-fixed-dim': '#adc7ff',
        'secondary-fixed': '#ffddb0', 'on-secondary-fixed': '#281800', 'error-container': '#ffdad6',
        'error': '#ba1a1a', 'background': '#f7f9ff', 'primary-container': '#1a73e8', 'outline': '#727785',
        'surface-container-lowest': '#ffffff', 'on-error': '#ffffff', 'on-secondary-container': '#694600',
        'inverse-on-surface': '#eef1f7', 'surface-container-low': '#f1f4fa', 'on-background': '#181c20',
        'tertiary-fixed': '#89fa9b', 'surface-container-high': '#e5e8ee', 'primary': '#005bbf',
        'on-surface': '#181c20', 'on-secondary': '#ffffff', 'on-primary-fixed-variant': '#004493',
        'primary-fixed': '#d8e2ff', 'tertiary-fixed-dim': '#6ddd81', 'on-tertiary-fixed': '#002108',
        'secondary-fixed-dim': '#ffba45', 'surface-variant': '#dfe3e8', 'on-error-container': '#93000a',
        'surface-dim': '#d7dae0', 'surface': '#f7f9ff', 'surface-tint': '#005bc0', 'surface-bright': '#f7f9ff',
        'on-primary': '#ffffff', 'tertiary-container': '#008939', 'on-surface-variant': '#414754',
        'on-primary-fixed': '#001a41', 'on-tertiary-container': '#ffffff', 'on-tertiary-fixed-variant': '#005320',
        'outline-variant': '#c1c6d6', 'on-tertiary': '#ffffff', 'tertiary': '#006d2c', 'on-primary-container': '#ffffff',
        'surface-container': '#ebeef4', 'secondary-container': '#fdaf0a',
        // Extension: status green, deliberately not overridden by "secondary".
        'success': '#006d35'
      },
      borderRadius: { DEFAULT: '1rem', lg: '2rem', xl: '3rem', full: '9999px' },
      spacing: { xs: '4px', base: '8px', sm: '12px', md: '24px', lg: '40px', xl: '64px', 'margin-mobile': '20px', 'margin-desktop': '120px', gutter: '16px' },
      fontFamily: {
        'headline-lg-mobile': ['Plus Jakarta Sans'],
        'body-md': ['Inter'],
        'display-lg': ['Plus Jakarta Sans'],
        'headline-lg': ['Plus Jakarta Sans'],
        'headline-md': ['Plus Jakarta Sans'],
        'body-lg': ['Inter'],
        'label-lg': ['Inter'],
        'label-md': ['Inter'],
        // Extension keys, ported from public/shared/tailwind-tokens.js.
        'caption': ['Inter'],
        'display-lg-mobile': ['Plus Jakarta Sans'],
        'headline': ['Plus Jakarta Sans'],
        'display': ['Plus Jakarta Sans'],
        'body': ['Inter'],
        'label': ['Inter']
      },
      fontSize: {
        'headline-lg-mobile': ['28px', { lineHeight: '36px', fontWeight: '700' }],
        'body-md': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'display-lg': ['48px', { lineHeight: '56px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-lg': ['32px', { lineHeight: '40px', letterSpacing: '-0.01em', fontWeight: '700' }],
        'headline-md': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '28px', fontWeight: '400' }],
        'label-lg': ['16px', { lineHeight: '20px', letterSpacing: '0.01em', fontWeight: '600' }],
        'label-md': ['14px', { lineHeight: '18px', letterSpacing: '0.02em', fontWeight: '600' }],
        // Extension keys, ported from public/shared/tailwind-tokens.js.
        'caption': ['14px', { lineHeight: '20px', fontWeight: '500' }],
        'display-lg-mobile': ['32px', { lineHeight: '40px', letterSpacing: '-0.01em', fontWeight: '700' }]
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries')
  ]
};
