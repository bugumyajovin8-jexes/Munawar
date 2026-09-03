import { Suspense } from "react";
import { BrandMark } from "@/components/brand-mark";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          {/*
            The whole logo, wordmark and all — this is the one screen where it
            is the only thing identifying the app, and there is room for it.
          */}
          <BrandMark variant="full" size={72} alt="Munawar" />
          <div>
            {/*
              The name is in the logo, so printing it again underneath just
              says it twice. It stays in the markup for a screen reader and
              for the page's heading structure.
            */}
            <h1 className="sr-only">Munawar</h1>
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
