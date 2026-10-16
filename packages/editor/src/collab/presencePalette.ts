/**
 * Participant color palette (ADR-0200).
 *
 * The wire carries a colorIndex (0-7) assigned by the room host; the UI
 * resolves it to EXISTING theme tokens — never literal colors. Slots map
 * onto the layer-tag hue family plus the brand accent, so participant
 * identity stays legible in all three themes and passes the token audits
 * by construction.
 */

const PARTICIPANT_TOKENS = [
  'var(--color-accent-teal)',
  'var(--color-layer-tag-blue)',
  'var(--color-layer-tag-purple)',
  'var(--color-layer-tag-orange)',
  'var(--color-layer-tag-green)',
  'var(--color-layer-tag-red)',
  'var(--color-layer-tag-yellow)',
  'var(--color-layer-tag-gray)',
] as const;

export function participantColor(colorIndex: number): string {
  return PARTICIPANT_TOKENS[
    ((colorIndex % PARTICIPANT_TOKENS.length) + PARTICIPANT_TOKENS.length) %
      PARTICIPANT_TOKENS.length
  ]!;
}

export const PARTICIPANT_COLOR_COUNT = PARTICIPANT_TOKENS.length;
