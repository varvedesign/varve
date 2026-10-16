//! Varve room host: authoritative semantic-operation relay for real-time
//! collaboration (ADR-0200).
//!
//! Library use (app-hosted sessions): construct a [`HostConfig`], open a
//! [`RoomHost`], and [`serve`] it on `127.0.0.1:0`; create rooms and mint
//! invites through the admin API. Binary use (self-hosted): the
//! `varve-room-server` binary wires the same host to a configurable bind
//! address and data directory.
//!
//! Trust model: the host authenticates sessions (invite tokens, hashed at
//! rest), enforces roles, sequence, size, and rate limits, and persists an
//! ordered operation journal with snapshots. It cannot validate design
//! semantics — every receiving client validates captures through its own
//! operation registry and resynchronizes rather than guessing.

pub mod join;
pub mod protocol;
pub mod server;
pub mod store;
pub mod token;

pub use protocol::{ClientMessage, ServerMessage};
pub use server::{
    serve, serve_on_current_runtime, serve_with_handle, AdminRoom, HostConfig, RoomHost,
};
pub use store::RoomStore;
