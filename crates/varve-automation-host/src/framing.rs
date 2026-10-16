//! Bounded line framing for the control protocol.
//!
//! The wire format is one UTF-8 JSON document per line, the same framing the
//! stdio MCP transport uses. Two properties matter more than convenience:
//!
//! 1. **An oversize line is discarded as it streams, never buffered and then
//!    rejected.** A client that sends a gigabyte without a newline must cost
//!    constant memory, not the size of its message.
//! 2. **Framing resumes at the next newline.** One bad frame does not desynchronise
//!    the stream, so the client gets one clear error instead of a dead socket.
//!
//! Bytes are decoded only at a line boundary, so a multi-byte character split
//! across two writes reassembles instead of turning into an error. That case is
//! not hypothetical: it is what a 7-byte chunked write of CJK text produces.

/// What the framer found in the bytes it was given.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameEvent {
    /// One complete line. Empty lines are not reported at all.
    Line(String),
    /// A line exceeded the limit and was discarded. Reported once per line.
    Oversize,
    /// A complete line that is not valid UTF-8.
    InvalidUtf8,
}

/// Incremental line splitter with a hard per-line byte limit.
#[derive(Debug)]
pub struct LineFramer {
    limit: usize,
    buffer: Vec<u8>,
    /// True while skipping the remainder of an oversize line.
    discarding: bool,
}

impl LineFramer {
    pub fn new(limit: usize) -> Self {
        Self {
            limit,
            buffer: Vec::new(),
            discarding: false,
        }
    }

    /// Change the limit, for example after the handshake raises the policy.
    /// The new limit applies to the very next byte, so a *lowered* limit cannot
    /// be waited out: a line that now exceeds it is discarded at the next byte
    /// rather than completing under the old, more permissive allowance.
    pub fn set_limit(&mut self, limit: usize) {
        self.limit = limit;
    }

    pub fn limit(&self) -> usize {
        self.limit
    }

    /// `true` while the framer is skipping the tail of an oversize line.
    pub fn is_discarding(&self) -> bool {
        self.discarding
    }

    /// Feed bytes and append whatever they completed.
    pub fn push(&mut self, bytes: &[u8], out: &mut Vec<FrameEvent>) {
        for &byte in bytes {
            if self.discarding {
                if byte == b'\n' {
                    self.discarding = false;
                }
                continue;
            }
            if byte == b'\n' {
                let mut line = std::mem::take(&mut self.buffer);
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                if line.is_empty() {
                    continue;
                }
                match std::str::from_utf8(&line) {
                    Ok(text) => out.push(FrameEvent::Line(text.to_string())),
                    Err(_) => out.push(FrameEvent::InvalidUtf8),
                }
                continue;
            }
            self.buffer.push(byte);
            if self.buffer.len() > self.limit {
                // Drop what we have and keep dropping until the newline. The
                // buffer is cleared here rather than at the newline so the peak
                // stays at the limit instead of the line length.
                self.buffer.clear();
                self.discarding = true;
                out.push(FrameEvent::Oversize);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frames(chunks: &[&[u8]], limit: usize) -> Vec<FrameEvent> {
        let mut framer = LineFramer::new(limit);
        let mut out = Vec::new();
        for chunk in chunks {
            framer.push(chunk, &mut out);
        }
        out
    }

    #[test]
    fn splits_lines_and_tolerates_crlf_and_blank_lines() {
        let events = frames(&[b"{\"a\":1}\n\n{\"b\":2}\r\n"], 1024);
        assert_eq!(
            events,
            vec![
                FrameEvent::Line("{\"a\":1}".into()),
                FrameEvent::Line("{\"b\":2}".into()),
            ]
        );
    }

    #[test]
    fn reassembles_a_multibyte_character_split_across_writes() {
        // "é" as UTF-8 is two bytes; a client may write them separately.
        let mut framer = LineFramer::new(64);
        let mut out = Vec::new();
        framer.push(b"{\"n\":\"\xc3", &mut out);
        assert!(out.is_empty());
        framer.push(b"\xa9\"}\n", &mut out);
        assert_eq!(out, vec![FrameEvent::Line("{\"n\":\"é\"}".into())]);
    }

    #[test]
    fn discards_an_oversize_line_without_buffering_it_and_resumes() {
        let mut framer = LineFramer::new(8);
        let mut out = Vec::new();
        // 1 MiB of a single line: the framer must not hold it.
        let huge = vec![b'x'; 1024 * 1024];
        framer.push(&huge, &mut out);
        assert_eq!(out, vec![FrameEvent::Oversize]);
        assert!(framer.is_discarding());
        framer.push(b"\n{\"ok\":1}\n", &mut out);
        // One oversize report, then framing resumes on the same stream.
        assert_eq!(
            out,
            vec![FrameEvent::Oversize, FrameEvent::Line("{\"ok\":1}".into())]
        );
        assert!(!framer.is_discarding());
    }

    #[test]
    fn reports_invalid_utf8_once_and_keeps_going() {
        let events = frames(&[b"\xff\xfe\n{\"ok\":1}\n"], 64);
        assert_eq!(
            events,
            vec![
                FrameEvent::InvalidUtf8,
                FrameEvent::Line("{\"ok\":1}".into()),
            ]
        );
    }

    #[test]
    fn an_unterminated_tail_is_not_a_frame() {
        let events = frames(&[b"{\"partial\":1}"], 64);
        assert!(events.is_empty());
    }

    #[test]
    fn lowering_the_limit_takes_effect_at_the_next_byte() {
        let mut framer = LineFramer::new(64);
        let mut out = Vec::new();
        framer.push(b"0123456789", &mut out);
        assert!(out.is_empty());
        framer.set_limit(4);
        framer.push(b"abcdef\n", &mut out);
        // Discarded, not completed under the old allowance: a lowered limit is
        // not something a client can wait out.
        assert_eq!(out, vec![FrameEvent::Oversize]);
        // Raising it again resumes normal framing on the same stream.
        framer.set_limit(64);
        framer.push(b"{\"ok\":1}\n", &mut out);
        assert_eq!(
            out,
            vec![FrameEvent::Oversize, FrameEvent::Line("{\"ok\":1}".into())]
        );
    }
}
