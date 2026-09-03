/**
 * Bare layout for printable documents: no sidebar, no tab bar, nothing that
 * would end up on the paper.
 */
export default function PrintLayout({ children }: LayoutProps<"/">) {
  // print:min-h-0 matters: a viewport-height minimum survives into the print
  // box and pushes an empty second page out of a one-page invoice.
  return (
    <div className="min-h-dvh bg-neutral-100 print:min-h-0 print:bg-white">
      {children}
    </div>
  );
}
