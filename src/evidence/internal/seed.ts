// Flow A6's propose and confirm. Slice 3.5.
//
// The confirm page recomputes the proposal from the stored bytes — the document is immutable and
// the reader is a pure function, so a staging table would be a second copy of a fact the document
// already is. Estate writes the rows.
import {
  applyProtocolSeed,
  type ProtocolSeedResult,
} from '../../estate/contract.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { ObjectStore } from '../../kernel/objects.ts';
import type { PdfText } from '../../kernel/pdf.ts';
import { getFiledDocument } from './documents.ts';
import {
  type HandoverProposal,
  isProtocolType,
  PROTOCOL_TYPE_KEYS,
  readHandoverProposal,
} from './protocol.ts';
import { parseObjectPath, parseStorageUri } from './storage-path.ts';
import type { Queryable } from './types.ts';
import { documentText } from './verify.ts';

export interface SeedDeps {
  db: Queryable;
  objects: ObjectStore;
  pdf: PdfText;
  bucket: string;
}

export interface ProtocolProposal {
  documentId: string;
  typeKey: string;
  labelHe: string;
  placeKind: 'UNIT' | 'BUILDING';
  placeId: string;
  proposal: HandoverProposal;
}

async function textOf(deps: SeedDeps, storageUri: string): Promise<string> {
  const { path } = parseStorageUri(storageUri, deps.bucket);
  const object = await deps.objects.read(path);
  const pages = await deps.pdf.pages(object.bytes);
  return documentText(pages);
}

export async function proposeProtocol(
  deps: SeedDeps,
  documentId: string,
): Promise<ProtocolProposal> {
  const filed = await getFiledDocument(deps.db, documentId);
  if (!isProtocolType(filed.typeKey)) {
    throw new KernelError(
      'invalid',
      'that document is not a handover protocol',
    );
  }
  const { path } = parseStorageUri(filed.storageUri, deps.bucket);
  const spec = parseObjectPath(path);
  if (spec.place.kind !== 'UNIT' && spec.place.kind !== 'BUILDING') {
    throw new KernelError('invalid', 'a protocol is filed under a place');
  }
  const text = await textOf(deps, filed.storageUri);
  return {
    documentId: filed.documentId,
    typeKey: filed.typeKey,
    labelHe: filed.labelHe,
    placeKind: spec.place.kind,
    placeId: spec.place.id,
    proposal: readHandoverProposal(text, filed.typeKey),
  };
}

export async function confirmProtocol(
  deps: SeedDeps,
  documentId: string,
): Promise<ProtocolSeedResult & { proposal: HandoverProposal }> {
  const proposed = await proposeProtocol(deps, documentId);
  const { proposal } = proposed;
  if (!proposal.handoverDate) {
    throw new KernelError(
      'invalid',
      'the protocol does not carry a handover date',
    );
  }
  if (!isProtocolType(proposed.typeKey)) {
    throw new KernelError(
      'invalid',
      'that document is not a handover protocol',
    );
  }
  const kind = PROTOCOL_TYPE_KEYS[proposed.typeKey];
  const result = await applyProtocolSeed(deps.db, {
    kind,
    targetId: proposed.placeId,
    handoverDate: proposal.handoverDate,
    assets: proposal.assets,
    sourceDocumentId: documentId,
  });
  return { ...result, proposal };
}
