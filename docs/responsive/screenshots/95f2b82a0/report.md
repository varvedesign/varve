# Responsive validation report

- Commit: 95f2b82a0
- Generated: 2026-10-29T23:39:18.336Z
- Command: node scripts/validate-responsive.mjs --app all --reuse-website-dist
- Result: PASS (152/152 checks)
- Screenshots: 41 PNGs (18017089 bytes)
- Output: docs/responsive/screenshots/95f2b82a0

## Editor

| Viewport | Result | doc scrollWidth / innerWidth | Share right | Pills | Screenshot |
| --- | --- | --- | --- | --- | --- |
| phone-320x640 | PASS | 320 / 320 | 312 | 4/4 | editor/phone-320x640-default.png |
| phone-375x667 | PASS | 375 / 375 | 366.9 | 4/4 | editor/phone-375x667-default.png |
| phone-390x844 | PASS | 390 / 390 | 381.9 | 4/4 | editor/phone-390x844-default.png |
| tablet-768x1024 | PASS | 768 / 768 | 759.3 | 4/4 | editor/tablet-768x1024-default.png |
| tablet-820x1180 | PASS | 820 / 820 | 811.3 | 4/4 | editor/tablet-820x1180-default.png |
| tablet-1024x768 | PASS | 1024 / 1024 | 1015 | 4/4 | editor/tablet-1024x768-default.png |
| tablet-1024x1366 | PASS | 1024 / 1024 | 1015 | 4/4 | editor/tablet-1024x1366-default.png |
| 13in-125pct-scaling-1093x614 | PASS | 1093 / 1093 | 1083.8 | 4/4 | editor/13in-125pct-scaling-1093x614-default.png |
| 13in-window-default-1180x720 | PASS | 1180 / 1180 | 1170.7 | 4/4 | editor/13in-window-default-1180x720-default.png |
| tablet-1180x820 | PASS | 1180 / 1180 | 1170.7 | 4/4 | editor/tablet-1180x820-default.png |
| tablet-1366x1024 | PASS | 1366 / 1366 | 1356.4 | 4/4 | editor/tablet-1366x1024-default.png |
| laptop-1280x800 | PASS | 1280 / 1280 | 1270.6 | 4/4 | editor/laptop-1280x800-default.png |
| laptop-1366x768 | PASS | 1366 / 1366 | 1356.4 | 4/4 | editor/laptop-1366x768-default.png |
| laptop-1440x900 | PASS | 1440 / 1440 | 1430.3 | 4/4 | editor/laptop-1440x900-default.png |
| laptop-1512x982 | PASS | 1512 / 1512 | 1502.2 | 4/4 | editor/laptop-1512x982-default.png |
| desktop-1536x864 | PASS | 1536 / 1536 | 1526.2 | 4/4 | editor/desktop-1536x864-default.png |

## Website

| Route | Viewport | Result | doc scrollWidth / innerWidth | Screenshot |
| --- | --- | --- | --- | --- |
| / | phone-320x800 | PASS | 320 / 320 | website/home-320x800.png |
| / | phone-375x800 | PASS | 375 / 375 | website/home-375x800.png |
| / | tablet-768x900 | PASS | 768 / 768 | website/home-768x900.png |
| / | laptop-1366x900 | PASS | 1366 / 1366 | website/home-1366x900.png |
| /product | phone-320x800 | PASS | 320 / 320 | website/product-320x800.png |
| /product | phone-375x800 | PASS | 375 / 375 | website/product-375x800.png |
| /product | tablet-768x900 | PASS | 768 / 768 | website/product-768x900.png |
| /product | laptop-1366x900 | PASS | 1366 / 1366 | website/product-1366x900.png |
| /download | phone-320x800 | PASS | 320 / 320 | website/download-320x800.png |
| /download | phone-375x800 | PASS | 375 / 375 | website/download-375x800.png |
| /download | tablet-768x900 | PASS | 768 / 768 | website/download-768x900.png |
| /download | laptop-1366x900 | PASS | 1366 / 1366 | website/download-1366x900.png |
| /about/license | phone-320x800 | PASS | 320 / 320 | website/about-license-320x800.png |
| /about/license | phone-375x800 | PASS | 375 / 375 | website/about-license-375x800.png |
| /about/license | tablet-768x900 | PASS | 768 / 768 | website/about-license-768x900.png |
| /about/license | laptop-1366x900 | PASS | 1366 / 1366 | website/about-license-1366x900.png |
| /docs/performance | phone-320x800 | PASS | 320 / 320 | website/docs-performance-320x800.png |
| /docs/performance | phone-375x800 | PASS | 375 / 375 | website/docs-performance-375x800.png |
| /docs/performance | tablet-768x900 | PASS | 768 / 768 | website/docs-performance-768x900.png |
| /docs/performance | laptop-1366x900 | PASS | 1366 / 1366 | website/docs-performance-1366x900.png |

## Failures

None.

## Notes

- .editor-status and .editor-menubar__left may scroll internally; measured, not asserted.
- Editor screenshots are viewport-sized; website screenshots are full page.