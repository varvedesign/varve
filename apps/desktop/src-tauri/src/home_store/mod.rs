//! Home domain native commands.
//!
//! Extracted from `lib.rs` (2026-10-28) so new Home groups grow here instead of
//! the monolithic crate root, per docs/architecture/ipc-type-contract.md. Every
//! command is backed by `varve_sync::DocumentStore`; the group queue and schema
//! rules live in docs/plans/agent-infrastructure-campaign-2026-10-28.md.

mod documents;
mod library;
mod model;
mod tags;

pub(crate) use documents::*;
pub(crate) use library::*;
pub(crate) use tags::*;
