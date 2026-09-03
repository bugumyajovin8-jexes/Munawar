/**
 * Customer-facing surface. No sidebar, no session, nothing that assumes the
 * viewer works here.
 */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-dvh bg-neutral-100 print:min-h-0 print:bg-white">
      {children}
    </div>
  );
}
