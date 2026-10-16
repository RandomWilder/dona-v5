// The governed map. ADR-0016. One constant, not rows: a row could name nothing this
// constant did not already allow, and a missing row failed every draft.

export type ColumnMap = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

/** Twelve lease columns, and the addendum's later end date. */
export const COLUMN_MAP: ColumnMap = {
  lease: {
    start_date: 'tenancy.start_date',
    end_date: 'tenancy.end_date',
    rent_amount: 'tenancy.rent_amount',
    rent_currency: 'tenancy.rent_currency',
    option_end_date: 'tenancy.option_end_date',
    eligibility_group: 'tenancy.eligibility_group',
    parking_space_number: 'tenancy.parking_space_id',
    second_parking_space_number: 'tenancy.second_parking_space_id',
    storage_space_number: 'tenancy.storage_space_id',
    second_storage_space_number: 'tenancy.second_storage_space_id',
    rooms: 'unit.rooms',
    floor: 'space.floor',
  },
  lease_amendment: {
    new_end_date: 'tenancy.end_date',
  },
};

export function columnTarget(typeKey: string, fieldKey: string): string | null {
  return COLUMN_MAP[typeKey]?.[fieldKey] ?? null;
}
