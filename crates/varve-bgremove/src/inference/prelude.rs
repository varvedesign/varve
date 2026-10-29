//! Shared imports for the inference modules.
//!
//! Every inference module starts with a prelude glob import so the external
//! dependency imports and crate-module aliases exist exactly once.

#![allow(unused_imports)]

pub(crate) use image::{DynamicImage, GenericImageView, ImageBuffer, Rgba, RgbaImage};
pub(crate) use ort::session::Session;
pub(crate) use std::collections::HashMap;
pub(crate) use std::path::{Path, PathBuf};
pub(crate) use std::sync::{Arc, Mutex, OnceLock};

pub(crate) use crate::session_pool::{
    InferenceCancellationToken, SessionLease, SessionPool, SessionPoolLimits, SessionPoolMetrics,
};
pub(crate) use crate::{heuristic, mask_to_base64, model, RemovalOptions, RemovalResult};
