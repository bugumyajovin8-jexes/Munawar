"use client";

import { useActionState, useEffect } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveOrgSettings, type FormState } from "./actions";
import type { Org } from "@/lib/types";

// Lives here rather than in actions.ts: that file is "use server", where only
// async functions may be exported.
const EMPTY: FormState = { error: null, notice: null, ok: false };

export function SettingsForm({ org }: { org: Org }) {
  const [state, action, pending] = useActionState(saveOrgSettings, EMPTY);

  useEffect(() => {
    if (state.ok && state.notice) toast.success(state.notice);
  }, [state.ok, state.notice]);

  return (
    <form action={action} className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Business details</CardTitle>
          <CardDescription>
            This is the letterhead printed at the top of every invoice.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Business name *</Label>
            <Input id="name" name="name" required defaultValue={org.name} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="legal_name">Registered name</Label>
            <Input
              id="legal_name"
              name="legal_name"
              defaultValue={org.legal_name ?? ""}
              placeholder="If different from the trading name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tin">TIN</Label>
            <Input id="tin" name="tin" defaultValue={org.tin ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vrn">VRN</Label>
            <Input id="vrn" name="vrn" defaultValue={org.vrn ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" type="tel" defaultValue={org.phone ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={org.email ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="city">City</Label>
            <Input id="city" name="city" defaultValue={org.city ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="website">Website</Label>
            <Input id="website" name="website" defaultValue={org.website ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="address">Address</Label>
            <Textarea id="address" name="address" rows={2} defaultValue={org.address ?? ""} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoice defaults</CardTitle>
          <CardDescription>
            These apply to new invoices only. Issued invoices keep the rate and
            terms they were created with, so changing anything here never
            rewrites an old document.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="default_vat_rate">VAT rate (%)</Label>
            <Input
              id="default_vat_rate"
              name="default_vat_rate"
              type="number"
              min={0}
              max={100}
              step="0.01"
              inputMode="decimal"
              defaultValue={Number(org.default_vat_rate)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="default_terms_days">Default terms (days)</Label>
            <Input
              id="default_terms_days"
              name="default_terms_days"
              type="number"
              min={0}
              max={365}
              inputMode="numeric"
              defaultValue={org.default_terms_days}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reminder_language">Reminder language</Label>
            <Select name="reminder_language" defaultValue={org.reminder_language}>
              <SelectTrigger id="reminder_language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="sw">Kiswahili</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-3">
            <Label htmlFor="bank_details">Payment details</Label>
            <Textarea
              id="bank_details"
              name="bank_details"
              rows={3}
              defaultValue={org.bank_details ?? ""}
              placeholder={"CRDB Bank · Acc 0150xxxxxxx · Munawar Traders Ltd\nM-Pesa Lipa namba 123456"}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-3">
            <Label htmlFor="invoice_footer">Invoice footer</Label>
            <Textarea
              id="invoice_footer"
              name="invoice_footer"
              rows={2}
              defaultValue={org.invoice_footer ?? ""}
              placeholder="Terms and conditions, thank-you note…"
            />
          </div>
        </CardContent>
      </Card>

      {state.error && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.error}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save settings
        </Button>
      </div>
    </form>
  );
}
