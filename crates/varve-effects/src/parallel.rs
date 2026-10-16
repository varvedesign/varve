//! Bounded row-band parallelism for the pixel kernels.
//!
//! Every kernel in this crate computes each output pixel from read-only inputs
//! with the same arithmetic in the same order, so handing disjoint bands of
//! output rows to different threads cannot change a single byte; the parity
//! tests (`tests/parallel_parity.rs`) assert exactly that against checksums of
//! the pre-parallel output and against the TypeScript reference fixtures.
//!
//! The parallelism is bounded on every axis:
//!
//! - at most [`Execution::MAX_THREADS`] threads, caller included;
//! - never more than the machine can spare: one core is always left free, so a
//!   two-core machine runs scalar;
//! - no threads at all for work smaller than `min_band_items` per band, where
//!   spawning would cost more than it saves;
//! - `std::thread::scope`, so nothing outlives the call and a panic in a band
//!   propagates to the caller;
//! - the scalar path is the same code with one band, and is always selectable
//!   ([`Execution::scalar`], or `VARVE_EFFECT_THREADS=1`).
//!
//! No `unsafe` and no explicit SIMD: `unsafe_code` is denied workspace-wide and
//! `std::simd` is unstable. Whether the compiler vectorizes a loop is neither
//! claimed nor relied on here.

use std::num::NonZeroUsize;
use std::sync::OnceLock;

/// How a kernel may use threads. `Copy`, so it threads through call sites cheaply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Execution {
    threads: usize,
    min_band_items: usize,
}

impl Execution {
    /// Hard ceiling on threads (the calling thread counts as one).
    pub const MAX_THREADS: usize = 4;

    /// Smallest slice of work, in output elements (bytes for RGBA buffers), worth
    /// giving its own thread. 128 Ki elements is 32 Ki RGBA pixels: a band that
    /// size costs milliseconds even for the cheapest kernel here, against tens of
    /// microseconds to spawn a thread.
    pub const DEFAULT_MIN_BAND_ITEMS: usize = 128 * 1024;

    /// No threads: every kernel runs on the calling thread as one band.
    pub const fn scalar() -> Self {
        Self {
            threads: 1,
            min_band_items: Self::DEFAULT_MIN_BAND_ITEMS,
        }
    }

    /// Up to [`Self::MAX_THREADS`] threads, leaving one core free, further capped
    /// by the `VARVE_EFFECT_THREADS` environment variable when it is set.
    pub fn bounded() -> Self {
        Self {
            threads: default_threads(),
            min_band_items: Self::DEFAULT_MIN_BAND_ITEMS,
        }
    }

    /// An explicit thread count, clamped to `1..=MAX_THREADS`. For tests and
    /// benchmarks that need a specific degree of parallelism.
    pub const fn with_threads(threads: usize) -> Self {
        let clamped = if threads < 1 {
            1
        } else if threads > Self::MAX_THREADS {
            Self::MAX_THREADS
        } else {
            threads
        };
        Self {
            threads: clamped,
            min_band_items: Self::DEFAULT_MIN_BAND_ITEMS,
        }
    }

    /// Override the per-band work floor (tests use 1 to force a split on small
    /// images).
    pub const fn with_min_band_items(self, min_band_items: usize) -> Self {
        Self {
            threads: self.threads,
            min_band_items: if min_band_items < 1 {
                1
            } else {
                min_band_items
            },
        }
    }

    /// Threads this policy may use, caller included.
    pub const fn threads(&self) -> usize {
        self.threads
    }

    /// Bands to split `rows` rows of `data_len / rows` items into: as many as the
    /// thread budget and the work floor allow, never more than there are rows.
    pub fn bands_for(&self, rows: usize, data_len: usize) -> usize {
        if self.threads <= 1 || rows < 2 {
            return 1;
        }
        let by_work = data_len / self.min_band_items.max(1);
        self.threads.min(by_work).min(rows).max(1)
    }
}

impl Default for Execution {
    fn default() -> Self {
        Self::bounded()
    }
}

fn default_threads() -> usize {
    static THREADS: OnceLock<usize> = OnceLock::new();
    *THREADS.get_or_init(|| {
        let available = std::thread::available_parallelism().map_or(1, NonZeroUsize::get);
        let mut threads = available.saturating_sub(1).clamp(1, Execution::MAX_THREADS);
        if let Some(limit) = std::env::var("VARVE_EFFECT_THREADS")
            .ok()
            .and_then(|value| value.trim().parse::<usize>().ok())
        {
            threads = threads.min(limit.max(1));
        }
        threads
    })
}

/// Run `f(first_row, band)` over disjoint bands of whole rows of `data`.
///
/// `row_len` is the number of items in one row; `data.len()` must be a multiple
/// of it. `first_row` is the index of the band's first row within `data`. The
/// bands are contiguous, cover `data` exactly once, and the first band runs on
/// the calling thread. With one band (scalar policy, tiny input, a single row)
/// `f` is simply called once with all of `data`.
pub fn for_each_row_band<T, F>(data: &mut [T], row_len: usize, exec: Execution, f: F)
where
    T: Send,
    F: Fn(usize, &mut [T]) + Sync,
{
    if row_len == 0 || data.is_empty() {
        return;
    }
    debug_assert_eq!(
        data.len() % row_len,
        0,
        "data is not a whole number of rows"
    );
    let rows = data.len() / row_len;
    let bands = exec.bands_for(rows, data.len());
    if bands <= 1 {
        f(0, data);
        return;
    }
    let rows_per_band = rows.div_ceil(bands);
    std::thread::scope(|scope| {
        let mut chunks = data.chunks_mut(rows_per_band * row_len).enumerate();
        let first = chunks.next();
        for (index, chunk) in chunks {
            let f = &f;
            scope.spawn(move || f(index * rows_per_band, chunk));
        }
        if let Some((index, chunk)) = first {
            f(index * rows_per_band, chunk);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thread_count_is_clamped_and_never_zero() {
        assert_eq!(Execution::with_threads(0).threads(), 1);
        assert_eq!(Execution::with_threads(3).threads(), 3);
        assert_eq!(
            Execution::with_threads(64).threads(),
            Execution::MAX_THREADS
        );
        assert_eq!(Execution::scalar().threads(), 1);
        assert!(Execution::bounded().threads() >= 1);
        assert!(Execution::bounded().threads() <= Execution::MAX_THREADS);
    }

    #[test]
    fn tiny_work_and_single_rows_stay_on_one_band() {
        let exec = Execution::with_threads(4);
        assert_eq!(exec.bands_for(100, 1000), 1);
        assert_eq!(exec.bands_for(1, 10_000_000), 1);
        assert_eq!(exec.bands_for(100, 10_000_000), 4);
        // The work floor, not the thread cap, limits a mid-sized image.
        assert_eq!(
            exec.bands_for(100, 2 * Execution::DEFAULT_MIN_BAND_ITEMS),
            2
        );
        assert_eq!(Execution::scalar().bands_for(100, 10_000_000), 1);
    }

    #[test]
    fn bands_never_exceed_rows() {
        let exec = Execution::with_threads(4).with_min_band_items(1);
        assert_eq!(exec.bands_for(3, 300), 3);
        assert_eq!(exec.bands_for(2, 200), 2);
    }

    #[test]
    fn every_row_is_visited_exactly_once_with_its_true_index() {
        for rows in [1usize, 2, 3, 4, 5, 7, 8, 13, 64, 101] {
            for threads in 1..=4 {
                let row_len = 5;
                let mut data = vec![0u32; rows * row_len];
                let exec = Execution::with_threads(threads).with_min_band_items(1);
                for_each_row_band(&mut data, row_len, exec, |first_row, band| {
                    for (r, row) in band.chunks_mut(row_len).enumerate() {
                        for item in row {
                            *item += (first_row + r) as u32 + 1;
                        }
                    }
                });
                for (r, row) in data.chunks(row_len).enumerate() {
                    assert!(
                        row.iter().all(|&v| v == r as u32 + 1),
                        "rows={rows} threads={threads} row {r}: {row:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn empty_and_zero_width_inputs_are_no_ops() {
        let mut empty: Vec<u8> = Vec::new();
        for_each_row_band(&mut empty, 4, Execution::with_threads(4), |_, _| {
            panic!("must not be called")
        });
        let mut data = vec![1u8; 8];
        for_each_row_band(&mut data, 0, Execution::with_threads(4), |_, _| {
            panic!("must not be called")
        });
    }

    #[test]
    fn a_panic_in_a_band_reaches_the_caller() {
        let result = std::panic::catch_unwind(|| {
            let mut data = vec![0u8; 400];
            let exec = Execution::with_threads(4).with_min_band_items(1);
            for_each_row_band(&mut data, 4, exec, |first_row, _| {
                if first_row > 0 {
                    panic!("band failure");
                }
            });
        });
        assert!(result.is_err());
    }
}
