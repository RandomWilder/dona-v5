// The path through filing, extraction and approval. Ticket #109.
//
// The commands are not here. `fileDocument` already files and extracts; `approveExtractedField` and
// `approveUnflagged` already stamp. What this module owns is **where the operator goes next**, so
// both upload doors and the unit document list cannot disagree about it.

import { isProtocolType } from './protocol.ts';
import type { VerificationVerdict } from './verify.ts';

export interface FilingContinuation {
  documentId: string;
  verdict: VerificationVerdict;
  typeKey: string;
  tenancyId: string | null;
}

/**
 * The next screen after a successful filing, or `null` when the receipt is the answer.
 *
 * A verified unbound lease goes to the approval ledger. A protocol still goes to seed. An addendum
 * still goes to its confirm — #110 keeps that door until the addendum sequence moves with it.
 */
export function destinationAfterFiling(
  step: FilingContinuation,
): string | null {
  if (step.verdict !== 'verified') {
    return null;
  }
  if (isProtocolType(step.typeKey)) {
    return `/documents/${step.documentId}/seed`;
  }
  if (step.typeKey === 'lease' && step.tenancyId === null) {
    return `/documents/${step.documentId}/fields`;
  }
  if (step.typeKey === 'lease_amendment' && step.tenancyId !== null) {
    return `/documents/${step.documentId}/tenancy`;
  }
  return null;
}

/** The unit-first document list's door into the same orchestrator. */
export function unitDocumentAction(
  typeKey: string,
  documentId: string,
): {
  href: string;
  labelHe: string;
} | null {
  if (typeKey === 'lease') {
    return {
      href: `/documents/${documentId}/fields`,
      labelHe: 'אישור הקריאה',
    };
  }
  return null;
}
