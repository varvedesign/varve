# Linked window-chrome evidence: PhotoCraft #6962 and related reports

Reviewed 2026-10-19 as a follow-up to the frozen cutoff-B inventory. The
cutoff-B issue rows remain unchanged; later updates are recorded here as
supplemental evidence.

## User reports and useful links

- [#6962](https://github.com/storytold/photocraft/issues/6962) reports a black
  window after minimize/Alt+Tab on Windows 10, Intel HD Graphics 4600, OpenGL.
  On Oct 18, the author reported that enabling PhotoCraft's System Title Bar
  fixed the return-to-window black screen while leaving GPU acceleration on.
- [#2687](https://github.com/storytold/photocraft/issues/2687) records Intel HD
  Graphics 4000 on Windows 10. The author confirmed the supplied System Title
  Bar workaround helped. The thread also contains an independent AMD Radeon
  HD 7700M layer-drag lag report; that report is not explained by the title bar.
- [#2339](https://github.com/storytold/photocraft/issues/2339) is explicitly
  closed as a duplicate of #2687. It adds no independent reproduction.
- [#2850](https://github.com/storytold/photocraft/issues/2850) and its linked
  [PR #3626](https://github.com/storytold/photocraft/pull/3626) describe a
  Windows custom-frame offset/caption problem on Intel Haswell OpenGL. PR #3626
  proposes per-frame Win32 style manipulation. At the current review, it is
  still open with maintainer feedback that the proposed resize changes risk
  native snap and shadow behavior. It was not merged, and its claimed closure
  of other taskbar/full-screen reports was challenged.
- [#2246](https://github.com/storytold/photocraft/issues/2246) reported black
  bars and pointer offsets in a Windows 10 borderless window. Its linked
  [PR #2401](https://github.com/storytold/photocraft/pull/2401) was confirmed by
  the reporter in an official build. This is evidence about PhotoCraft's
  custom Win32 frame, not direct evidence about Varve's Tauri/WebView renderer.
- [#3810](https://github.com/storytold/photocraft/issues/3810) reports window
  jumps across monitors. The reporter supplied 100%/125% Windows scaling values
  and said the native title bar did not resolve it. A separate upstream winit
  mixed-DPI handling change was tested. This is a distinct windowing issue and
  remains outside the title-bar fix here.
- [#3225](https://github.com/storytold/photocraft/issues/3225),
  [#3430](https://github.com/storytold/photocraft/issues/3430), and
  [#3550](https://github.com/storytold/photocraft/issues/3550) describe
  taskbar/full-screen behavior. The PR #3626 review did not accept them as
  verified fixes from that change. No shared Varve cause has been established.

## Varve comparison and decision

`packages/platform/src/windowChrome.ts` selects native decorations on Windows
and macOS; its custom title bar is for Linux and the unknown-desktop fallback.
`apps/desktop/src/chrome/TitleBar.tsx` follows that model. But
`apps/desktop/src-tauri/tauri.conf.json` set `decorations: false` in the shared
window entry, so the OS frame the runtime strategy expected was disabled.
This is a concrete configuration mismatch that made the PhotoCraft system
title-bar workaround relevant to Varve.

The fix restores native decorations in the shared Tauri configuration and
overrides the Linux window to keep its custom chrome in
`tauri.linux.conf.json`. Tauri's official [configuration reference](https://v2.tauri.app/reference/config/)
says platform config files merge with the main config; arrays replace whole
arrays, so the Linux file deliberately repeats the complete `main` window
entry. No Win32 style hook or graphics backend change is justified by these
reports.

This addresses the title-bar/configuration path only. It does not claim to fix
old Intel GPU rendering artifacts in a content surface, the separate AMD
drag-performance complaint, mixed-DPI window movement, or taskbar/full-screen
bugs. The Windows packaged app still needs a native minimize/restore visual
check on target hardware or Windows CI before this platform-specific change is
considered fully verified.
