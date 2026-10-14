// Fabricated messages for the sorter's golden set. #187.
//
// None of these is a real tenant's. No name, no address, no phone number.
// Returned-to-filtered labels are a later growth of this set, not these rows.

import type { SorterLabel } from '../src/calls/contract.ts';

export interface SorterCase {
  id: string;
  title: string;
  subject: string;
  body: string;
  label: SorterLabel;
  /** Set when the category is part of the grade, including an expected none. */
  categoryCode?: string | null;
  /** `hebrew` leaves body_he empty. `other` must come back in Hebrew. */
  text: 'hebrew' | 'other';
}

export const sorterCases: readonly SorterCase[] = [
  {
    id: 'he-leak',
    title: 'A Hebrew leak is a plumbing call, and it is already Hebrew',
    subject: 'נזילה',
    body: 'יש נזילה מתחת לכיור במטבח כבר מאתמול.',
    label: 'call',
    categoryCode: 'PLUMBING',
    text: 'hebrew',
  },
  {
    id: 'he-question',
    title: 'A Hebrew question is a call',
    subject: '',
    // The question names what it is for. Without "to fix the boiler" it also
    // fits the prompt's unsure rule, and the model took that reading on CI.
    body: 'מתי אפשר לשלוח מישהו לתקן את הדוד בדירה?',
    label: 'call',
    text: 'hebrew',
  },
  {
    id: 'he-noise',
    title: 'A Hebrew advertisement is noise',
    subject: '',
    body: 'מבצע! עשרים אחוז הנחה על פיצות עד סוף השבוע. להסרה השיבו הסר.',
    label: 'noise',
    categoryCode: null,
    text: 'hebrew',
  },
  {
    id: 'he-unsure',
    title: 'A Hebrew message that might or might not be a fault is unsure',
    subject: '',
    body: 'אולי יש בעיה במזגן ואולי אין, לא בדקתי.',
    label: 'unsure',
    text: 'hebrew',
  },
  {
    id: 'he-emergency',
    title: 'Hebrew emergency wording is still a call',
    subject: '',
    body: 'יש עשן כבד בדירה וצריך שמישהו יבוא.',
    label: 'call',
    text: 'hebrew',
  },
  {
    id: 'en-ac',
    title: 'An English air-conditioner fault is a call, translated',
    subject: 'Air conditioner',
    body: 'The air conditioner in the living room is not cooling.',
    label: 'call',
    categoryCode: 'AIR_CONDITIONING',
    text: 'other',
  },
  {
    id: 'en-gate',
    title: 'An English question about the gate is a call, translated',
    subject: '',
    body: 'Who do I talk to about the building gate that will not open?',
    label: 'call',
    categoryCode: 'GATES',
    text: 'other',
  },
  {
    id: 'en-noise',
    title: 'An English newsletter is noise, translated',
    subject: 'Newsletter',
    body: 'Unsubscribe from our weekly deals. Half price pizza this weekend only.',
    label: 'noise',
    categoryCode: null,
    text: 'other',
  },
  {
    id: 'en-emergency',
    title: 'English emergency wording is still a call, translated',
    subject: 'Smoke',
    body: 'There is smoke in the stairwell and we need someone now.',
    label: 'call',
    text: 'other',
  },
  {
    id: 'ru-leak',
    title: 'A Russian leak is a plumbing call, translated',
    subject: '',
    body: 'Здравствуйте, на кухне течёт кран.',
    label: 'call',
    categoryCode: 'PLUMBING',
    text: 'other',
  },
  {
    id: 'ru-unsure',
    title: 'A Russian message that does not quite ask is unsure, translated',
    subject: '',
    body: 'Не знаю, писать вам или нет.',
    label: 'unsure',
    text: 'other',
  },
  {
    id: 'ar-lock',
    title: 'An Arabic lock fault is a call, translated',
    subject: '',
    body: 'الباب لا يغلق والمفتاح لا يدور.',
    label: 'call',
    categoryCode: 'LOCKS',
    text: 'other',
  },
  {
    id: 'ar-noise',
    title: 'An Arabic advertisement is noise, translated',
    subject: '',
    body: 'عرض خاص! خصم على البيتزا هذا الأسبوع فقط.',
    label: 'noise',
    categoryCode: null,
    text: 'other',
  },
  {
    id: 'mix-leak',
    title: 'A Hebrew subject with an English leak is a call, translated',
    subject: 'נזילה',
    body: 'The tap is leaking in the kitchen since this morning.',
    label: 'call',
    categoryCode: 'PLUMBING',
    text: 'other',
  },
];
