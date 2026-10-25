//! Bounded binary tensor transport. Float32, int64 and bool stay byte-exact across
//! the webview boundary (JSON numbers cannot preserve arbitrary int64 values).

use crate::tensor_runtime::{
    validate_tensors, NamedTensor, TensorData, MAX_TENSORS, MAX_TENSOR_BYTES,
};
use serde::{Deserialize, Serialize};

const MAGIC: &[u8; 4] = b"VNT1";
const MAX_HEADER_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TensorContext {
    pub request_id: String,
    pub session_id: String,
    pub model_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_provider: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Dtype {
    Float32,
    Int64,
    Bool,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Descriptor {
    name: String,
    dtype: Dtype,
    dims: Vec<usize>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    context: TensorContext,
    tensors: Vec<Descriptor>,
}

pub fn encode(context: TensorContext, tensors: &[NamedTensor]) -> Result<Vec<u8>, String> {
    let data_bytes = validate_tensors(tensors)?;
    let header = serde_json::to_vec(&Header {
        context,
        tensors: tensors
            .iter()
            .map(|tensor| Descriptor {
                name: tensor.name.clone(),
                dims: tensor.dims.clone(),
                dtype: match tensor.data {
                    TensorData::Float32(_) => Dtype::Float32,
                    TensorData::Int64(_) => Dtype::Int64,
                    TensorData::Bool(_) => Dtype::Bool,
                },
            })
            .collect(),
    })
    .map_err(|error| format!("Invalid tensor header: {error}"))?;
    if header.len() > MAX_HEADER_BYTES {
        return Err("Native tensor header is too large".into());
    }
    let mut bytes = Vec::with_capacity(8 + header.len() + data_bytes);
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&(header.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&header);
    for tensor in tensors {
        match &tensor.data {
            TensorData::Float32(data) => data
                .iter()
                .for_each(|value| bytes.extend_from_slice(&value.to_le_bytes())),
            TensorData::Int64(data) => data
                .iter()
                .for_each(|value| bytes.extend_from_slice(&value.to_le_bytes())),
            TensorData::Bool(data) => bytes.extend(data.iter().map(|value| u8::from(*value))),
        }
    }
    Ok(bytes)
}

pub fn decode(bytes: &[u8]) -> Result<(TensorContext, Vec<NamedTensor>), String> {
    if bytes.len() < 8
        || bytes.len() > MAX_HEADER_BYTES + MAX_TENSOR_BYTES + 8
        || &bytes[..4] != MAGIC
    {
        return Err("Invalid native tensor packet".into());
    }
    let length = u32::from_le_bytes(
        bytes[4..8]
            .try_into()
            .map_err(|_| "Missing tensor header")?,
    ) as usize;
    if length > MAX_HEADER_BYTES || length > bytes.len() - 8 {
        return Err("Invalid native tensor header length".into());
    }
    let header: Header = serde_json::from_slice(&bytes[8..8 + length])
        .map_err(|error| format!("Invalid tensor header: {error}"))?;
    if header.tensors.is_empty() || header.tensors.len() > MAX_TENSORS {
        return Err("Invalid native tensor count".into());
    }
    let mut position = 8 + length;
    let mut tensors = Vec::with_capacity(header.tensors.len());
    for descriptor in header.tensors {
        let width = match descriptor.dtype {
            Dtype::Float32 => 4,
            Dtype::Int64 => 8,
            Dtype::Bool => 1,
        };
        if descriptor.dims.len() > 8 || descriptor.dims.iter().any(|dim| *dim > 1_000_000) {
            return Err("Invalid native tensor shape".into());
        }
        let length = descriptor
            .dims
            .iter()
            .try_fold(width, |bytes: usize, dim| bytes.checked_mul(*dim))
            .filter(|size| *size <= MAX_TENSOR_BYTES)
            .ok_or("Invalid native tensor byte length")?;
        let end = position
            .checked_add(length)
            .filter(|end| *end <= bytes.len())
            .ok_or("Truncated native tensor data")?;
        let data = match descriptor.dtype {
            Dtype::Bool => TensorData::Bool(
                bytes[position..end]
                    .iter()
                    .map(|value| match value {
                        0 => Ok(false),
                        1 => Ok(true),
                        _ => Err("Invalid native boolean value"),
                    })
                    .collect::<Result<Vec<_>, _>>()?,
            ),
            Dtype::Float32 => TensorData::Float32(
                bytes[position..end]
                    .chunks_exact(4)
                    .map(|value| f32::from_le_bytes([value[0], value[1], value[2], value[3]]))
                    .collect(),
            ),
            Dtype::Int64 => TensorData::Int64(
                bytes[position..end]
                    .chunks_exact(8)
                    .map(|value| {
                        i64::from_le_bytes([
                            value[0], value[1], value[2], value[3], value[4], value[5], value[6],
                            value[7],
                        ])
                    })
                    .collect(),
            ),
        };
        position = end;
        tensors.push(NamedTensor {
            name: descriptor.name,
            dims: descriptor.dims,
            data,
        });
    }
    if position != bytes.len() {
        return Err("Trailing native tensor data".into());
    }
    validate_tensors(&tensors)?;
    Ok((header.context, tensors))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> TensorContext {
        TensorContext {
            request_id: "request".into(),
            session_id: "session".into(),
            model_id: "model".into(),
            execution_provider: None,
        }
    }

    #[test]
    fn binary_round_trip_preserves_int64_and_fractional_data() {
        let tensors = vec![
            NamedTensor {
                name: "input_ids".into(),
                dims: vec![1, 2],
                data: TensorData::Int64(vec![i64::MIN, i64::MAX]),
            },
            NamedTensor {
                name: "pixels".into(),
                dims: vec![2],
                data: TensorData::Float32(vec![-0.0, 0.125]),
            },
        ];
        let packet = encode(context(), &tensors).unwrap();
        let (identity, decoded) = decode(&packet).unwrap();
        assert_eq!(identity.model_id, "model");
        assert_eq!(decoded, tensors);
        assert!(decode(&packet[..packet.len() - 1]).is_err());
        let mut extra = packet;
        extra.push(0);
        assert!(decode(&extra).is_err());
    }

    #[test]
    fn malformed_packets_are_rejected_before_tensor_allocation() {
        assert!(decode(b"VNT1\xff\xff\xff\xff").is_err());
        let header = br#"{"context":{"requestId":"r","sessionId":"s","modelId":"m"},"tensors":[{"name":"x","dtype":"float32","dims":[1000000,1000000]}]}"#;
        let mut packet = MAGIC.to_vec();
        packet.extend_from_slice(&(header.len() as u32).to_le_bytes());
        packet.extend_from_slice(header);
        assert!(decode(&packet).is_err());
    }

    #[test]
    fn boolean_cache_flags_round_trip_without_float_coercion() {
        let header = br#"{"context":{"requestId":"r","sessionId":"s","modelId":"trocr-decoder"},"tensors":[{"name":"use_cache_branch","dtype":"bool","dims":[2]}]}"#;
        let mut packet = MAGIC.to_vec();
        packet.extend_from_slice(&(header.len() as u32).to_le_bytes());
        packet.extend_from_slice(header);
        packet.extend_from_slice(&[0, 1]);
        let (identity, tensors) = decode(&packet).expect("TrOCR boolean tensor");
        assert_eq!(encode(identity, &tensors).unwrap(), packet);
        *packet.last_mut().unwrap() = 2;
        assert!(decode(&packet).unwrap_err().contains("boolean"));
    }
}
