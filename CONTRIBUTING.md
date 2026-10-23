Thanks for looking at Varve. Varve is a free, local-first design suite. The app is source-available under FSL-1.1-MIT, and nine of its libraries are open source under MIT OR Apache-2.0. Here is what you can help with today, and how long each one takes to set up.

## Ways to help today

| Lane | Where | Licence | Check command |
|---|---|---|---|
| Docs and examples | `docs/`, `examples/` | Licence of files changed | No build |
| Translations | Translation files | Licence of files changed | Check translated strings in context |
| Plugins in your own repo | Your repository | Your choice | Your checks |
| Testing and device reports | Issues and Discussions | No code contribution | Reproduction steps |
| Libraries: `varve-core`, `varve-colour`, `varve-layout`, `varve-effects`, `varve-media`, `varve-trace`, `varve-upscale`, `varve-bgremove`, `varve-accel` | `crates/` | MIT OR Apache-2.0 | `cargo test -p <crate>` |

App code changes are maintainer-only for now. Ideas for app changes are welcome in [Discussions > Ideas](https://github.com/varvedesign/varve/discussions/categories/ideas).

## Fast setup

- **Docs and examples:** no build is needed.
- **Library:** install Rust 1.82 or newer, then run `cargo test -p <crate>` from the repository root.
- **App:** install Node 22.12 or newer and pnpm, then run `pnpm install`. This downloads onnxruntime.

## Find something to do

- [Good first issues](https://github.com/varvedesign/varve/labels/good%20first%20issue)
- [Help wanted](https://github.com/varvedesign/varve/labels/help%20wanted)
- Ask questions in [Discussions Q&A](https://github.com/varvedesign/varve/discussions/categories/q-a).

## Making a PR

Keep pull requests small and explain what changed and why, with a linked issue where one exists. Sign off each commit with `git commit -s`. The team aims to send a first reply within 5 working days. If CI fails for a reason you cannot fix, such as visual baselines or a flaky job, say so in the PR and the team will rerun or regenerate it. Contributors are never asked to regenerate baselines.

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues using [SECURITY.md](SECURITY.md).

Contributors are credited in release notes.

## Licensing

Your contribution is licensed under the same licence as the files you change.

Developer Certificate of Origin 1.1

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this license document, but changing it is not allowed.

Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

The Varve team
