// Hebrew rows, keyed, so a screen never carries a sentence of its own. English and Russian are
// later rows in this same list. A missing key throws: a blank button is worse than a loud test.

export interface PortalCopy {
  key: string;
  language: 'he';
  text: string;
}

export const PORTAL_COPY: readonly PortalCopy[] = [
  { key: 'brand', language: 'he', text: 'דונה דום' },
  { key: 'brand.mark', language: 'he', text: 'ד' },
  { key: 'sign_in.page', language: 'he', text: 'כניסה לפורטל הדיירים' },
  { key: 'sign_in.title', language: 'he', text: 'כניסה לפורטל הדיירים' },
  {
    key: 'sign_in.lede',
    language: 'he',
    text: 'הזינו את מספר הנייד שהמשרד מכיר. נשלח אליו קוד כניסה.',
  },
  { key: 'sign_in.phone', language: 'he', text: 'מספר נייד' },
  { key: 'sign_in.placeholder', language: 'he', text: '50-000-0000' },
  { key: 'sign_in.prefix', language: 'he', text: '+972' },
  { key: 'sign_in.submit', language: 'he', text: 'שליחת קוד' },
  { key: 'sign_in.caption', language: 'he', text: 'הקוד יגיע בוואטסאפ.' },
  { key: 'sign_in.caption_sms', language: 'he', text: 'הקוד יגיע במסרון.' },
  {
    key: 'sign_in.caption_both',
    language: 'he',
    text: 'הקוד יגיע בוואטסאפ. אין וואטסאפ? אפשר לבקש במסרון במסך הבא.',
  },
  { key: 'sign_in.language', language: 'he', text: 'שפה' },
  { key: 'sign_in.language_title', language: 'he', text: 'שפה' },
  { key: 'sign_in.language_current', language: 'he', text: 'עברית' },
  {
    key: 'sign_in.not_mobile',
    language: 'he',
    text: 'המספר אינו נייד ישראלי. הזינו מספר שמתחיל ב-05.',
  },
  {
    key: 'sign_in.capped',
    language: 'he',
    text: 'לא ניתן לשלוח עוד קוד היום. נסו שוב מחר.',
  },
  {
    key: 'sign_in.unavailable',
    language: 'he',
    text: 'לא ניתן לשלוח קוד כרגע. נסו שוב.',
  },
  {
    key: 'sign_in.wait',
    language: 'he',
    text: 'אפשר לבקש קוד חדש בעוד דקה.',
  },
  { key: 'sign_in.retry', language: 'he', text: 'פתחו את הדף מחדש ונסו שוב.' },
  { key: 'code.page', language: 'he', text: 'הזינו את הקוד' },
  { key: 'code.title', language: 'he', text: 'הזינו את הקוד' },
  {
    key: 'code.sent',
    language: 'he',
    text: 'שלחנו קוד בן 6 ספרות לוואטסאפ של',
  },
  {
    key: 'code.sent_sms',
    language: 'he',
    text: 'שלחנו קוד בן 6 ספרות במסרון אל',
  },
  {
    key: 'code.fallback_to_sms_title',
    language: 'he',
    text: 'לא הגיע בוואטסאפ?',
  },
  {
    key: 'code.fallback_to_sms_body',
    language: 'he',
    text: 'שלחו במסרון. עובד גם בלי אינטרנט.',
  },
  { key: 'code.fallback_to_sms', language: 'he', text: 'מסרון' },
  { key: 'code.fallback_to_wa_title', language: 'he', text: 'לא הגיע במסרון?' },
  {
    key: 'code.fallback_to_wa_body',
    language: 'he',
    text: 'אפשר לחזור לקוד בוואטסאפ.',
  },
  { key: 'code.fallback_to_wa', language: 'he', text: 'וואטסאפ' },
  { key: 'code.change', language: 'he', text: 'שינוי' },
  { key: 'code.label', language: 'he', text: 'קוד כניסה, 6 ספרות' },
  { key: 'code.wait', language: 'he', text: 'אפשר לבקש קוד חדש בעוד' },
  { key: 'code.resend', language: 'he', text: 'שליחת קוד חדש' },
  { key: 'code.submit', language: 'he', text: 'כניסה' },
  { key: 'code.back', language: 'he', text: 'חזרה' },
  {
    key: 'code.wrong',
    language: 'he',
    text: 'הקוד שגוי. נסו שוב, או בקשו קוד חדש.',
  },
  { key: 'code.expired', language: 'he', text: 'תוקף הקוד פג. בקשו קוד חדש.' },
  { key: 'code.used', language: 'he', text: 'הקוד כבר נוצל. בקשו קוד חדש.' },
  {
    key: 'code.exhausted',
    language: 'he',
    text: 'יותר מדי ניסיונות. בקשו קוד חדש.',
  },
  { key: 'home.page', language: 'he', text: 'פורטל הדיירים' },
  { key: 'home.title', language: 'he', text: 'פורטל הדיירים' },
  { key: 'home.empty', language: 'he', text: 'אין כאן עדיין מה להציג.' },
  { key: 'home.sign_out', language: 'he', text: 'יציאה' },
  { key: 'home.sign_out_all', language: 'he', text: 'יציאה מכל המכשירים' },
  { key: 'home.passkeys', language: 'he', text: 'מפתחות כניסה' },
  { key: 'sign_in.passkey', language: 'he', text: 'כניסה מהירה' },
  { key: 'passkey.page', language: 'he', text: 'כניסה מהירה בפעם הבאה' },
  {
    key: 'passkey.title',
    language: 'he',
    text: 'כניסה מהירה בפעם הבאה',
  },
  {
    key: 'passkey.lede',
    language: 'he',
    text: 'בפעם הבאה נכנסים בטביעת אצבע, בזיהוי פנים או בקוד המכשיר.',
  },
  { key: 'passkey.reason_wait', language: 'he', text: 'בלי לחכות לקוד' },
  {
    key: 'passkey.reason_device',
    language: 'he',
    text: 'המפתח נשאר רק בטלפון שלכם',
  },
  {
    key: 'passkey.reason_control',
    language: 'he',
    text: 'אפשר להוסיף או להסיר מתי שתרצו',
  },
  { key: 'passkey.enable', language: 'he', text: 'הפעלת כניסה מהירה' },
  { key: 'passkey.later', language: 'he', text: 'לא עכשיו' },
  {
    key: 'passkey.failed',
    language: 'he',
    text: 'לא הצלחנו להפעיל את הכניסה המהירה. אפשר לנסות שוב, או להמשיך בלי.',
  },
  { key: 'passkeys.page', language: 'he', text: 'מפתחות כניסה' },
  { key: 'passkeys.title', language: 'he', text: 'מפתחות כניסה' },
  {
    key: 'passkeys.empty',
    language: 'he',
    text: 'אין עדיין מפתח כניסה על השם שלכם.',
  },
  { key: 'passkeys.one', language: 'he', text: 'מפתח כניסה' },
  { key: 'passkeys.remove', language: 'he', text: 'הסרה' },
  {
    key: 'passkeys.missing',
    language: 'he',
    text: 'המפתח כבר לא ברשימה.',
  },
  { key: 'passkeys.back', language: 'he', text: 'חזרה' },
];

const byKey = new Map(PORTAL_COPY.map((row) => [row.key, row.text]));

export function portalText(key: string): string {
  const text = byKey.get(key);
  if (text === undefined) {
    throw new Error(`missing portal copy: ${key}`);
  }
  return text;
}
