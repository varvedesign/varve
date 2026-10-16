//! Endpoint layout and instance discovery.
//!
//! This mirrors the layout the CLI already uses, so `varve instances`,
//! `varve mcp --instance <id>` and the MCP `--connect` path work unchanged
//! against the running application:
//!
//! ```text
//! <runtime>/v-<id>/          0700  the kernel-enforced access control
//!                s                 the socket
//!                token       0600  the credential (never in instance.json)
//!                instance.json  0600  identity, endpoint, pid, document
//! ```
//!
//! Two deliberate choices:
//!
//! - **The runtime directory never falls back to a world-writable location.**
//!   `$VARVE_RUNTIME_DIR`, then `$XDG_RUNTIME_DIR/varve`, then `<home>/.varve/run`.
//!   `/tmp` is not used: any user can create a directory there, and a runtime
//!   directory the host does not own is a directory that can read the token.
//! - **An existing instance directory is replaced, not trusted.** `remove_dir_all`
//!   does not follow symlinks, so a planted link inside cannot redirect it.
//!
//! The CLI's `runtimeDirectory()` must keep the same home fallback; the two
//! sides are a contract, not a coincidence.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use rand::RngCore;
use serde::{Deserialize, Serialize};

pub const INSTANCE_SCHEMA: &str = "varve.instance/1";

/// What a client needs to find and describe an endpoint. Never a credential.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstanceRecord {
    pub schema: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    pub mode: String,
    pub pid: u32,
    #[serde(rename = "startedAt")]
    pub started_at: String,
    pub app: AppIdentity,
    pub protocol: String,
    /// Socket path (Unix) or pipe name (Windows).
    pub endpoint: String,
    /// Where the credential lives. The credential itself is never listed.
    #[serde(rename = "tokenFile")]
    pub token_file: String,
    pub document: DocumentIdentity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppIdentity {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocumentIdentity {
    pub id: String,
    pub name: String,
}

/// The connection transport the host could create on this platform.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    UnixSocket,
    /// Named pipes need a Windows-only API. Declared so the gap is visible in
    /// the type rather than discovered at runtime on a user's machine.
    NamedPipe,
}

impl Transport {
    pub const fn for_this_platform() -> Self {
        if cfg!(windows) {
            Transport::NamedPipe
        } else {
            Transport::UnixSocket
        }
    }
}

#[derive(Debug)]
pub struct CreatedEndpoint {
    pub dir: PathBuf,
    pub endpoint: PathBuf,
    pub token_file: PathBuf,
    pub record_path: PathBuf,
    pub token: String,
    pub transport: Transport,
}

fn home_directory() -> io::Result<PathBuf> {
    for key in ["HOME", "USERPROFILE"] {
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() {
                return Ok(PathBuf::from(value));
            }
        }
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "no HOME or USERPROFILE; set VARVE_RUNTIME_DIR to choose a runtime directory explicitly",
    ))
}

/// Create (or verify) a directory only the current user can enter.
pub fn ensure_private_directory(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() || !meta.is_dir() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!(
                        "{} is not a plain directory; refusing to use it for control endpoints",
                        path.display()
                    ),
                ));
            }
            #[cfg(unix)]
            {
                if meta.permissions().mode() & 0o077 != 0 {
                    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
                }
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                let mut builder = fs::DirBuilder::new();
                builder.recursive(true).mode(0o700);
                builder.create(path)?;
            }
            #[cfg(not(unix))]
            {
                fs::create_dir_all(path)?;
            }
        }
        Err(error) => return Err(error),
    }
    Ok(())
}

/// The per-user runtime directory.
pub fn runtime_directory() -> io::Result<PathBuf> {
    let explicit = std::env::var("VARVE_RUNTIME_DIR").ok().filter(|v| !v.is_empty());
    let base = match explicit {
        Some(dir) => PathBuf::from(dir),
        None => match std::env::var("XDG_RUNTIME_DIR") {
            Ok(xdg) if xdg.starts_with('/') => Path::new(&xdg).join("varve"),
            _ => home_directory()?.join(".varve").join("run"),
        },
    };
    ensure_private_directory(&base)?;
    Ok(base)
}

pub fn create_endpoint(
    instance_id: &str,
    transport: Transport,
) -> io::Result<CreatedEndpoint> {
    create_endpoint_at(&runtime_directory()?, instance_id, transport)
}

/// Create an endpoint under an explicit runtime root.
///
/// The root is a parameter rather than environment lookup so a caller can be
/// tested without mutating process state, and so the application can be told
/// where to put its endpoint by the thing that launched it.
pub fn create_endpoint_at(
    root: &Path,
    instance_id: &str,
    transport: Transport,
) -> io::Result<CreatedEndpoint> {
    if matches!(transport, Transport::NamedPipe) {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "the named-pipe transport is not implemented; only the Unix socket host exists today",
        ));
    }
    ensure_private_directory(root)?;
    let short: String = instance_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    let short = if short.is_empty() {
        hex(&random_bytes::<4>())
    } else {
        short
    };
    let dir = root.join(format!("v-{short}"));
    if fs::symlink_metadata(&dir).is_ok() {
        // Replace it: a leftover from a crashed run, or a planted directory.
        // `remove_dir_all` refuses to follow symlinks, so this cannot be
        // redirected into another tree.
        fs::remove_dir_all(&dir)?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700);
        builder.create(&dir)?;
    }
    #[cfg(not(unix))]
    {
        fs::create_dir(&dir)?;
    }
    ensure_private_directory(&dir)?;

    let token = hex(&random_bytes::<32>());
    let token_file = dir.join("token");
    write_private(&token_file, token.as_bytes())?;
    let endpoint = dir.join("s");
    let record_path = dir.join("instance.json");
    Ok(CreatedEndpoint {
        dir,
        endpoint,
        token_file,
        record_path,
        token,
        transport,
    })
}

pub fn write_record(path: &Path, record: &InstanceRecord) -> io::Result<()> {
    let json = serde_json::to_vec(record)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    write_private(path, &json)
}

fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        fs::write(path, bytes)
    }
}

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    rand::rng().fill_bytes(&mut bytes);
    bytes
}

/// Lowercase hex, the encoding the CLI's credential file already uses.
pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[usize::from(byte >> 4)] as char);
        out.push(DIGITS[usize::from(byte & 0x0f)] as char);
    }
    out
}

/// Constant-time credential comparison.
///
/// Length is compared first and may leak; content is not. That is the same
/// trade the CLI makes, and it is enough for a value of fixed known length.
pub fn secret_matches(candidate: &str, expected: &str) -> bool {
    let a = candidate.as_bytes();
    let b = expected.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Read a credential file. Refuses anything that is not a plain, owner-only file.
pub fn read_secret(path: &Path) -> io::Result<String> {
    let meta = fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{} is not a plain file", path.display()),
        ));
    }
    #[cfg(unix)]
    {
        if meta.permissions().mode() & 0o077 != 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("{} is readable by other users", path.display()),
            ));
        }
    }
    Ok(fs::read_to_string(path)?.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A runtime root of our own: tests must never write into the operator's.
    ///
    /// The root is passed explicitly rather than through an environment
    /// variable, because tests run in parallel and a process-global env write
    /// would race with every other test in the binary.
    struct Sandbox {
        dir: PathBuf,
    }

    impl Sandbox {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "varve-ah-test-{name}-{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("sandbox");
            Self { dir }
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn creates_an_owner_only_layout() {
        let sandbox = Sandbox::new("layout");
        let created =
            create_endpoint_at(&sandbox.dir, "connected-abcdef123456", Transport::UnixSocket)
                .unwrap();
        assert!(created.dir.starts_with(&sandbox.dir));
        // The directory name is the sanitized instance id truncated to eight
        // characters, which is what the CLI's createInstanceDirectory() does.
        // The two sides must agree or discovery finds nothing.
        let expected_short: String = "connected-abcdef123456"
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .take(8)
            .collect();
        assert_eq!(
            created.dir.file_name().unwrap().to_str().unwrap(),
            format!("v-{expected_short}")
        );
        assert_eq!(created.token.len(), 64);
        assert_eq!(created.endpoint, created.dir.join("s"));
        #[cfg(unix)]
        {
            let dir_mode = fs::metadata(&created.dir).unwrap().permissions().mode() & 0o777;
            assert_eq!(
                dir_mode, 0o700,
                "instance directory must not be group or other accessible"
            );
            let token_mode = fs::metadata(&created.token_file).unwrap().permissions().mode() & 0o777;
            assert_eq!(token_mode, 0o600, "credential must be owner-only");
        }
    }

    #[test]
    #[cfg(unix)]
    fn refuses_a_symlinked_runtime_directory_instead_of_following_it() {
        let sandbox = Sandbox::new("symlink");
        let link = sandbox.dir.join("link");
        std::os::unix::fs::symlink(&sandbox.dir, &link).unwrap();
        let error = ensure_private_directory(&link).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        // And through the real entry point, not just the helper.
        let error = create_endpoint_at(&link, "x", Transport::UnixSocket).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn replaces_an_existing_instance_directory_instead_of_trusting_it() {
        let sandbox = Sandbox::new("replace");
        let first = create_endpoint_at(&sandbox.dir, "sameworker", Transport::UnixSocket).unwrap();
        let planted = first.dir.join("planted");
        fs::write(&planted, b"planted by someone else").unwrap();
        let second = create_endpoint_at(&sandbox.dir, "sameworker", Transport::UnixSocket).unwrap();
        assert_eq!(second.dir, first.dir);
        assert!(!planted.exists(), "the previous contents must not survive");
        assert_ne!(second.token, first.token, "a new run gets a new credential");
    }

    #[test]
    fn reads_back_the_secret_and_rejects_a_world_readable_one() {
        let sandbox = Sandbox::new("secret");
        let created = create_endpoint_at(&sandbox.dir, "reader", Transport::UnixSocket).unwrap();
        assert_eq!(read_secret(&created.token_file).unwrap(), created.token);
        #[cfg(unix)]
        {
            fs::set_permissions(&created.token_file, fs::Permissions::from_mode(0o644)).unwrap();
            let error = read_secret(&created.token_file).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        }
    }

    #[test]
    #[cfg(unix)]
    fn refuses_a_symlinked_credential_file() {
        let sandbox = Sandbox::new("tokenlink");
        let real = sandbox.dir.join("real-token");
        fs::write(&real, b"abcd").unwrap();
        let link = sandbox.dir.join("token-link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let error = read_secret(&link).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn compares_credentials_without_an_early_exit() {
        assert!(secret_matches("abc", "abc"));
        assert!(!secret_matches("abc", "abd"));
        assert!(!secret_matches("abc", "abcd"));
        assert!(!secret_matches("", "abc"));
    }

    #[test]
    fn refuses_the_unimplemented_named_pipe_transport_loudly() {
        let sandbox = Sandbox::new("pipe");
        let error = create_endpoint_at(&sandbox.dir, "x", Transport::NamedPipe).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Unsupported);
        assert!(error.to_string().contains("named-pipe"));
    }

    #[test]
    fn writes_a_record_that_carries_no_credential() {
        let sandbox = Sandbox::new("record");
        let created = create_endpoint_at(&sandbox.dir, "recorder", Transport::UnixSocket).unwrap();
        let record = InstanceRecord {
            schema: INSTANCE_SCHEMA.to_string(),
            instance_id: "recorder".into(),
            mode: "connected".into(),
            pid: std::process::id(),
            started_at: "2026-10-15T00:00:00.000Z".into(),
            app: AppIdentity { name: "Varve".into(), version: "0.5.1".into() },
            protocol: "varve.control/1".into(),
            endpoint: created.endpoint.to_string_lossy().into(),
            token_file: created.token_file.to_string_lossy().into(),
            document: DocumentIdentity { id: "doc-1".into(), name: "Poster".into() },
        };
        write_record(&created.record_path, &record).unwrap();
        let raw = fs::read_to_string(&created.record_path).unwrap();
        assert!(
            !raw.contains(&created.token),
            "the record must never carry the credential"
        );
        assert!(raw.contains("varve.instance/1"));
        assert_eq!(
            serde_json::from_str::<InstanceRecord>(&raw).unwrap(),
            record,
            "the record round-trips, so the CLI reads what the app wrote"
        );
    }
}
