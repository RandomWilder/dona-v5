// Deliberate violation, slice 1.7. Reverted immediately: a second copy of the isolation join,
// outside src/scope/, which is how this constraint actually dies — not by a rewrite, by a copy.
export const LOOKUP_SQL = `
    SELECT t.tenancy_id, u.unit_id, u.unit_number, p.party_id
    FROM party_contact pc
    JOIN party p ON p.party_id = pc.party_id
    JOIN tenancy_party tp ON tp.party_id = p.party_id
    JOIN tenancy t ON t.tenancy_id = tp.tenancy_id
    JOIN unit u ON u.unit_id = t.unit_id
    WHERE pc.channel = 'PHONE'
      AND pc.value = $1
      AND pc.valid_from <= $2
      AND (pc.valid_to IS NULL OR pc.valid_to >= $2)
      AND t.status = 'ACTIVE'
      AND t.start_date <= $2
      AND t.end_date >= $2
      AND tp.is_service_contact
    ORDER BY u.unit_id
`;
