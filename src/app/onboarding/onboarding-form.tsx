"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createBusiness, type OnboardingState } from "./actions";

const EMPTY: OnboardingState = { error: null };

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createBusiness, EMPTY);

  return (
    <Card>
      <CardContent className="pt-5">
        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Business name *</Label>
            <Input id="name" name="name" required placeholder="Munawar Traders Ltd" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="full_name">Your name</Label>
            <Input id="full_name" name="full_name" placeholder="Shown on invoices you issue" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tin">TIN</Label>
              <Input id="tin" name="tin" inputMode="numeric" placeholder="123-456-789" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vrn">VRN</Label>
              <Input id="vrn" name="vrn" placeholder="40-123456-A" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" type="tel" placeholder="0712 345 678" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Business email</Label>
              <Input id="email" name="email" type="email" placeholder="sales@business.co.tz" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address">Address</Label>
            <Textarea
              id="address"
              name="address"
              rows={2}
              placeholder="Street, PO Box, Dar es Salaam"
            />
          </div>

          {state.error && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {state.error}
            </p>
          )}

          <Button type="submit" disabled={pending} className="mt-1 w-full">
            {pending && <Loader2 className="size-4 animate-spin" />}
            Create business
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
