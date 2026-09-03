# Munawar — Invoicing & Receivables

Invoicing, customers and receivables for a Tanzanian business.
**TZS · 18% VAT · `DD/MM/YYYY` · Africa/Dar_es_Salaam · phones in E.164 (`+255…`)**

Next.js 16 · React 19 · Tailwind v4 · Supabase (Postgres + RLS) · deploys to Vercel.

> Full design rationale and the Phase 2/3 roadmap live in [PLAN.md](PLAN.md).

---

## What it does

**Phase 1 — the core loop**

| | |
|---|---|
| **Customers** | Profiles, terms, credit limit, balance, ageing, full history |
| **Products** | Selling + buying price, no stock tracking. Cost hidden from the sales role |
| **Invoices** | Line builder, per-customer price memory, VAT toggle, draft → issue |
| **Numbering** | `INV-2026-0001`, minted by the database, gap-free |
| **Dates** | Separate order / invoice / ship / due dates — issue on the day you ship |
| **Payments** | Full or partial, always against one invoice number |
| **Print** | A4 tax invoice with VAT breakdown, amount in words, bank details |
| **Team** | Admin and sales roles with real, enforced separation |

**Phase 2 — getting paid**

| | |
|---|---|
| **Reminders** | Overdue grouped by customer, WhatsApp messages quoting the invoice number, every send logged |
| **Due soon** | Invoices falling due within 7 days, so you can nudge before they slip |
| **Statements** | Date-ranged, opening → transactions → closing, with running balance |
| **Ageing** | Current / 1–30 / 31–60 / 61–90 / 90+ per customer and across the book |
| **Reports** | Sales by month, top customers, VAT charged, gross profit (admin only) |
| **Excel** | Statement, aged receivables, sales and payments — real dates and numbers, not text |

**Phase 3 — less manual work**

| | |
|---|---|
| **Public links** | Every issued invoice gets a secret URL and a QR code on the print-out. Send a link, not an attachment |
| **Credit notes** | Correct an issued invoice properly — full or selected lines, own `CN-2026-0001` sequence |
| **Duplicate** | Copy any invoice into a fresh draft for repeat orders |
| **Recurring** | Weekly/monthly/quarterly/yearly templates that generate drafts — or issue outright — on a nightly cron |
| **Command palette** | Ctrl+K to jump to any customer, invoice number or product |
| **Receipts** | Printable receipt per payment, with amount in words and the balance after it |
| **Delivery notes** | Quantities without prices, with signature lines, for the goods to travel with |
| **PWA** | Installable to a phone home screen, with shortcuts to New invoice, Payments and Reminders |
| **Works offline** | Screens you have opened stay readable with no signal; payments, customers, products, drafts and reminders queue on the device and send themselves when the connection returns |
| **Persistent storage** | The queue asks the browser to exempt it from eviction, so unsent work cannot be cleared away to reclaim space |
| **Backup** | One click, every table, one workbook — you are never locked in |

---

## Setup

### 1. Create the Supabase project

At [supabase.com](https://supabase.com), create a project (pick a region near Tanzania —
`eu-central-1` or `ap-south-1` are the usual choices).

### 2. Run the migrations

Open **SQL Editor** in the Supabase dashboard and run these three files **in order**,
one at a time:

```
supabase/migrations/0001_init.sql       -- tables, enums, generated columns
supabase/migrations/0002_security.sql   -- RLS, column grants, views
supabase/migrations/0003_rpc.sql        -- numbering, immutability, write API
supabase/migrations/0004_phase3.sql     -- credit notes, recurring, public links
supabase/migrations/0005_grants.sql     -- explicit table privileges
supabase/migrations/0006_offline.sql    -- idempotency ledger for offline sync
```

If you see **`permission denied for table …`** anywhere, re-run `0005_grants.sql`.
Supabase no longer applies inherited default privileges to new tables, so every
table needs its grants stated explicitly. That file is safe to re-run and
repairs a database in any state.

Grants and RLS are two separate gates, and this is the usual source of
confusion: **grants decide whether you may touch a table at all and are checked
first; RLS decides which rows.** A policy on a table with no grant is never even
consulted — which is why a missing grant looks like "the row isn't there"
rather than "you are not allowed".

Each should report success before you run the next.

### 3. Configure environment variables

Copy `.env.example` to `.env.local` and fill in the values from
**Project Settings → API**:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only and bypasses RLS. It is used for
exactly one thing — creating team member accounts. Never prefix it with
`NEXT_PUBLIC_`.

### 4. Run it

```bash
npm run dev
```

Open <http://localhost:3000>, choose **Create an account**, then fill in your
business details. That first account becomes the administrator.

> If Supabase has email confirmation enabled (the default), either confirm via
> the emailed link or switch it off under **Authentication → Providers → Email**
> while you are setting up.

---

## Deploying to Vercel

1. Push the repo to GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new).
3. Add the environment variables from `.env.example` under
   **Settings → Environment Variables** — including `CRON_SECRET`, or the
   nightly job refuses to run.
4. Deploy.

Add your Vercel URL to Supabase under **Authentication → URL Configuration → Site URL**
so auth redirects resolve correctly.

`vercel.json` schedules the recurring-invoice job at `10 21 * * *` — that is
**21:10 UTC = 00:10 East Africa Time**, just after midnight in Dar es Salaam.
Vercel Cron always speaks UTC, so adjust that expression, not a timezone
setting, if you want it to run at a different local hour.

---

## How the important bits work

**Invoice numbers come from the database.** `next_document_number()` takes a row
lock on a counter, so two fast clicks queue rather than minting the same number
twice. Drafts carry a `DRAFT-000123` reference instead and only get a real
number at issue — abandoning a draft leaves no gap in the sequence.

**Ordered on the 12th, shipped on the 15th.** Save the order as a draft with
`order_date = 12/08`. On the 15th, hit **Ship & issue**: the invoice date, the
number and the due date are all stamped on the 15th, and the document locks.

**Issued invoices cannot be edited.** A database trigger rejects any change to
a financial field once `status = 'issued'`. Corrections go through **Void** (if
untouched) or a credit note. This is what makes the books trustworthy.

**Money is never computed in JavaScript.** Line subtotals and VAT are Postgres
generated columns; invoice totals come from `recalc_invoice_totals()`. VAT is
rounded per line and then summed — rounding once at the total is what produces
off-by-one-shilling arguments. The browser only previews, using the same rules
(`src/lib/money.ts`).

**The sales role genuinely cannot see cost prices.** RLS is row-level and cannot
hide a column, so three things stack: column-level `SELECT` grants that exclude
`buying_price` and `unit_cost`; a definer view (`products_view`) that returns
cost only when `is_admin()`; and every invoice write routed through
`SECURITY DEFINER` functions. Any one alone is bypassable.

This is also why `0005_grants.sql` names every table by hand instead of using
`grant all on all tables in schema public`. The blanket form would hand out
`SELECT` on `buying_price` and `unit_cost` and quietly dismantle the firewall
above, with nothing failing to warn you.

**Balances and "overdue" are derived, never stored.** `invoice_balances` and
`customer_balances` compute from the payments ledger on read, so a corrected
payment can't leave a stale status behind.

**Dates use `today_local()`, not `current_date`.** Postgres `current_date` is
UTC; at 01:00 EAT that is still yesterday, which would make invoices look
overdue a day early.

**WhatsApp reminders are click-to-chat.** The app composes the message —
quoting the invoice number, amount, due date and days overdue — and hands it to
WhatsApp via a `wa.me` link. You press send. Free, no Meta business
verification, works from your phone. Because of that we cannot confirm
delivery, so the log records the moment WhatsApp opened with the message
prepared, and the UI says exactly that rather than implying a read receipt.
`ReminderProvider` in `src/lib/whatsapp.ts` is the seam where the WhatsApp
Cloud API drops in later for genuinely automated sending.

**Statements are built once, in `src/lib/statement.ts`.** The screen, the print
view and the Excel export all read from the same builder, so the three can
never disagree about a balance.

**Credit notes carry a negative total.** That one decision means every balance,
statement and ageing view handles them correctly with no special-casing — a
credit simply reduces what the customer owes. The original invoice is never
touched, which is the whole point of freezing it on issue.

**Public invoice links are a database function, not a table grant.**
`public_invoice(token)` is `SECURITY DEFINER`, granted to `anon`, and assembles
the payload field by field — no internal notes, no cost prices, nothing the
customer would not see on paper. The token is a random UUID, the page sets
`noindex`, and drafts are excluded because they have no number yet.

**The cron authenticates with a bearer token, not a cookie.** `/api/cron/` is
therefore excluded from the proxy's login redirect, and the route rejects
anything without `CRON_SECRET`. `generate_due_recurring_invoices()` has EXECUTE
revoked from `anon` and `authenticated` — only the service role can run it,
because it works across every org.

**Cached pages are partitioned by user, and destroyed on sign out.** Every
screen is per-user and behind auth, so a shared phone must never let the next
person scroll back through the last person's balances. Pages live in a cache
named after the signed-in user id; the worker caches nothing at all until a
page has told it who that is, refuses to cache any response that redirected
(that is the login page wearing the invoice list's URL), and drops every page
cache when someone signs out.

**Offline work is queued, not guessed at.** Writes go into an IndexedDB outbox
before they are sent — one code path, online or off, so the offline path cannot
rot from disuse. Each queued item carries a uuid that `/api/sync` records in
`client_ops` *before* doing any work, which is what makes a retry safe: a
payment sent twice because the first acknowledgement was lost is recognised and
skipped rather than booked twice. `/api/sync` applies each item through the
very same server action the online path uses, in the order the device recorded
them, stopping at the first rejection.

**The device downloads a working set, not the archive.** "Cache every page"
sounds right and scales terribly: a business with two thousand invoices would
mean two thousand server renders and six thousand Supabase queries per device,
to hold paperwork from three years ago that nobody opens standing in a shop.
So `/api/offline-manifest` decides server-side what is worth having, and it is
opinionated about what offline is *for* — money that has not arrived yet:
unpaid invoices oldest-due first, the customers who owe you, the drafts about
to be issued, plus the list screens. Capped at 60/30/12 and role-aware, so a
sales user is never sent a page they cannot open.

Three rules stop that becoming a data bill: anything cached in the last hour is
skipped (most of a run is skips, so only genuinely new invoices are fetched),
pages are fetched one at a time with a 150 ms gap so warming never competes
with the screen in front of you, and the first network failure ends the run.
`Save-Data` is honoured — someone counting megabytes has been clear enough.

Everything else stays an ordinary online page and caches itself when opened.
The sync panel shows how many screens are held and offers a **Save more**
button, because "before I get on the road" is a moment the app cannot predict
but the user can.

**Online navigation reads the cache first too.** The app was quicker with no
signal than with one, which is a fair complaint: offline it read from disk,
online it waited on Vercel waiting on Supabase. Three caches now sit in front
of that round trip — the service worker serves a cached page immediately and
refreshes it behind (`stale-while-revalidate`), Next's client cache keeps
visited routes in memory (`staleTimes.dynamic`, which defaults to 0 and was
disabling itself), and hovering a row or a nav link for 120ms prefetches the
whole route including its data.

None of that would be acceptable on its own — an accounting app that quietly
shows old balances is worse than a slow one. So `FreshnessGuard` re-fetches in
the background on load, once a minute, and on returning to the app after being
away for two minutes, swapping the new figures in without a spinner or a scroll
jump. **The cache buys the paint, not the truth.** Recording a payment still
calls `router.refresh()`, which invalidates the client cache outright.

That component used to refresh on every `focus` and every `visibilitychange`,
throttled to ten seconds. Alt-tabbing to copy a phone number and coming straight
back therefore re-rendered every server component against a database in another
country, which is why returning to the app always looked like it was reloading.
Glancing away is not a reason to refetch: the figures cannot have moved in the
four seconds you were gone.

**Clicking a link is not a navigation, and that is the bug this cache existed
without for far too long.** The App Router does not navigate between pages — it
fetches an RSC payload and re-renders in place — so a worker watching for
`request.mode === "navigate"` saw exactly one request per session: the document
first loaded. Every screen reached by clicking was invisible to it and never
cached. The app *appeared* to remember pages only because Next keeps visited
routes in memory for the life of the tab; closing the tab threw that away and
revealed that nothing had ever reached disk.

The RSC request is still passed to the network untouched — replaying a payload
built for a different router state would corrupt the client — but it is now
treated as the signal it is: this user just opened this page, so fetch the real
document behind it and keep that. Offline, the RSC fetch fails, Next falls back
to a full browser navigation, and that navigation finds the document waiting.
Hover prefetches are excluded, since turning a mouse crossing fifty rows into
fifty page renders would cost more than it ever saved.

**Only an explicit sign out clears the page cache.** An earlier version also
purged it whenever a background refresh landed on `/login`, reasoning the
session must have expired. That was wrong and destructive: the refresh races
the page's own request, Supabase rotates refresh tokens, and a perfectly valid
session could lose that race, bounce to `/login` once, and take every cached
page with it — an app that appears to forget everything each time it is
reopened. A genuinely expired session needs no such help: nothing new gets
cached, and the first real navigation lands on the login page by itself.

**Every background refresh is gated on a connectivity probe**, and that gate is
load-bearing rather than defensive. `router.refresh()` offline does not simply
fail — Next falls back to a full browser navigation, so the page reloads out of
the service worker cache, `FreshnessGuard` mounts again and refreshes again,
and the app flickers and reloads forever. A cheap `HEAD /api/ping` with a
four-second deadline means that cycle can never start.

**The queue asks not to be evicted.** By default a browser treats IndexedDB as
*best effort* — under storage pressure it may delete a site's data without
asking and without telling anyone. That is survivable for cached pages and not
survivable for an unsent payment, so `navigator.storage.persist()` is called
to opt out of it. Installed apps ask on load, since Chromium and Safari both
grant it to them silently — which is the second reason the install card exists.

In an ordinary browser tab the question rides along with the first click
anywhere in the app, once per device. That is not politeness, it is mechanics:
Firefox decides this with a prompt and **will not raise that prompt for a page
that asks on its own** — the call has to come out of a user gesture. Two earlier
versions missed this. The first only asked once something was queued, so a tab
with an empty queue never asked at all; the second added a button but put it
behind a dialog behind a chip reading "All changes saved", which is not
somewhere anyone goes looking.

A refusal is not treated as an error. It is shown: the sync panel still carries
an **Allow permanent storage** button whenever storage is not reserved.

To check it yourself, open devtools and look at the console on load:

```
Munawar persistent storage: GRANTED ✓ · using 2.0 MB of 2685.7 MB
```

`window.munawar` is left behind for a closer look — `munawar.storage()` reprints
the report, `munawar.queue()` lists what is waiting to sync, `munawar.caches()`
shows what is cached, and `munawar.requestPersistence()` asks again.

**Issuing an invoice still requires a connection.** Numbers come from a row
lock in the database precisely so they are unique and gap-free; a phone minting
its own would eventually hand two customers the same invoice number. Offline,
the builder saves a draft instead and says so.

---

## Project layout

```
src/
  app/
    (app)/            dashboard, customers, products, invoices, payments,
                      reminders, recurring, reports, settings
    (print)/          A4 documents: invoice, receipt, delivery note
    (public)/i/       customer-facing invoice link — no sign-in
    api/export/       Excel: statement, ageing, invoices, payments, backup
    api/cron/         nightly recurring-invoice generation
    api/sync/         drains a device's offline queue, exactly once
    api/ping/         204, used to detect that the network is back
    api/offline-manifest/  which screens this device should hold offline
    offline/          service-worker fallback — no JS, no session
    login/            sign in and account creation
    onboarding/       first-run business setup
  components/
    ui/               buttons, dialogs, tables, combobox…
    shell/            sidebar, mobile top bar, tab bar
    offline/          sync status, freshness guard, install card
    invoice-document  the printable invoice
  lib/
    supabase/         server / browser / admin clients
    offline/          outbox, IndexedDB store, connectivity, persistent
                      storage, worker messaging
    money.ts          rounding that matches the SQL
    format.ts         TZS and DD/MM/YYYY
    words.ts          amount in words
    phone.ts          E.164 normalisation
    whatsapp.ts       reminder + share templates (EN/SW), provider seam
    statement.ts      statement of account builder
    excel.ts          workbook helpers
    qr.ts             inline SVG QR codes
    site-url.ts       origin for shareable links
supabase/migrations/  the six SQL files above
public/               PWA manifest icons and the service worker
```

---

## Responsive behaviour

Desktop is the primary target: a persistent sidebar, dense tables, and a sticky
summary rail beside the invoice builder. Below `lg` the same screens switch to
a drawer plus bottom tab bar, and every table becomes cards — a six-column
table is unreadable at 375px, so it isn't shown there.

---

## Known issue

`npm audit` reports a **moderate** advisory against `uuid`, pulled in
transitively by `exceljs`: a missing buffer bounds check in `uuid` v3/v5/v6
when the caller supplies a `buf` argument. Nothing here calls those functions,
so it is not reachable from this code. `npm audit fix --force` "resolves" it by
downgrading to `exceljs@3.4.0` — a 2019 release and a breaking change — which
is worse than the exposure. Left as is deliberately; revisit when exceljs
updates its `uuid` dependency.

## Commands

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run lint
```

```bash
npm run test:sw
```

The last one drives `public/sw.js` in Node against a mocked Cache API. It exists
because the service worker has failed silently twice, and both times it looked
from the outside like it was working — a worker caching nothing is
indistinguishable from one caching everything until the tab is closed, since
Next's in-memory router cache hides the difference. It asserts what reaches the
page cache and when, and that pages stay partitioned by user and are destroyed
on sign out.

**The worker only registers in production builds** (see `pwa-register.tsx`), so
offline behaviour cannot be tested with `npm run dev`. Use `npm run build && npm
start`, or the deployed site.
