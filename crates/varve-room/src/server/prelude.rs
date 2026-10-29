//! Shared imports for the room-host server modules.
//!
//! Every server module starts with a prelude glob import so the external
//! dependency imports and crate-module aliases exist exactly once.

#![allow(unused_imports)]

pub(crate) use std::collections::HashMap;
pub(crate) use std::net::SocketAddr;
pub(crate) use std::path::PathBuf;
pub(crate) use std::sync::atomic::{AtomicU64, Ordering};
pub(crate) use std::sync::{Arc, Mutex};
pub(crate) use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) use axum::extract::ws::{CloseFrame, Message as WsMessage, WebSocket, WebSocketUpgrade};
pub(crate) use axum::extract::{ConnectInfo, Path as AxumPath, Request, State};
pub(crate) use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
pub(crate) use axum::middleware::Next;
pub(crate) use axum::response::IntoResponse;
pub(crate) use axum::routing::{delete, get, post};
pub(crate) use axum::Router;
pub(crate) use futures_util::{SinkExt, StreamExt};
pub(crate) use serde::Deserialize;
pub(crate) use serde_json::json;
pub(crate) use tokio::sync::{mpsc, watch};

pub(crate) use crate::protocol::{
    capture_payload_like, is_large_capable_frame, ClientMessage, CursorFrame, JournalEntry,
    ParticipantInfo, ParticipantRole, RoomOperation, RoomSnapshot, SelectionFrame, ServerMessage,
    ViewportFrame, MAX_CHAT_LENGTH, MAX_CHUNKED_OPERATION_BYTES, MAX_OPERATION_FRAME_BYTES,
    MAX_PARTICIPANTS, MAX_SELECTION_IDS, MAX_SNAPSHOT_UPLOAD_BYTES,
};
pub(crate) use crate::store::{RoomStore, RoomStoreError};
pub(crate) use crate::token::{mint_token, token_hash, token_hash_matches};
