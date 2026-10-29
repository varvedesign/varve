# Real-device safe-area checklist (task 01a)

This host (Linux/Chromium) cannot produce real `env(safe-area-inset-*)`
values. The automated half of the validation is
`pnpm validate:safe-area`, which emulates insets over CDP
(`Emulation.setSafeAreaInsetsOverride`, verified on Chromium 151) and asserts
the shell, drawer, FAB, toast, site header/footer/container, mobile-nav,
consent-card and skip-link geometry. That proves the CSS contract; it does
not prove the OS values. Run this checklist on real hardware before claiming
iOS safe-area support.

## Required runs

| # | Device / mode | Steps | Expected |
|---|---|---|---|
| 1 | iPhone (notched), Safari, installed PWA, portrait | Open the app; open Layers drawer; open the inspector sheet; trigger a toast (e.g. save a copy) | Menubar and tab strip start below the status bar; the sheet stops above the home indicator; toasts sit above the home indicator, not under it; no control under the notch |
| 2 | iPhone (notched), Safari, installed PWA, both landscape rotations | Repeat 1 | Layers/inspector drawers and FABs clear the sensor housing on the notch side; canvas is not clipped by rounded corners |
| 3 | iPad (no notch), Safari, split view and full screen, both orientations | Open editor at 1024x1366 and 1180x820 equivalents | No new gutters compared with 7d81006e6 screenshots (env() = 0); desktop-equivalent layout |
| 4 | iPhone Safari (browser, not installed), landscape | Open https://varve.studio home, download and license pages; open mobile nav sheet; focus the skip link via keyboard | Header content clears the notch; footer content above the home indicator; mobile sheet content inset on all four sides; skip link lands below the status bar |
| 5 | Android (notched), Chrome, home-screen PWA | Editor + site home | `env()` is 0 on Android Chrome today; layout must match the committed screenshots exactly (no double padding) |

## Recording

Copy this table into the release checklist and record the OS/Safari build,
orientation, and pass/fail per row. If a row fails, file the regression
against task 01a and note the failing selector and measured box.