/**
 * Tut-P shared design tokens — single source of truth for Tailwind CDN pages.
 *
 * Canonical source: public/index.html, public/app/login/index.html and
 * public/app/child/index.html ("Group A") define byte-identical colors /
 * fontFamily / fontSize / borderRadius / spacing blocks. This file is that
 * block, extracted, so new or updated pages reference one place instead of
 * pasting/re-inventing their own inline <script id="tailwind-config">.
 *
 * Usage — in <head>, after the Tailwind CDN script and before any markup:
 *   <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Plus+Jakarta+Sans:wght@600;700&display=swap" rel="stylesheet"/>
 *   <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
 *   <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
 *   <script src="/shared/tailwind-tokens.js"></script>
 *
 * Extension keys below (not part of Group A's original set) exist so that
 * app/register, app/family, app/mother, and app/father could adopt this file without
 * rewriting their markup's class names:
 *   - fontFamily/fontSize "caption" and "display-lg-mobile" — used by app/register
 *   - fontFamily "headline" / "body" — simple aliases used by app/family, app/mother, and app/father
 *   - fontFamily "display" / "label" — simple aliases used by app/mother and app/father
 *   - colors "success" (#006d35) — a status green for "LIVE"/success/progress UI
 *     (banners, progress bars, success messages) that is NOT part of the Group A
 *     MD3 palette (Group A's "secondary" is amber #805600) and must stay green
 *     regardless of brand-color changes elsewhere.
 */
tailwind.config = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "inverse-surface": "#2d3135","surface-container-highest": "#dfe3e8","secondary": "#805600",
        "inverse-primary": "#adc7ff","on-secondary-fixed-variant": "#614000","primary-fixed-dim": "#adc7ff",
        "secondary-fixed": "#ffddb0","on-secondary-fixed": "#281800","error-container": "#ffdad6",
        "error": "#ba1a1a","background": "#f7f9ff","primary-container": "#1a73e8","outline": "#727785",
        "surface-container-lowest": "#ffffff","on-error": "#ffffff","on-secondary-container": "#694600",
        "inverse-on-surface": "#eef1f7","surface-container-low": "#f1f4fa","on-background": "#181c20",
        "tertiary-fixed": "#89fa9b","surface-container-high": "#e5e8ee","primary": "#005bbf",
        "on-surface": "#181c20","on-secondary": "#ffffff","on-primary-fixed-variant": "#004493",
        "primary-fixed": "#d8e2ff","tertiary-fixed-dim": "#6ddd81","on-tertiary-fixed": "#002108",
        "secondary-fixed-dim": "#ffba45","surface-variant": "#dfe3e8","on-error-container": "#93000a",
        "surface-dim": "#d7dae0","surface": "#f7f9ff","surface-tint": "#005bc0","surface-bright": "#f7f9ff",
        "on-primary": "#ffffff","tertiary-container": "#008939","on-surface-variant": "#414754",
        "on-primary-fixed": "#001a41","on-tertiary-container": "#ffffff","on-tertiary-fixed-variant": "#005320",
        "outline-variant": "#c1c6d6","on-tertiary": "#ffffff","tertiary": "#006d2c","on-primary-container": "#ffffff",
        "surface-container": "#ebeef4","secondary-container": "#fdaf0a",
        // Extension: status green, deliberately not overridden by "secondary".
        "success": "#006d35"
      },
      borderRadius: { "DEFAULT": "1rem", "lg": "2rem", "xl": "3rem", "full": "9999px" },
      spacing: { "xs": "4px", "base": "8px", "sm": "12px", "md": "24px", "lg": "40px", "xl": "64px", "margin-mobile": "20px", "margin-desktop": "120px", "gutter": "16px" },
      fontFamily: {
        "headline-lg-mobile": ["Plus Jakarta Sans"],
        "body-md": ["Inter"],
        "display-lg": ["Plus Jakarta Sans"],
        "headline-lg": ["Plus Jakarta Sans"],
        "headline-md": ["Plus Jakarta Sans"],
        "body-lg": ["Inter"],
        "label-lg": ["Inter"],
        "label-md": ["Inter"],
        // Extension keys, see file header.
        "caption": ["Inter"],
        "display-lg-mobile": ["Plus Jakarta Sans"],
        "headline": ["Plus Jakarta Sans"],
        "display": ["Plus Jakarta Sans"],
        "body": ["Inter"],
        "label": ["Inter"]
      },
      fontSize: {
        "headline-lg-mobile": ["28px", { "lineHeight": "36px", "fontWeight": "700" }],
        "body-md": ["16px", { "lineHeight": "24px", "fontWeight": "400" }],
        "display-lg": ["48px", { "lineHeight": "56px", "letterSpacing": "-0.02em", "fontWeight": "700" }],
        "headline-lg": ["32px", { "lineHeight": "40px", "letterSpacing": "-0.01em", "fontWeight": "700" }],
        "headline-md": ["24px", { "lineHeight": "32px", "fontWeight": "600" }],
        "body-lg": ["18px", { "lineHeight": "28px", "fontWeight": "400" }],
        "label-lg": ["16px", { "lineHeight": "20px", "letterSpacing": "0.01em", "fontWeight": "600" }],
        "label-md": ["14px", { "lineHeight": "18px", "letterSpacing": "0.02em", "fontWeight": "600" }],
        // Extension keys, see file header.
        "caption": ["14px", { "lineHeight": "20px", "fontWeight": "500" }],
        "display-lg-mobile": ["32px", { "lineHeight": "40px", "letterSpacing": "-0.01em", "fontWeight": "700" }]
      }
    }
  }
}
