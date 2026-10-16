//! Local control-endpoint host for Varve automation (ADR-0244).
//!
//! The application owns the protocol; this crate owns the endpoint. See
//! [`relay`] for why that split exists and [`server`] for what the transport
//! is and is not allowed to decide.
pub mod endpoint;
pub mod framing;
pub mod relay;
pub mod server;
