// How an HTML form's body becomes an object. Slice 5.1.
//
// It lived in `src/estate/internal/routes.ts` from 2.6, because estate had the only screen that
// posted. Slice 5.1 gives a second module a form, and the choice at that moment is the one slice
// 3.3 faced with the page shell: copy the parser into `src/staff/` or move it here. A copied
// parser is a copy that drifts — one of them starts trimming, the other does not, and two screens
// disagree about what an empty field means.
//
// **No dependency.** `URLSearchParams` is in the standard library, so unlike the multipart body at
// 3.3 — which needed `@fastify/multipart`, because hand-parsing a boundary-delimited stream of
// untrusted bytes is not work worth owning — this is six lines and belongs to us.
//
// Registered once, by the composition root, for the same reason `registerUiAssets` is: a content
// type parser is a property of the application and not of whichever module happened to need it
// first.
import type { FastifyInstance } from 'fastify';

export function registerFormBodies(app: FastifyInstance): void {
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      try {
        // Repeated names collapse to the last value, which is what a form with one input per name
        // means and what every caller in this system expects. A screen that ever needs the other
        // reading asks for it here, once, rather than parsing the body again itself.
        done(null, Object.fromEntries(new URLSearchParams(String(body))));
      } catch (error) {
        done(error as Error);
      }
    },
  );
}
