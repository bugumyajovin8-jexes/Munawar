import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { AddMemberDialog } from "./add-member-dialog";
import { MemberActions } from "./member-actions";
import type { UserRole } from "@/lib/types";

export const metadata = { title: "Team & roles" };

type Member = {
  user_id: string;
  role: UserRole;
  full_name: string | null;
  created_at: string;
};

export default async function TeamPage() {
  const session = await requireSession();
  if (session.role !== "admin") redirect("/");

  const supabase = await createClient();
  const { data } = await supabase
    .from("org_members")
    .select("user_id, role, full_name, created_at")
    .order("created_at");

  const members = (data ?? []) as Member[];

  // Emails live in auth.users, which the app role cannot read — fetch them
  // with the service key. If it isn't configured, degrade to names only.
  const emails = new Map<string, string>();
  try {
    const admin = createAdminClient();
    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of users?.users ?? []) {
      if (u.email) emails.set(u.id, u.email);
    }
  } catch {
    // no service role key configured — names and roles still render
  }

  return (
    <>
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Settings
      </Link>

      <PageHeader
        title="Team & roles"
        description="Who can sign in, and what each of them is allowed to see."
        actions={<AddMemberDialog />}
      />

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>What the roles mean</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-3.5">
            <div className="flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              <p className="font-medium">Administrator</p>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Everything: buying prices, profit margins, settings, voiding
              invoices, and managing the team.
            </p>
          </div>
          <div className="rounded-lg border border-border p-3.5">
            <div className="flex items-center gap-2">
              <EyeOff className="size-4 text-muted-foreground" />
              <p className="font-medium">Sales</p>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Can create customers, raise invoices and record payments.{" "}
              <span className="text-foreground">
                Cost prices and margins are hidden at the database level
              </span>{" "}
              — not merely absent from the screen.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden sm:table-cell">Added</TableHead>
              <TableHead className="w-16 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const email = emails.get(m.user_id) ?? "—";
              const name = m.full_name ?? email;
              return (
                <TableRow key={m.user_id}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell className="text-muted-foreground">{email}</TableCell>
                  <TableCell>
                    <Badge variant={m.role === "admin" ? "default" : "secondary"}>
                      {m.role === "admin" ? "Administrator" : "Sales"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {formatDate(m.created_at.slice(0, 10))}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end">
                      <MemberActions
                        userId={m.user_id}
                        name={name}
                        role={m.role}
                        isSelf={m.user_id === session.userId}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
