export type UserRole = "admin" | "sales";
export type DocType = "invoice" | "credit_note" | "proforma";
export type InvoiceStatus = "draft" | "issued" | "void";
export type VatMode = "exclusive" | "none";
export type PaymentState = "draft" | "void" | "paid" | "partial" | "unpaid";

export type PaymentMethod =
  | "cash"
  | "mpesa"
  | "mobile_money"
  | "tigopesa"
  | "airtel"
  | "halopesa"
  | "bank"
  | "cheque"
  | "other";

/**
 * Every method that can appear on a record, including ones no longer offered.
 *
 * The brand-specific values are kept so payments already recorded under them
 * still render with a sensible name. They are simply no longer choices — see
 * PAYMENT_METHOD_CHOICES.
 */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  mobile_money: "Mobile Money",
  mpesa: "M-Pesa",
  tigopesa: "Mixx by Yas (Tigo Pesa)",
  airtel: "Airtel Money",
  halopesa: "HaloPesa",
  bank: "Bank transfer",
  cheque: "Cheque",
  other: "Other",
};

/**
 * What the app actually offers when recording a payment.
 *
 * Four, not eight. Naming every mobile money provider separately was four
 * decisions for something the reference field already captures when it matters
 * — "M-Pesa TX4471" tells you both the provider and the transaction.
 */
/**
 * How an invoice's payment state is worded wherever a person reads it.
 *
 * Defined once because it is written in three places — the statement on
 * screen, the statement export and the sales export — and a customer holding
 * two of those side by side should not find the same invoice described in two
 * different vocabularies.
 *
 * Plain words rather than the stored values: `unpaid` and `partial` are how
 * the database talks, and a spreadsheet is read by someone who never agreed to
 * that.
 */
export const PAYMENT_STATE_LABELS = {
  unpaid: "Not paid",
  partial: "Partly paid",
  paid: "Fully paid",
} as const;

export type PaymentStateKey = keyof typeof PAYMENT_STATE_LABELS;

export const PAYMENT_METHOD_CHOICES: PaymentMethod[] = [
  "cash",
  "mobile_money",
  "bank",
  "cheque",
];

export type Org = {
  id: string;
  name: string;
  legal_name: string | null;
  tin: string | null;
  vrn: string | null;
  address: string | null;
  city: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_url: string | null;
  currency: string;
  default_vat_rate: number;
  default_terms_days: number;
  bank_details: string | null;
  invoice_footer: string | null;
  reminder_language: "en" | "sw";
};

export type Customer = {
  id: string;
  org_id: string;
  name: string;
  contact_person: string | null;
  phone_e164: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  tin: string | null;
  vrn: string | null;
  payment_terms_days: number;
  credit_limit: number;
  /**
   * The discount normally given to this customer.
   *
   * A starting point, not a rule: it pre-fills the field on a new invoice and
   * is editable there. What the invoice records is what was actually given, so
   * moving a customer from 5% to 10% next year cannot rewrite what last year's
   * documents said.
   */
  default_discount_percent: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

/** Shape of `products_view` — buying_price is null unless the caller is admin. */
export type Product = {
  id: string;
  org_id: string;
  sku: string | null;
  name: string;
  description: string | null;
  unit: string;
  selling_price: number;
  vat_applicable: boolean;
  is_active: boolean;
  buying_price: number | null;
  margin_pct: number | null;
  created_at: string;
};

/**
 * One of a customer's locations.
 *
 * A customer with three depots is one account with three delivery addresses
 * and three sets of people. The branch carries its own address because being
 * somewhere else is the whole point of it; the invoice falls back to the
 * customer's when a branch has none.
 */
export type CustomerBranch = {
  id: string;
  org_id: string;
  customer_id: string;
  name: string;
  address: string | null;
  city: string | null;
  phone_e164: string | null;
  contact_person: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Invoice = {
  id: string;
  org_id: string;
  doc_type: DocType;
  number: string | null;
  draft_ref: string;
  customer_id: string;
  /**
   * The TIN as it stood when this invoice was raised.
   *
   * Snapshotted rather than read from the customer, so correcting their record
   * later cannot silently change what an already-issued document says.
   */
  customer_tin: string | null;
  order_date: string;
  invoice_date: string | null;
  ship_date: string | null;
  due_date: string | null;
  terms_days: number;
  status: InvoiceStatus;
  vat_mode: VatMode;
  vat_rate: number;
  subtotal: number;
  /**
   * A percentage off the whole invoice, applied before VAT. Zero means none —
   * and zero is what every screen checks to decide whether the word "discount"
   * appears at all.
   */
  discount_percent: number;
  /** What that percentage came to. A snapshot, never recomputed for display. */
  discount_amount: number;
  /**
   * Which of the customer's branches this was for. Null is their head office.
   *
   * The id is what statements group on, so a branch renamed next year keeps
   * one history instead of splitting into two.
   */
  branch_id: string | null;
  /**
   * The branch name as it stood when the document was raised. This is what
   * prints — the same snapshot rule as vat_rate and customer_tin.
   */
  branch_name: string | null;
  vat_amount: number;
  total: number;
  parent_invoice_id: string | null;
  public_token: string;
  customer_notes: string | null;
  internal_notes: string | null;
  void_reason: string | null;
  issued_at: string | null;
  created_at: string;
};

/** Shape of `invoice_items_view` — cost fields are null unless admin. */
export type InvoiceItem = {
  id: string;
  invoice_id: string;
  line_no: number;
  product_id: string | null;
  description: string;
  unit: string;
  qty: number;
  unit_price: number;
  vat_applicable: boolean;
  vat_rate: number;
  line_subtotal: number;
  line_vat: number;
  line_total: number;
  unit_cost: number | null;
  line_cost: number | null;
  line_profit: number | null;
};

export type InvoiceBalance = {
  invoice_id: string;
  org_id: string;
  customer_id: string;
  total: number;
  amount_paid: number;
  balance: number;
  payment_state: PaymentState;
  is_overdue: boolean;
  days_overdue: number;
};

export type CustomerBalance = {
  customer_id: string;
  org_id: string;
  name: string;
  credit_limit: number;
  balance: number;
  overdue_amount: number;
  overdue_count: number;
  bucket_current: number;
  bucket_1_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
};

export type Payment = {
  id: string;
  invoice_id: string;
  paid_on: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  created_at: string;
};

/** An invoice joined with its derived balance — what most list screens want. */
export type InvoiceWithBalance = Invoice & {
  customer: Pick<Customer, "id" | "name" | "phone_e164"> | null;
  balance: InvoiceBalance | null;
};

export type RecurringFrequency = "weekly" | "monthly" | "quarterly" | "yearly";

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: "Every week",
  monthly: "Every month",
  quarterly: "Every quarter",
  yearly: "Every year",
};

export type RecurringInvoice = {
  id: string;
  org_id: string;
  customer_id: string;
  name: string;
  frequency: RecurringFrequency;
  interval_count: number;
  next_run_on: string;
  end_on: string | null;
  terms_days: number;
  vat_mode: VatMode;
  customer_notes: string | null;
  auto_issue: boolean;
  is_active: boolean;
  last_generated_on: string | null;
  generated_count: number;
  created_at: string;
};

export type RecurringItem = {
  id: string;
  recurring_id: string;
  line_no: number;
  product_id: string | null;
  description: string;
  unit: string;
  qty: number;
  unit_price: number;
  vat_applicable: boolean;
};

/** The line-item payload sent to save_draft_invoice(). */
export type DraftLine = {
  product_id: string | null;
  description: string;
  unit: string;
  qty: number;
  unit_price: number;
  vat_applicable: boolean;
};
