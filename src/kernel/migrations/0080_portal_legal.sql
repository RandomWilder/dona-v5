-- #276. Legal texts and the acknowledgement of reading them.
--
-- A text is a versioned row per language. A new version is a new row; nothing
-- here updates one. The request shows the newest version whose created_at is
-- at or before the injected clock. placeholder marks wording the legal team
-- has not yet replaced. The acknowledgement points at the exact row the tenant
-- was shown, so the version and the language travel with it.
--
-- No DEFAULT now(): timestamps come from the injected clock (SPEC.md).

CREATE TABLE IF NOT EXISTS portal_legal_text (
  legal_text_id uuid PRIMARY KEY,
  kind text NOT NULL,
  language text NOT NULL,
  version integer NOT NULL,
  opt_in_key text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  body text NOT NULL,
  placeholder boolean NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT portal_legal_text_kind
    CHECK (kind IN ('privacy', 'terms', 'entry', 'opt_in')),
  CONSTRAINT portal_legal_text_language
    CHECK (language IN ('he', 'en', 'ru')),
  CONSTRAINT portal_legal_text_version CHECK (version >= 1),
  CONSTRAINT portal_legal_text_opt_in CHECK (
    (kind = 'opt_in' AND opt_in_key <> '')
    OR (kind <> 'opt_in' AND opt_in_key = '')
  ),
  UNIQUE (kind, language, version, opt_in_key)
);

CREATE INDEX IF NOT EXISTS portal_legal_text_current
  ON portal_legal_text (language, kind, opt_in_key, version DESC);

CREATE TABLE IF NOT EXISTS portal_acknowledgement (
  acknowledgement_id uuid PRIMARY KEY,
  portal_identity_id uuid NOT NULL REFERENCES portal_identity (portal_identity_id) ON DELETE CASCADE,
  legal_text_id uuid NOT NULL REFERENCES portal_legal_text (legal_text_id),
  acknowledged_at timestamptz NOT NULL,
  UNIQUE (portal_identity_id, legal_text_id)
);

CREATE TABLE IF NOT EXISTS portal_opt_in (
  portal_identity_id uuid NOT NULL REFERENCES portal_identity (portal_identity_id) ON DELETE CASCADE,
  opt_in_key text NOT NULL,
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (portal_identity_id, opt_in_key)
);

-- Placeholder wording, one version, three languages. Amendment 13's notification
-- duty: who holds the data, why, that giving it is not required by law, who
-- receives it, and that the service is not conditional on consent. Dona Dom's
-- legal team replaces these rows by inserting a later version.
INSERT INTO portal_legal_text (
  legal_text_id, kind, language, version, opt_in_key,
  title, summary, body, placeholder, created_at
) VALUES
  (
    'a2760001-0000-4000-8000-000000000001', 'privacy', 'he', 1, '',
    'הודעת פרטיות',
    'הפורטל שומר את המספר המאומת, את הקריאות ואת המסמכים של השכירות, כדי שתוכלו לראות אותם ולפנות למשרד. אין חובה בחוק למסור את המספר, והשירות אינו מותנה בהסכמה.',
    'דונה דום מפעילה את הפורטל כדי שדייר יוכל לראות את השכירות שלו ולפנות למשרד. נשמרים המספר המאומת, הקריאות שאתם פותחים, המסמכים שתויקו לשכירות, השפה שבחרתם, ומועד הקריאה של הודעה זו. אין חובה בחוק למסור את המספר. בלי אימות שלו הפורטל אינו יכול להציג את השכירות. השירות אינו מותנה בהסכמה. המידע משמש לזיהוי, להצגת השכירות ולטיפול בקריאה. הוא נמסר לאנשי המשרד שמטפלים בשכירות, ולספק ששולח את קוד הכניסה, והקוד והמספר בלבד. הוא אינו נמכר. אפשר לבקש עיון, תיקון או מחיקה בפנייה למשרד, ואפשר גם לפנות לרשות להגנת הפרטיות.',
    true, '2026-10-19 00:00:00+00'
  ),
  (
    'a2760001-0000-4000-8000-000000000002', 'privacy', 'en', 1, '',
    'Privacy notice',
    'The portal keeps the verified number, the calls and the tenancy documents, so you can see them and reach the office. The law does not require the number, and the service is not conditional on consent.',
    'Dona Dom runs this portal so a tenant can see their tenancy and contact the office. What is kept: the verified mobile number, the calls you open, the documents filed to the tenancy, the language you choose, and the time you read this notice. The law does not require the number. Without verifying it, the portal cannot show the tenancy. The service is not conditional on consent. The office uses this to identify you, show the tenancy and handle a call. It is shared with the staff who handle the tenancy, and with the provider that sends the sign-in code, the number and the code only. It is not sold. You can ask the office to see, correct or delete it. You can also contact the Privacy Protection Authority.',
    true, '2026-10-19 00:00:00+00'
  ),
  (
    'a2760001-0000-4000-8000-000000000003', 'privacy', 'ru', 1, '',
    'Уведомление о конфиденциальности',
    'Портал хранит подтверждённый номер, обращения и документы аренды, чтобы вы могли видеть их и написать в офис. Закон не требует сообщать номер, и услуга не зависит от согласия.',
    'Dona Dom ведёт этот портал, чтобы арендатор видел свою аренду и мог обратиться в офис. Хранятся подтверждённый номер, открытые вами обращения, документы по аренде, выбранный язык и время прочтения этого уведомления. Закон не требует сообщать номер. Без его подтверждения портал не покажет аренду. Услуга не зависит от согласия. Данные нужны, чтобы узнать вас, показать аренду и разобрать обращение. Их видят сотрудники офиса, которые ведут аренду, и поставщик, который отправляет код входа: только номер и код. Данные не продаются. Можно попросить офис показать, исправить или удалить их. Можно также обратиться в Управление по защите конфиденциальности.',
    true, '2026-10-19 00:00:00+00'
  ),
  (
    'a2760001-0000-4000-8000-000000000004', 'terms', 'he', 1, '',
    'תנאי שימוש',
    'השימוש הוא לצפייה בשכירות שלכם ולפתיחת קריאה למשרד. אין למסור את הכניסה למי שאינו רשום על המספר.',
    'הפורטל מיועד למי שהמספר שלו רשום במשרד. אפשר לצפות בשכירות ולפתוח קריאה. אין להשתמש בו לשכירות של אחר ואין למסור את הכניסה. השירות אינו מותנה בהסכמה מעבר לשימוש הזה.',
    true, '2026-10-19 00:00:00+00'
  ),
  (
    'a2760001-0000-4000-8000-000000000005', 'terms', 'en', 1, '',
    'Terms of use',
    'Use is for viewing your tenancy and opening a call to the office. Do not share the sign-in with someone who is not on the number.',
    'The portal is for the person whose number the office holds. You may view the tenancy and open a call. You may not use it for someone else''s tenancy or share the sign-in. The service is not conditional on consent beyond that use.',
    true, '2026-10-19 00:00:00+00'
  ),
  (
    'a2760001-0000-4000-8000-000000000006', 'terms', 'ru', 1, '',
    'Условия использования',
    'Портал нужен, чтобы смотреть свою аренду и открыть обращение в офис. Не передавайте вход тому, чей номер не записан.',
    'Портал предназначен для того, чей номер есть в офисе. Можно смотреть аренду и открыть обращение. Нельзя пользоваться им для чужой аренды и нельзя передавать вход. Услуга не зависит от согласия сверх этого использования.',
    true, '2026-10-19 00:00:00+00'
  ),
  (
    'a2760001-0000-4000-8000-000000000007', 'entry', 'he', 1, '',
    'אישור כניסה לדירה',
    'כשתפתחו קריאה תוכלו לאשר כניסה לדירה במועד שתתאמו.',
    'כשתפתחו קריאה תוכלו לאשר כניסה לדירה במועד שתתאמו. האישור חל על אותה קריאה בלבד. בלי האישור אין כניסה, והשירות עצמו אינו תלוי בו.',
    true, '2026-10-19 00:00:00+00'
  ),
  (
    'a2760001-0000-4000-8000-000000000008', 'entry', 'en', 1, '',
    'Permission to enter',
    'When you open a call you may allow entry to the flat at a time you agree.',
    'When you open a call you may allow entry to the flat at a time you agree. The permission is for that call only. Without it there is no entry, and the service itself does not depend on it.',
    true, '2026-10-19 00:00:00+00'
  ),
  (
    'a2760001-0000-4000-8000-000000000009', 'entry', 'ru', 1, '',
    'Разрешение на вход',
    'Открывая обращение, вы можете разрешить вход в квартиру в согласованное время.',
    'Открывая обращение, вы можете разрешить вход в квартиру в согласованное время. Разрешение действует только для этого обращения. Без него входа нет, и сама услуга от него не зависит.',
    true, '2026-10-19 00:00:00+00'
  ),
  (
    'a2760001-0000-4000-8000-00000000000a', 'opt_in', 'he', 1, 'building_notices',
    'עדכונים על הבניין',
    'עבודות, הפסקות מים וכדומה. לא חובה.',
    'אפשר לקבל הודעות על עבודות בבניין ועל הפסקות מים. זה כבוי עד שתפעילו, ואפשר לכבות באותו אופן. אין בכך תנאי לשירות.',
    true, '2026-10-19 00:00:00+00'
  ),
  (
    'a2760001-0000-4000-8000-00000000000b', 'opt_in', 'en', 1, 'building_notices',
    'Building notices',
    'Works, water shutoffs and the like. Optional.',
    'You can receive notices about works in the building and water shutoffs. This stays off until you turn it on, and you turn it off the same way. The service does not depend on it.',
    true, '2026-10-19 00:00:00+00'
  ),
  (
    'a2760001-0000-4000-8000-00000000000c', 'opt_in', 'ru', 1, 'building_notices',
    'Сообщения о доме',
    'Работы, отключения воды и подобное. Необязательно.',
    'Можно получать сообщения о работах в доме и об отключениях воды. Это выключено, пока вы сами не включите, и выключается так же. Услуга от этого не зависит.',
    true, '2026-10-19 00:00:00+00'
  )
ON CONFLICT (kind, language, version, opt_in_key) DO NOTHING;
