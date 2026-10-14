// The letting's title. Computed on every display, stored nowhere. #240.

/** Street and number, then the city. Either alone stands on its own. */
export function tenancyAddress(street: string, city: string): string | null {
  const line = street.trim();
  const town = city.trim();
  if (line !== '' && town !== '') return `${line}, ${town}`;
  const only = line || town;
  return only === '' ? null : only;
}

/** Primary tenant, otherwise the first co-tenant. Not a guarantor or an occupant. */
export function tenancyTitleName(
  people: readonly { role: string; name: string | null }[],
): string | null {
  const person =
    people.find((one) => one.role === 'PRIMARY_TENANT') ??
    people.find((one) => one.role === 'CO_TENANT');
  const name = person?.name?.trim() ?? '';
  return name === '' ? null : name;
}

export function tenancyTitle(parts: {
  name: string | null;
  address: string | null;
  unitNumber: string | null;
  startDate: string | null;
}): string {
  const segments: string[] = [];
  const name = parts.name?.trim() ?? '';
  if (name !== '') segments.push(name);
  const address = parts.address?.trim() ?? '';
  if (address !== '') segments.push(address);
  const unit = parts.unitNumber?.trim() ?? '';
  if (unit !== '') segments.push(`דירה ${unit}`);
  const start = parts.startDate?.trim() ?? '';
  if (start !== '') segments.push(start);
  return segments.join(' · ');
}
