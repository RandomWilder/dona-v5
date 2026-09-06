# Notice to data subjects — draft

**Status: draft, and not published.** This file exists so that fuse **F6**'s second half stops being
an unbounded ask and becomes a document with a reviewer. It was written by an agent, it is **not legal
advice**, and it must be reviewed by counsel and by the owner before it is shown to a tenant. What it
does is name every element the notice has to contain, fill in the ones the system already determines,
and mark the ones only the owner can answer — so the review is a correction pass rather than a blank
page.

Why it is owed: Israel's Protection of Privacy Law §11, as amended by **Amendment 13 (in force
15 Aug 2025)**, requires the notice to state the purpose of collection, whether provision is
obligatory or voluntary and the consequence of refusing, **to whom the data will be transferred and
for what purposes**, the identity and contact details of the database controller, and the data
subject's rights of access and correction. Slice 1.12 named the transferees in
[SPEC.md](../SPEC.md); this is the document that tells the tenants.

The blanks marked `⟨…⟩` are the owner's — they are facts about the company, not about the system.

---

## נספח — הודעה לדיירים על עיבוד מידע אישי (טיוטה)

### מי אנחנו
בעל מאגר המידע: ⟨שם החברה המלא⟩, ח.פ. ⟨מספר⟩, ⟨כתובת⟩.
לפניות בענייני פרטיות: ⟨כתובת דוא"ל⟩ · ⟨טלפון⟩.
ממונה על הגנת הפרטיות: ⟨שם ופרטי קשר, אם מונה⟩.

### מה אנחנו אוספים
פרטי הזיהוי והקשר שלך, פרטי הדירה והבניין, מסמכי השכירות הנוגעים אליך (חוזה, פרוטוקול מסירה,
ערבות, אישור ביטוח, חיובי ארנונה), תוכן הפניות שאתה שולח אלינו והתשובות שניתנו לך, ומועדי הביקורים
שנקבעו בעקבותיהן.

### לשם מה
כדי לנהל את השכירות, לענות על שאלותיך על סמך המסמכים שלך, לתאם טיפול בתקלות, ולעמוד בחובות
חוקיות ובחובות חשבונאיות החלות עלינו.

### האם חובה למסור
מסירת פרטי הזיהוי והקשר ומסמכי השכירות דרושה לצורך ההתקשרות וניהולה. **אם לא תמסור אותם, לא נוכל
לנהל עבורך את השכירות ואת הפניות הנוגעות לה.** מסירת פרטים נוספים היא בהסכמתך בלבד.

### למי המידע מועבר, ולשם מה
המידע נשמר ומעובד אצל ספקי שירות הפועלים עבורנו כמעבדי מידע, לפי הוראותינו ובכפוף להסכם עמם.
**חלקם מצויים מחוץ לישראל**, ולכן ההעברה כפופה גם לכללי העברת מידע לחו"ל.

| הגורם | מה הוא רואה | לשם מה |
|---|---|---|
| Google Cloud | מסמכים, רשומות ותמונות עמוד | אחסון, מסד הנתונים, והפקת טקסט ממסמך סרוק |
| OpenAI | טקסט מתוך המסמכים והשאלות שנשאלו | הפקת התשובה ואיתור הסעיף הרלוונטי |
| Meta — WhatsApp | תוכן ההודעות שנשלחות ומתקבלות בערוץ זה | קיום השיחה עצמה |
| Twilio | מספר הטלפון והודעת קוד האימות | אימות זהות כאשר אין ערוץ WhatsApp |

איננו מוכרים מידע אישי ואיננו מעבירים אותו למטרות שיווק של צד שלישי.

### כמה זמן
המידע נשמר כל עוד השכירות בתוקף, ולאחריה למשך התקופה שהדין מחייב לשמור בה מסמכים ורישומים
חשבונאיים — ⟨תקופה, לאחר בדיקת יועץ⟩ — ואז נמחק.

### הזכויות שלך
לעיין במידע שעליך, לבקש את תיקונו אם אינו נכון, שלם או מעודכן, ולבקש את מחיקתו בכפוף לדין.
לפנייה: ⟨כתובת דוא"ל⟩. אם התשובה אינה מניחה את דעתך, אתה רשאי לפנות לרשות להגנת הפרטיות.

---

## English gloss, for the reviewer

Who we are · what we collect · why · whether it is obligatory and what happens if you refuse · **who
it is transferred to and why, including that some of them are outside Israel** · how long it is kept ·
your rights of access, correction and deletion, and the regulator you may complain to.

## What counsel and the owner must settle before this is published

1. **The blanks.** Company legal name, registration number, address, privacy contact, and whether a
   Privacy Protection Officer has been appointed — Amendment 13 makes that appointment mandatory for
   some controllers and the answer is the owner's, not the system's.
2. **The retention period**, which is a legal answer and not an engineering one. The system will
   enforce whatever number is given here; today nothing enforces a number because no number exists.
3. **Cross-border transfer.** OpenAI and Anthropic are outside Israel; Google Cloud stores in
   `me-west1` but its processing is not exclusively Israeli. Confirm the basis, and confirm that the
   transfer clauses in each processor's addendum are the ones being relied on.
4. **How the notice reaches a tenant** — at signature, in the tenancy agreement, on first contact
   through the agent channel, or all three. This is the one item with an engineering consequence:
   *first contact through the agent channel* means week 9 builds a step for it, and that has to be
   known before week 9 rather than during it.
5. **Whether the agent channel needs its own line**, saying that the party answering may be automated.
   Not required by §11, and cheaper to decide now than to retrofit at week 10.

## What this notice does *not* have to cover

**Anthropic.** Claude Code reads this repository as it is built, and this repository never contains a
tenant document — see [SPEC.md](../SPEC.md), Security defaults, and the corpus rules. It is a
development-time tool that processes no tenant personal data, so it is not a transferee to disclose
here. It is still named in `SPEC.md`, because the register of who sees text from this system is a
different list from the register of who sees tenant data, and conflating them is how a third party
gets discovered late.
