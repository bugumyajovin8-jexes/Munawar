import { Suspense } from "react";
import { ReceiptText } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <ReceiptText className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Munawar</h1>
            <p className="text-sm text-muted-foreground">
              Invoicing &amp; receivables
            </p>
          </div>
        </div>

        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
