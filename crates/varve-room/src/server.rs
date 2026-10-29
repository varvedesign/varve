//! The authoritative room host.
//!
//! One process owns its rooms (single-owner by deployment contract —
//! running two servers against one data directory is a documented
//! misconfiguration, mirroring the tldraw TLSocketRoom rule). The host
//! authenticates connections, orders mutations, acks only after the
//! journal commits, relays presence lossy, and never interprets design
//! semantics — receiving clients validate captures through their
//! operation registry and resynchronize on anything they cannot apply.

mod connection;
mod frames;
mod host;
mod http;
mod lifecycle;
mod operation;
mod prelude;
mod state;

#[cfg(test)]
mod tests;

pub use host::{AdminRoom, HostConfig, RoomHost};
pub use http::router;
pub use lifecycle::{serve, serve_on_current_runtime, serve_with_handle};
