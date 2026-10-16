//! Invite-token minting and verification.
//!
//! Tokens are 32 random bytes (CSPRNG via `rand`'s thread RNG), encoded
//! base64url without padding. Only the SHA-256 hash is persisted: a stolen
//! database does not leak usable invitations. Verification is
//! constant-time over the digest. Tokens live in URL fragments only — they
//! never appear in server logs, referrers, or the operation journal.

use rand::RngCore;
use sha2::{Digest, Sha256};

/// Mint a fresh invite token (unpadded base64url of 32 random bytes).
pub fn mint_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    base64_url_encode(&bytes)
}

/// SHA-256 digest of a token, hex-encoded (the at-rest form).
pub fn token_hash(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push(CHARS[usize::from(byte >> 4)]);
        hex.push(CHARS[usize::from(byte & 0x0f)]);
    }
    hex
}

/// Constant-time digest comparison.
pub fn token_hash_matches(candidate: &str, stored_hash: &str) -> bool {
    let candidate_hash = token_hash(candidate);
    let candidate_bytes = candidate_hash.as_bytes();
    let stored_bytes = stored_hash.as_bytes();
    if candidate_bytes.len() != stored_bytes.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in candidate_bytes.iter().zip(stored_bytes.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

fn base64_url_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[(triple >> 18 & 0x3f) as usize] as char);
        out.push(ALPHABET[(triple >> 12 & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[(triple >> 6 & 0x3f) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(triple & 0x3f) as usize] as char);
        }
    }
    out
}

const CHARS: &[char] = &[
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f',
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minted_tokens_are_unique_and_url_safe() {
        let a = mint_token();
        let b = mint_token();
        assert_ne!(a, b);
        assert_eq!(a.len(), 43); // 32 bytes base64url unpadded, no padding
        assert!(a
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn hash_verification_is_exact_and_constant_time_safe() {
        let token = mint_token();
        let hash = token_hash(&token);
        assert_eq!(hash.len(), 64);
        assert!(token_hash_matches(&token, &hash));
        assert!(!token_hash_matches(&token, &token_hash(&mint_token())));
    }
}
