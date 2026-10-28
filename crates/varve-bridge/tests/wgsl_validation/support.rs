use naga::front::wgsl::parse_str;
use naga::valid::{Capabilities, ValidationFlags, Validator};

// ---- helpers ----

pub(crate) fn validate(wgsl: &str, name: &str, has_entry_points: bool) {
    let module = parse_str(wgsl).unwrap_or_else(|e| panic!("{name}: WGSL parse failed: {e}"));

    if has_entry_points {
        let mut validator = Validator::new(ValidationFlags::all(), Capabilities::all());
        if let Err(e) = validator.validate(&module) {
            // Print the diagnostic with the source for debugging.
            let rich = naga::error::ShaderError {
                source: wgsl.to_string(),
                label: Some(name.to_string()),
                inner: Box::new(e),
            };
            panic!("{name}: WGSL validation failed\n{rich}");
        }
    }
}
