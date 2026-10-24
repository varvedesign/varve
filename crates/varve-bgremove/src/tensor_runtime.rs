//! Named, typed ONNX tensors for the desktop's shared inference pipeline.
//! Image/model preprocessing stays shared with the web implementation; this
//! boundary executes the actual graph with native ORT and preserves every output.

use crate::inference::{InferenceSession, OrtInferenceRuntime, OrtSession};
use crate::session_pool::InferenceCancellationToken;
use crate::webgpu_ep::InferenceProviderPolicy;
use ort::session::SessionInputValue;
use ort::value::{TensorElementType, ValueType};
use std::borrow::Cow;
use std::collections::HashSet;
use std::path::Path;

pub const MAX_TENSOR_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_TENSORS: usize = 128;

#[derive(Clone, Debug, PartialEq)]
pub enum TensorData {
    Float32(Vec<f32>),
    Int64(Vec<i64>),
    Bool(Vec<bool>),
}

#[derive(Clone, Debug, PartialEq)]
pub struct NamedTensor {
    pub name: String,
    pub dims: Vec<usize>,
    pub data: TensorData,
}

impl NamedTensor {
    pub fn byte_len(&self) -> Result<usize, String> {
        if self.name.is_empty() || self.name.len() > 256 || self.dims.len() > 8 {
            return Err("Invalid native tensor name or rank".into());
        }
        let elements = self.dims.iter().try_fold(1usize, |count, &dim| {
            if dim > 1_000_000 {
                return Err("Native tensor dimension is too large");
            }
            count.checked_mul(dim).ok_or("Native tensor shape overflow")
        })?;
        let (length, width) = match &self.data {
            TensorData::Float32(data) => {
                if data.iter().any(|value| !value.is_finite()) {
                    return Err(format!("Tensor '{}' contains non-finite values", self.name));
                }
                (data.len(), 4)
            }
            TensorData::Int64(data) => (data.len(), 8),
            TensorData::Bool(data) => (data.len(), 1),
        };
        if length != elements {
            return Err(format!(
                "Tensor '{}' shape does not match its data",
                self.name
            ));
        }
        elements
            .checked_mul(width)
            .filter(|bytes| *bytes <= MAX_TENSOR_BYTES)
            .ok_or_else(|| "Native tensor exceeds the byte limit".into())
    }
}

pub fn validate_tensors(tensors: &[NamedTensor]) -> Result<usize, String> {
    if tensors.is_empty() || tensors.len() > MAX_TENSORS {
        return Err("Invalid native tensor count".into());
    }
    let mut names = HashSet::new();
    let mut bytes = 0usize;
    for tensor in tensors {
        if !names.insert(&tensor.name) {
            return Err(format!("Duplicate tensor '{}'", tensor.name));
        }
        bytes = bytes
            .checked_add(tensor.byte_len()?)
            .filter(|bytes| *bytes <= MAX_TENSOR_BYTES)
            .ok_or("Native tensor packet exceeds the byte limit")?;
    }
    Ok(bytes)
}

pub struct TensorSession {
    session: OrtSession,
}

impl TensorSession {
    /// Generic models use the bundled CPU provider. This does not advertise
    /// unqualified GPU execution or use a browser WASM runtime on desktop.
    pub fn open(path: &Path) -> Result<Self, String> {
        Ok(Self {
            session: OrtInferenceRuntime
                .create_session_with_policy(path, InferenceProviderPolicy::Cpu)?,
        })
    }

    pub fn input_names(&self) -> Vec<String> {
        self.session.input_names()
    }

    pub fn output_names(&self) -> Vec<String> {
        self.session.output_names()
    }

    pub fn execution_provider(&self) -> &'static str {
        self.session.execution_provider()
    }

    pub fn run(
        &mut self,
        tensors: Vec<NamedTensor>,
        cancellation: &InferenceCancellationToken,
    ) -> Result<Vec<NamedTensor>, String> {
        validate_tensors(&tensors)?;
        if cancellation.is_cancelled() {
            return Err("Inference cancelled".into());
        }
        let expected = self.input_names();
        if tensors.len() != expected.len()
            || expected
                .iter()
                .any(|name| !tensors.iter().any(|tensor| &tensor.name == name))
        {
            return Err(format!(
                "Native model expects these exact inputs: {}",
                expected.join(", ")
            ));
        }
        let options = cancellation.bind_run_options()?;
        let inputs = tensors
            .into_iter()
            .map(|tensor| {
                let value: SessionInputValue<'static> = match tensor.data {
                    TensorData::Float32(data) => {
                        ort::value::Tensor::from_array((tensor.dims, data))
                            .map(SessionInputValue::from)
                    }
                    TensorData::Int64(data) => ort::value::Tensor::from_array((tensor.dims, data))
                        .map(SessionInputValue::from),
                    TensorData::Bool(data) => ort::value::Tensor::from_array((tensor.dims, data))
                        .map(SessionInputValue::from),
                }
                .map_err(|error| format!("Invalid tensor '{}': {error}", tensor.name))?;
                Ok((Cow::Owned(tensor.name), value))
            })
            .collect::<Result<Vec<_>, String>>()?;
        let outputs = self
            .session
            .inner
            .run_with_options(inputs, &options)
            .map_err(|error| format!("Native ONNX inference failed: {error}"))?;
        if cancellation.is_cancelled() {
            return Err("Inference cancelled".into());
        }
        let mut result = Vec::with_capacity(outputs.len());
        let mut bytes = 0usize;
        for (name, value) in outputs.iter() {
            let (dims, data) = match value.dtype() {
                ValueType::Tensor {
                    ty: TensorElementType::Float32,
                    ..
                } => {
                    let (shape, data) = value
                        .try_extract_tensor::<f32>()
                        .map_err(|error| format!("Invalid output '{name}': {error}"))?;
                    reserve_output_bytes(&mut bytes, data.len(), 4)?;
                    (shape.to_vec(), TensorData::Float32(data.to_vec()))
                }
                ValueType::Tensor {
                    ty: TensorElementType::Int64,
                    ..
                } => {
                    let (shape, data) = value
                        .try_extract_tensor::<i64>()
                        .map_err(|error| format!("Invalid output '{name}': {error}"))?;
                    reserve_output_bytes(&mut bytes, data.len(), 8)?;
                    (shape.to_vec(), TensorData::Int64(data.to_vec()))
                }
                ValueType::Tensor {
                    ty: TensorElementType::Bool,
                    ..
                } => {
                    let (shape, data) = value
                        .try_extract_tensor::<bool>()
                        .map_err(|error| format!("Invalid output '{name}': {error}"))?;
                    reserve_output_bytes(&mut bytes, data.len(), 1)?;
                    (shape.to_vec(), TensorData::Bool(data.to_vec()))
                }
                _ => {
                    return Err(format!(
                        "Unsupported native output tensor type for '{name}'"
                    ))
                }
            };
            result.push(NamedTensor {
                name: name.to_owned(),
                dims: dims
                    .into_iter()
                    .map(|dim| usize::try_from(dim).map_err(|_| "Invalid output dimension"))
                    .collect::<Result<_, _>>()?,
                data,
            });
        }
        validate_tensors(&result)?;
        Ok(result)
    }
}

fn reserve_output_bytes(total: &mut usize, count: usize, width: usize) -> Result<(), String> {
    *total = count
        .checked_mul(width)
        .and_then(|bytes| total.checked_add(bytes))
        .filter(|bytes| *bytes <= MAX_TENSOR_BYTES)
        .ok_or("Native output exceeds the tensor byte limit")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tensor_validation_checks_shape_names_and_finiteness() {
        let tensor = NamedTensor {
            name: "input_ids".into(),
            dims: vec![1, 2],
            data: TensorData::Int64(vec![1, i64::MAX]),
        };
        assert_eq!(validate_tensors(std::slice::from_ref(&tensor)).unwrap(), 16);
        assert!(validate_tensors(&[tensor.clone(), tensor.clone()]).is_err());
        assert!(validate_tensors(&[NamedTensor {
            dims: vec![2, 2],
            ..tensor
        }])
        .is_err());
        assert!(validate_tensors(&[NamedTensor {
            name: "x".into(),
            dims: vec![1],
            data: TensorData::Float32(vec![f32::NAN])
        }])
        .is_err());
    }
}
