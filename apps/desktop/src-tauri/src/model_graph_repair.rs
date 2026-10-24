//! Metadata-only SAM2 repair, equivalent to the web acquisition transform.
//! Parsing is bounded and rejects malformed protobuf instead of reading past it.

#[derive(Clone, Copy)]
struct Field {
    number: u64,
    start: usize,
    tag_end: usize,
    payload_start: usize,
    end: usize,
}

fn varint(bytes: &[u8], cursor: &mut usize) -> Result<u64, String> {
    let mut value = 0u64;
    for shift in (0..70).step_by(7) {
        let byte = *bytes
            .get(*cursor)
            .ok_or("Truncated model protobuf varint")?;
        *cursor += 1;
        if shift == 63 && byte > 1 {
            return Err("Model protobuf varint overflow".into());
        }
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
    }
    Err("Model protobuf varint overflow".into())
}

fn field(bytes: &[u8], cursor: &mut usize) -> Result<Field, String> {
    let start = *cursor;
    let tag = varint(bytes, cursor)?;
    let tag_end = *cursor;
    if tag >> 3 == 0 {
        return Err("Invalid model protobuf field".into());
    }
    let length = match tag & 7 {
        0 => {
            varint(bytes, cursor)?;
            0
        }
        1 => 8,
        2 => usize::try_from(varint(bytes, cursor)?).map_err(|_| "Model field is too large")?,
        5 => 4,
        _ => return Err("Unsupported model protobuf wire type".into()),
    };
    let payload_start = *cursor;
    *cursor = cursor
        .checked_add(length)
        .filter(|end| *end <= bytes.len())
        .ok_or("Truncated model protobuf field")?;
    Ok(Field {
        number: tag >> 3,
        start,
        tag_end,
        payload_start,
        end: *cursor,
    })
}

fn encode_varint(mut value: usize, output: &mut Vec<u8>) {
    while value >= 128 {
        output.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
    output.push(value as u8);
}

fn removes_value_info(bytes: &[u8]) -> Result<bool, String> {
    let mut cursor = 0;
    while cursor < bytes.len() {
        let item = field(bytes, &mut cursor)?;
        if item.number == 1 {
            return Ok(matches!(
                &bytes[item.payload_start..item.end],
                b"/conv_s0/Conv_output_0" | b"/conv_s1/Conv_output_0"
            ));
        }
    }
    Ok(false)
}

pub(crate) fn repair_sam2(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut cursor = 0;
    while cursor < bytes.len() {
        let graph = field(bytes, &mut cursor)?;
        if graph.number != 7 {
            continue;
        }
        let payload = &bytes[graph.payload_start..graph.end];
        let mut position = 0;
        let mut kept_start = 0;
        let mut repaired = Vec::with_capacity(payload.len());
        while position < payload.len() {
            let item = field(payload, &mut position)?;
            if item.number == 13 && removes_value_info(&payload[item.payload_start..item.end])? {
                repaired.extend_from_slice(&payload[kept_start..item.start]);
                kept_start = item.end;
            }
        }
        repaired.extend_from_slice(&payload[kept_start..]);
        let mut output = Vec::with_capacity(bytes.len());
        output.extend_from_slice(&bytes[..graph.tag_end]);
        encode_varint(repaired.len(), &mut output);
        output.extend_from_slice(&repaired);
        output.extend_from_slice(&bytes[graph.end..]);
        return Ok(output);
    }
    Err("Model has no ONNX graph".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_protobuf_is_rejected_without_panicking() {
        for bytes in [&[0x3a, 0xff][..], &[0x3a, 2, 0x6a, 5], &[0x80; 12], &[0x00]] {
            assert!(repair_sam2(bytes).is_err());
        }
    }

    #[test]
    fn repair_removes_only_named_value_info_and_keeps_other_model_bytes() {
        let name = b"/conv_s0/Conv_output_0";
        let mut payload = vec![0x0a, name.len() as u8];
        payload.extend_from_slice(name);
        let mut graph = vec![0x6a, payload.len() as u8];
        graph.extend_from_slice(&payload);
        graph.extend_from_slice(&[0x12, 1, b'x']);
        let mut model = vec![0x08, 8, 0x3a, graph.len() as u8];
        model.extend_from_slice(&graph);
        model.extend_from_slice(&[0x12, 1, b'y']);
        assert_eq!(
            repair_sam2(&model).unwrap(),
            [0x08, 8, 0x3a, 3, 0x12, 1, b'x', 0x12, 1, b'y']
        );
    }
}
