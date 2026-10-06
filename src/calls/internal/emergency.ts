// Whether a description contains an emergency term. #185.
//
// A substring, not a word boundary. A Hebrew prefix (ה, ב, ו, ל) glues onto
// the word, so "שריפה" has to match inside "השריפה". The same rule matches a
// term written in another language. Niqqud and the invisible marks a paste
// leaves behind are not part of the word. No model is called: the inputs are
// two strings and the result is a boolean.

const MARKS =
  /[\u0591-\u05C7\u00AD\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

function fold(value: string): string {
  return value.normalize('NFKC').replace(MARKS, '').toLowerCase();
}

export interface DutyContact {
  phone: string;
  hours: string;
}

/**
 * The fixed reply a channel will send. Placeholder wording: the director has
 * not approved the sentence. Pure — the phone and the hours are the whole input.
 */
export function composeDutyReply(duty: DutyContact): string {
  return `קריאת חירום. להתקשר לכונן: ${duty.phone}. שעות כונן: ${duty.hours}.`;
}

export function emergencyTermMatches(
  description: string,
  terms: readonly string[],
): boolean {
  const haystack = fold(description);
  for (const term of terms) {
    const needle = fold(term).trim();
    if (needle.length > 0 && haystack.includes(needle)) return true;
  }
  return false;
}
