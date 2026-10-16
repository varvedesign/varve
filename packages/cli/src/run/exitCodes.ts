/**
 * Process exit codes for the automation commands. Stable, documented in
 * `varve help`, and independent of message text.
 */
export const EXIT = {
  OK: 0,
  /** A well-formed request was refused (validation, authorization, state). */
  REJECTED: 1,
  /** The command line itself was malformed. */
  USAGE: 2,
  /** A file could not be read or written, or a path was not allowed. */
  IO: 3,
  /** A retry could not be reconciled; verify the document before repeating. */
  UNKNOWN_OUTCOME: 4,
  /** The document or session changed underneath the request. */
  CONFLICT: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
