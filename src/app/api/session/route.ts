import { getSession } from "@/lib/auth";

/**
 * Who is signed in, for the client shell to read once and remember.
 *
 * The app shell used to establish this on the server on every single
 * navigation. That is what kept every route dynamic: reading cookies forces
 * Next to render on demand, so each link click cost a request to Vercel plus
 * two round trips to Supabase — one in the proxy and one in requireSession —
 * before rendering a page that no longer fetches any data at all.
 *
 * Moving it here makes the routes static, which is what lets Next prefetch a
 * whole page and navigate with no network at all.
 *
 * This is not a weakening of access control. The proxy still checks the
 * session on every real request and redirects anyone without one, and the data
 * itself is still fetched through /api/pull under RLS and the column grants.
 * All that has moved is where the shell reads the user's *name* from.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  return Response.json(
    {
      userId: session.userId,
      email: session.email,
      fullName: session.fullName,
      role: session.role,
      orgId: session.orgId,
      orgName: session.org.name,
      // Reminders are composed on the device now, and the message is written
      // in whichever language the business set.
      reminderLanguage: session.org.reminder_language,
      defaultTermsDays: session.org.default_terms_days,
      defaultVatRate: Number(session.org.default_vat_rate),
      /*
       * The whole business record, not just its name.
       *
       * It is the letterhead — legal name, TIN, VRN, address, bank details,
       * footer — and the invoice document cannot be drawn without it. Now that
       * the document is rendered on the device, this is the only way it gets
       * there. One small row, fetched once and kept, against a screen that
       * would otherwise need the server to show somebody their own invoice.
       */
      org: session.org,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
