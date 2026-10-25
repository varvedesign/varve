//! Request-scoped native inference cancellation. The job guard lives inside
//! spawn_blocking until computation ends, even if its IPC caller stops waiting.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use varve_bgremove::InferenceCancellationToken;

const MAX_REQUESTS: usize = 128;
const EARLY_CANCEL_TTL: Duration = Duration::from_secs(60);

enum Entry {
    Active(InferenceCancellationToken),
    CancelledBeforeStart(Instant),
}

#[derive(Default)]
pub(crate) struct NativeJobs(Mutex<HashMap<String, Entry>>);

pub(crate) struct NativeJob<'a> {
    owner: &'a NativeJobs,
    id: Option<String>,
    pub(crate) cancellation: InferenceCancellationToken,
}

fn prune(entries: &mut HashMap<String, Entry>) {
    entries.retain(|_, entry| match entry {
        Entry::Active(_) => true,
        Entry::CancelledBeforeStart(time) => time.elapsed() < EARLY_CANCEL_TTL,
    });
}

fn validate_id(id: &str) -> Result<(), String> {
    if !crate::valid_download_request_id(id) {
        return Err("Invalid native inference request id".to_owned());
    }
    Ok(())
}

impl NativeJobs {
    pub(crate) fn start(&self, id: Option<&str>) -> Result<NativeJob<'_>, String> {
        let cancellation = InferenceCancellationToken::default();
        if let Some(id) = id {
            validate_id(id)?;
            let mut entries = self
                .0
                .lock()
                .map_err(|_| "Native job state is unavailable")?;
            prune(&mut entries);
            match entries.get(id) {
                Some(Entry::Active(_)) => return Err("Native request is already active".into()),
                Some(Entry::CancelledBeforeStart(_)) => {
                    entries.remove(id);
                    return Err("Inference cancelled".into());
                }
                None => {}
            }
            if entries.len() >= MAX_REQUESTS {
                return Err("Native request capacity is busy; retry later".into());
            }
            entries.insert(id.to_owned(), Entry::Active(cancellation.clone()));
        }
        Ok(NativeJob {
            owner: self,
            id: id.map(str::to_owned),
            cancellation,
        })
    }

    pub(crate) fn cancel(&self, id: &str) -> Result<(), String> {
        validate_id(id)?;
        let mut entries = self
            .0
            .lock()
            .map_err(|_| "Native job state is unavailable")?;
        prune(&mut entries);
        match entries.get(id) {
            Some(Entry::Active(token)) => token.cancel(),
            Some(Entry::CancelledBeforeStart(_)) => {}
            None => {
                if entries.len() >= MAX_REQUESTS {
                    return Err("Native request capacity is busy; retry later".into());
                }
                entries.insert(id.to_owned(), Entry::CancelledBeforeStart(Instant::now()));
            }
        }
        Ok(())
    }
}

impl Drop for NativeJob<'_> {
    fn drop(&mut self) {
        if let (Some(id), Ok(mut entries)) = (&self.id, self.owner.0.lock()) {
            entries.remove(id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_targets_only_its_request_and_guard_owns_cleanup() {
        let jobs = NativeJobs::default();
        let first = jobs.start(Some("first")).unwrap();
        let second = jobs.start(Some("second")).unwrap();
        jobs.cancel("first").unwrap();
        assert!(first.cancellation.is_cancelled());
        assert!(!second.cancellation.is_cancelled());
        assert!(jobs.start(Some("first")).is_err());
        drop(first);
        assert!(!jobs
            .start(Some("first"))
            .unwrap()
            .cancellation
            .is_cancelled());
        drop(second);
        assert!(jobs.0.lock().unwrap().is_empty());
    }

    #[test]
    fn cancellation_before_start_prevents_late_work() {
        let jobs = NativeJobs::default();
        jobs.cancel("early").unwrap();
        assert!(matches!(jobs.start(Some("early")), Err(error) if error.contains("cancelled")));
        assert!(jobs.0.lock().unwrap().is_empty());
    }

    #[test]
    fn stale_tombstones_expire_but_active_jobs_do_not() {
        let jobs = NativeJobs::default();
        let active = jobs.start(Some("active")).unwrap();
        jobs.0.lock().unwrap().insert(
            "stale".to_owned(),
            Entry::CancelledBeforeStart(Instant::now() - EARLY_CANCEL_TTL),
        );
        let next = jobs.start(Some("stale")).unwrap();
        assert!(!next.cancellation.is_cancelled());
        assert!(jobs.start(Some("active")).is_err());
        drop(active);
    }

    #[test]
    fn unknown_cancellations_are_bounded_and_ids_are_validated() {
        let jobs = NativeJobs::default();
        assert!(jobs.cancel("").is_err());
        assert!(jobs.start(Some("../bad")).is_err());
        for id in 0..MAX_REQUESTS {
            jobs.cancel(&format!("cancel-{id}")).unwrap();
        }
        assert!(jobs.cancel("overflow").is_err());
        assert!(jobs.start(Some("overflow")).is_err());
    }
}
