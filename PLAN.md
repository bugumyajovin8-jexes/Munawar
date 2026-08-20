# Invoicing & Customer Management System — Build Plan

**Locale:** Tanzania · TZS · VAT 18% · dates `DD/MM/YYYY` · timezone `Africa/Dar_es_Salaam` · phones E.164 (`+255…`)
**Users:** Multi-user with roles (admin / sales)
**Invoice policy:** Issued invoices are immutable; corrections via credit note
**WhatsApp:** `wa.me` click-to-chat, behind a swappable provider interface

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| App | Next.js 15 (App Router) + TypeScript | Server Actions for all mutations |
| UI | Tailwind + shadcn/ui | Mobile-first; installable as PWA |
| DB / Auth | Supabase (Postgres, RLS, Storage) | Storage for logo + generated PDFs |
| PDF | `@react-pdf/renderer` (server) | Avoid Puppeteer on Vercel — cold starts + binary size |
| Excel | `exceljs` | Formatted sheets, not raw CSV |
| Scheduling | Vercel Cron → API route | Nightly overdue sweep + reminder queue |
| Hosting | Vercel | GitHub → Vercel auto-deploy |

**Rule:** the Supabase *service role* key never enters a client bundle. All privileged work happens in Server Actions / Route Handlers.

---

## 2. Roles & the cost-price problem

Two roles: `admin` and `sales`.

| Capability | admin | sales |
|---|---|---|
| Create customers / products | ✅ | ✅ (customers only) |
| See `buying_price`, margin, profit reports | ✅ | ❌ |
| Create & issue invoices | ✅ | ✅ |
| Record payments | ✅ | ✅ |
| Void invoice / issue credit note | ✅ | ❌ |
| Change company settings, VAT rate, users | ✅ | ❌ |

**Important:** Postgres RLS is *row*-level and cannot hide a column. Hiding `buying_price` from sales needs a different mechanism:

1. Expose products to the client through a view `products_visible` that omits `buying_price` / `unit_cost`.
2. `REVOKE SELECT (buying_price) ON products` from the anon/authenticated roles; grant the base table only to a `SECURITY DEFINER` function used by admin paths.
3. Belt-and-braces: server-side role check before any profit query returns.

Do all three. Doing only #1 leaves the raw table queryable from the browser.

---

## 3. Data model

```
orgs                  id, name, tin, vrn, address, phone, email, logo_url,
                      default_vat_rate (18.00), default_terms_days, bank_details,
                      invoice_footer, currency ('TZS')

org_members           org_id, user_id, role ('admin'|'sales')

customers             org_id, name, contact_person, phone_e164, email, address,
                      tin, vrn, payment_terms_days, credit_limit, notes,
                      is_active, created_at

products              org_id, sku, name, description, unit ('pcs','kg','box'),
                      selling_price numeric(14,2), buying_price numeric(14,2),
                      vat_applicable bool, is_active

customer_prices       org_id, customer_id, product_id, agreed_price,
                      last_used_at            -- powers auto-fill (req #3)

invoices              org_id, doc_type ('invoice'|'credit_note'|'proforma'),
                      number text null,        -- NULL while draft
                      draft_ref text,          -- 'DRAFT-000123'
                      customer_id,
                      order_date  date,        -- when the customer ordered
                      invoice_date date null,  -- set at ISSUE time
                      ship_date   date null,   -- set when shipped
                      due_date    date null,   -- invoice_date + terms_days
                      terms_days int,
                      status ('draft'|'issued'|'paid'|'void'),
                      vat_mode ('exclusive'|'none'),
                      vat_rate numeric(5,2),   -- snapshot, NOT read from settings
                      subtotal, vat_amount, total  numeric(14,2),
                      parent_invoice_id,       -- credit note → original
                      public_token uuid,       -- shareable link
                      notes, issued_by, created_at

invoice_items         invoice_id, line_no, product_id null,
                      description text,        -- snapshot
                      qty numeric(14,3),
                      unit_price numeric(14,2),-- SNAPSHOT
                      unit_cost  numeric(14,2),-- SNAPSHOT (profit reporting)
                      vat_applicable bool,
                      line_subtotal, line_vat, line_total

payments              org_id, invoice_id, paid_on date, amount numeric(14,2),
                      method ('cash'|'mpesa'|'tigopesa'|'airtel'|'bank'|'cheque'|'other'),
                      reference, note, recorded_by, created_at

document_counters     org_id, doc_type, year, next_number   -- atomic numbering

reminders_log         org_id, invoice_id, channel ('whatsapp'), sent_at,
                      sent_by, message_snapshot, days_overdue

audit_log             org_id, actor_id, entity, entity_id, action,
                      before jsonb, after jsonb, at timestamptz
```

### Derived, never stored
- **Balance** = `total − COALESCE(SUM(payments.amount), 0)` → SQL view `invoice_balances`
- **Overdue** = `status='issued' AND due_date < current_date AND balance > 0`
- **Payment state** = `balance = total` → unpaid; `0 < balance < total` → partial; `balance <= 0` → paid

Storing these as columns guarantees drift the first time a payment is edited.

---

## 4. Critical implementation rules

### Money
`numeric(14,2)` everywhere. Never `float`/`real`/`double`. In TypeScript, do arithmetic in integer minor units or with `decimal.js` — plain JS numbers lose precision on totals.

TZS displays with no decimals (`TSh 1,250,000`) but **stores** 2dp. Formatting is a display concern only.

### Dates
- `invoice_date`, `due_date`, `ship_date`, `order_date`, `paid_on` → Postgres `date`, not `timestamp`. A `timestamptz` date field will silently shift a day depending on the viewer's timezone.
- Event timestamps (`created_at`, `sent_at`) → `timestamptz`.
- All UI rendering `DD/MM/YYYY`, all input via a date picker that emits ISO.

### VAT (18%)
- `vat_rate` is snapshotted onto the invoice at issue. If Tanzania ever changes the rate, historical invoices stay correct.
- Compute **per line**: `line_vat = round(line_subtotal × rate/100, 2)`, then sum. Rounding once at the total produces off-by-one-shilling disputes.
- `vat_mode='exclusive'` means VAT is added on top (customer pays it) — matches requirement #4.
- Per-product `vat_applicable` flag supports zero-rated/exempt items later without a schema change.

### Invoice numbering
Format: `INV-2026-0001`, `CN-2026-0001`, `PRO-2026-0001` — separate sequence per doc type per year.

Generated **only** by a Postgres `SECURITY DEFINER` function:

```sql
create or replace function next_document_number(p_org uuid, p_type text)
returns text language plpgsql security definer as $$
declare v_year int := extract(year from current_date);
        v_num  int;
begin
  insert into document_counters (org_id, doc_type, year, next_number)
  values (p_org, p_type, v_year, 1)
  on conflict (org_id, doc_type, year)
  do update set next_number = document_counters.next_number + 1
  returning next_number into v_num;          -- row lock = atomic

  return case p_type
    when 'invoice'     then 'INV'
    when 'credit_note' then 'CN'
    else 'PRO' end
    || '-' || v_year || '-' || lpad(v_num::text, 4, '0');
end $$;
```

Never generate numbers in JavaScript — two fast clicks produce a duplicate.

**Drafts carry `draft_ref` only.** The real number is assigned at issue, so deleting a draft never punches a gap in the sequence.

### Immutability & credit notes
Once `status='issued'`:
- A DB trigger rejects `UPDATE` on `invoices` / `invoice_items` for financial columns.
- Mutable after issue: `notes`, `ship_date` (first set only), `public_token`.
- To correct: **void** (if no payments) or issue a **credit note** referencing `parent_invoice_id`.
- Credit notes carry negative totals, appear on statements, and reduce the customer balance.

### RLS
Every table: `org_id = (select org_id from org_members where user_id = auth.uid())`. Written on day one even though there's one org — retrofitting is a rewrite.

---

## 5. Requirement → design mapping

| # | Requirement | How |
|---|---|---|
| 1 | Customer profiles | `customers` + profile page: contact, balance, aging, full history |
| 2 | Products, no stock | `products` with selling + buying price, no quantity tracking |
| 3 | Per-customer price edit | Editable on the line; saved to `customer_prices` and **auto-filled next time** |
| 4 | VAT toggle | Per-invoice `vat_mode`; 18% added on top; rate snapshotted |
| 5 | Auto invoice number | `next_document_number()`, searchable via Ctrl+K |
| 6 | Statement + report + Excel | Date-ranged statement (opening → transactions → closing) + `exceljs` export |
| 7 | Overdue + WhatsApp | Derived overdue view; `wa.me` link quoting the invoice number |
| 8 | Full / partial payment | `payments` ledger; "Pay full" prefills balance; partials just work |
| 9 | Order → draft → ship | Three dates; "Ship & Issue" sets `ship_date` + `invoice_date` + number + due date |
| 10 | Due date picker | 15/30/60/90 buttons + custom days, defaults to customer terms, prints `DD/MM/YYYY` |
| 11 | Payment per invoice | `payments.invoice_id` is required — no floating customer credits |

### Requirement #9 flow in detail
```
12/08  Create → order_date=12/08, status=draft, draft_ref=DRAFT-000123
       Choose: [Print Proforma Now]  or  [Save as Draft]
15/08  Open draft → [Ship & Issue]
         ship_date    = 15/08
         invoice_date = 15/08          ← updates as you asked
         number       = INV-2026-0001  ← assigned now
         due_date     = 15/08 + terms_days
         status       = issued  (locked)
```

---

## 6. Beyond the brief

### Phase 3 additions
1. **Profit everywhere** — `unit_cost` snapshots make gross margin per invoice / customer / product / month free. Admin-only.
2. **Public invoice link + QR** — send a `wa.me` message containing a link, not a PDF attachment. Customer sees live payment status and downloads the PDF themselves.
3. **Reminder ladder** — nightly cron builds a queue: −3 days, due date, +7, +14, +30. One screen each morning, tap to send.
4. **Duplicate invoice** — one click to reissue a customer's last order.
5. **Amount in words** on the PDF (expected on TZ invoices).
6. **Payment receipt PDF** auto-generated on payment, shareable on WhatsApp.
7. **Aging dashboard** — Current / 1–30 / 31–60 / 61–90 / 90+ per customer.
8. **Delivery note** printed at the ship step.
9. **Credit limit warning** before invoicing an over-exposed customer.
10. **Ctrl+K command palette** — jump to any customer, invoice number, or product.
11. **PWA** — installable, works on poor connections.
12. **Recurring invoices** for monthly customers.
13. **Statement as a shareable link**, same mechanism as #2.
14. **One-click full backup** to Excel — never locked in.

### WhatsApp message template (click-to-chat)
```
https://wa.me/255XXXXXXXXX?text=<urlencoded>

Habari {customer_name},

Ankara namba {INV-2026-0001} ya TSh {total} ilikuwa ilipwe tarehe {due_date}.
Kiasi kilichobaki: TSh {balance} ({days} siku zimepita).

Tafadhali angalia: {public_link}

Asante,
{company_name}
```
Swahili/English toggle in settings. `message_snapshot` is written to `reminders_log` so you always know exactly what was sent.

---

## 7. Compliance note (verify before go-live)

18% VAT means TRA. If the business is VAT-registered, Tanzania requires fiscalised receipts through an EFD/VFD device or the TRA VFD API. Invoices from this system would **supplement**, not replace, fiscal receipts. Not a blocker for building — but confirm the obligation before treating these as the sole tax document. If VFD integration is later required, it slots in as a post-issue step on the invoice state machine.

---

## 8. Build order

> **Status:** Phases 1, 2 and 3 are all built.
> Two deliberate deviations from this plan, both explained in the README:
> the invoice PDF is produced by a print-optimised page rather than
> `@react-pdf/renderer`, and invoice `status` is lifecycle-only
> (`draft | issued | void`) with payment state derived, because storing `paid`
> as a status contradicts the derived-balance rule above.

**Phase 1 — core loop (the real milestone)** ✅
Supabase project + schema + RLS · auth & roles · company settings · customers · products (with cost hidden from sales) · invoice builder with VAT · draft → Ship & Issue → numbering · immutability triggers · PDF · payments (full/partial) · invoice list & search

*Outcome: the business can actually run on it.*

**Phase 2 — getting paid** ✅
Overdue view · ageing buckets · WhatsApp reminders + log · customer statements · Excel export · dashboard

**Phase 3 — smart** ✅
Customer price memory · profit reports · public links + QR · credit notes UI ·
recurring invoices · PWA · command palette · backup export · duplicate invoice ·
payment receipts · delivery notes

One item landed differently: the planned "reminder cron" turned out to be
unnecessary. The reminder ladder is *derived* live on `/reminders` from
`invoice_balances`, so a nightly job to build a queue would only duplicate what
a query already answers — and click-to-chat cannot auto-send anyway. The cron
that does exist earns its keep by generating recurring invoices, which genuinely
needs a schedule.

Phases 2 and 3 are purely additive against the schema above — no migrations required if Phase 1 is built as specified.

---

## 9. Repo layout

```
/app
  /(auth)/login
  /(app)/dashboard
        /customers/[id]
        /products
        /invoices/[id]
        /invoices/new
        /payments
        /reports/{statement,aging,profit,sales}
        /settings
  /(public)/i/[token]          -- customer-facing invoice view
  /api/cron/overdue-sweep
/lib
  /db        supabase clients (server / browser / admin)
  /money     numeric helpers, TZS formatting, amount-in-words
  /vat       per-line VAT calculation
  /pdf       invoice, credit note, receipt, delivery note
  /excel     statement, aging, sales, profit exports
  /whatsapp  provider interface + wa.me implementation
/supabase
  /migrations
```
