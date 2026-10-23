# Library CI

Pull requests that change only the nine focused Rust libraries use the fast
library CI lane. It runs formatting, Clippy, and the crate tests for each
changed library. Changes elsewhere continue through the regular application
CI lanes.

Run an individual library's test suite locally with:

```bash
cargo test -p <crate>
```

For example, use `cargo test -p varve-core` to check the core library.
