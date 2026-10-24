//! Opt-in audit adapter: execute production TensorSession/VNT1 using real ORT.
//! Length-prefixed packets on stdin/stdout; one graph/session per process.
//! This is not a desktop IPC replacement or a production fallback.

#[cfg(feature = "ai")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use std::io::{Read, Write};
    use std::path::Path;
    use varve_bgremove::{tensor_runtime::TensorSession, tensor_wire, InferenceCancellationToken};

    let path = std::env::args().nth(1).ok_or("expected ONNX graph path")?;
    let library = std::env::var("ORT_DYLIB_PATH")?;
    ort::init_from(library)?.commit();
    let mut session = TensorSession::open(Path::new(&path))?;
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    loop {
        let mut length = [0u8; 4];
        if input.read(&mut length[..1])? == 0 {
            break;
        }
        input.read_exact(&mut length[1..])?;
        let length = u32::from_le_bytes(length) as usize;
        if !(8..=256 * 1024 * 1024).contains(&length) {
            return Err("invalid packet length".into());
        }
        let mut packet = vec![0; length];
        input.read_exact(&mut packet)?;
        let (mut context, tensors) = tensor_wire::decode(&packet)?;
        drop(packet);
        let result = session.run(tensors, &InferenceCancellationToken::default())?;
        context.execution_provider = Some(session.execution_provider().to_owned());
        let packet = tensor_wire::encode(context, &result)?;
        output.write_all(&(packet.len() as u32).to_le_bytes())?;
        output.write_all(&packet)?;
        output.flush()?;
    }
    Ok(())
}

#[cfg(not(feature = "ai"))]
fn main() {
    eprintln!("tensor_stdio requires --features ai and ORT_DYLIB_PATH");
    std::process::exit(1);
}
