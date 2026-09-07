// Deterministic reader over a handover protocol. Slice 3.5, flow A6.
//
// No model, no OCR, no ExtractedField. The text is what `documentText` already produces for the
// 3.3 guard, and this file maps Hebrew names onto the governed asset_type list. It proposes;
// it does not write. The confirm page recomputes by calling this again over the stored bytes,
// so there is no staging table (SPEC-flows.md A6).
import type { AssetClass, AssetType } from '../../estate/contract.ts';

export type ProtocolKind = 'unit' | 'building';

export interface ProposedAsset {
  assetClass: AssetClass;
  assetType: AssetType;
  labelHe: string;
}

export interface HandoverProposal {
  kind: ProtocolKind;
  handoverDate: string | null;
  apartmentNumber: string | null;
  assets: ProposedAsset[];
}

export const PROTOCOL_TYPE_KEYS = {
  handover_protocol: 'unit',
  building_handover_protocol: 'building',
} as const;

export function isProtocolType(
  typeKey: string,
): typeKey is keyof typeof PROTOCOL_TYPE_KEYS {
  return typeKey in PROTOCOL_TYPE_KEYS;
}

// Longer labels first, so "דוד המים" wins over a bare "דוד" and "דוד הסקה" does not steal a
// water heater. Meters collapse to one METER row: a protocol naming four meters is still one
// kind of thing in one space.
const MARKERS: ReadonlyArray<{
  assetClass: AssetClass;
  assetType: AssetType;
  labelHe: string;
  needles: readonly string[];
}> = [
  {
    assetClass: 'FIXTURE',
    assetType: 'WATER_HEATER',
    labelHe: 'דוד מים',
    needles: ['דוד המים', 'דוד מים'],
  },
  {
    assetClass: 'UTILITY',
    assetType: 'BOILER',
    labelHe: 'דוד הסקה',
    needles: ['דוד הסקה'],
  },
  {
    assetClass: 'FIXTURE',
    assetType: 'BLINDS',
    labelHe: 'תריסים',
    needles: ['תריסים חשמליים', 'תריסים'],
  },
  {
    assetClass: 'SAFETY',
    assetType: 'MAMAD_BLAST_DOOR',
    labelHe: 'דלת הדף',
    needles: ['דלת ההדף', 'דלת הדף'],
  },
  {
    assetClass: 'SAFETY',
    assetType: 'EMERGENCY_LIGHT',
    labelHe: 'תאורת חירום',
    needles: ['תאורת חירום'],
  },
  {
    assetClass: 'SAFETY',
    assetType: 'SMOKE_DETECTOR',
    labelHe: 'גלאי עשן',
    needles: ['גלאי עשן'],
  },
  {
    assetClass: 'UTILITY',
    assetType: 'GATE_MOTOR',
    labelHe: 'מנוע שער',
    needles: ['מנוע שער'],
  },
  {
    assetClass: 'UTILITY',
    assetType: 'INTERCOM',
    labelHe: 'אינטרקום',
    needles: ['אינטרקום'],
  },
  {
    assetClass: 'UTILITY',
    assetType: 'ELEVATOR',
    labelHe: 'מעלית',
    needles: ['מעלית'],
  },
  {
    assetClass: 'UTILITY',
    assetType: 'PUMP',
    labelHe: 'משאבה',
    needles: ['משאבה'],
  },
  {
    assetClass: 'SAFETY',
    assetType: 'EXTINGUISHER',
    labelHe: 'מטפה',
    needles: ['מטפה'],
  },
  {
    assetClass: 'SAFETY',
    assetType: 'SPRINKLER',
    labelHe: 'מתז',
    needles: ['מתז'],
  },
  {
    assetClass: 'FIXTURE',
    assetType: 'PLUMBING',
    labelHe: 'אינסטלציה',
    needles: ['אינסטלציה'],
  },
  {
    assetClass: 'FIXTURE',
    assetType: 'AC',
    labelHe: 'מזגן',
    needles: ['מזגן'],
  },
  {
    assetClass: 'FIXTURE',
    assetType: 'OVEN',
    labelHe: 'תנור',
    needles: ['תנור'],
  },
  {
    assetClass: 'UTILITY',
    assetType: 'METER',
    labelHe: 'מונה',
    needles: ['מונה החשמל', 'מונה חשמל', 'מונה מים', 'מונה גז'],
  },
];

const DATE = /מועד המסירה:\s*(\d{4}-\d{2}-\d{2})/;
const APARTMENT = /דירה\s+(\d+[A-Za-z]*)/;

export function readHandoverProposal(
  text: string,
  typeKey: string,
): HandoverProposal {
  const kind = isProtocolType(typeKey) ? PROTOCOL_TYPE_KEYS[typeKey] : 'unit';
  const haystack = text.replace(/\s+/g, ' ');
  const dateMatch = DATE.exec(haystack);
  const apartmentMatch = kind === 'unit' ? APARTMENT.exec(haystack) : null;
  const assets: ProposedAsset[] = [];
  const seen = new Set<AssetType>();
  for (const marker of MARKERS) {
    if (seen.has(marker.assetType)) continue;
    if (marker.needles.some((needle) => haystack.includes(needle))) {
      seen.add(marker.assetType);
      assets.push({
        assetClass: marker.assetClass,
        assetType: marker.assetType,
        labelHe: marker.labelHe,
      });
    }
  }
  return {
    kind,
    handoverDate: dateMatch?.[1] ?? null,
    apartmentNumber: apartmentMatch?.[1] ?? null,
    assets,
  };
}
