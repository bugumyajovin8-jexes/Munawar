import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, ShieldCheck } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireSession();
  if (session.role !== "admin") redirect("/");

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your business details and the defaults applied to new invoices."
        actions={
          <Button variant="outline" asChild>
            <Link href="/settings/team">
              <ShieldCheck className="size-4" />
              Team &amp; roles
            </Link>
          </Button>
        }
      />
      <SettingsForm org={session.org} />

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Data &amp; backup</CardTitle>
          <CardDescription>
            Everything you have — customers, prices, invoices, line items,
            payments, schedules and the reminder log — in one spreadsheet. Your
            data is yours; take a copy whenever you like.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <a href="/api/export/backup">
              <Download className="size-4" />
              Download full backup
            </a>
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
