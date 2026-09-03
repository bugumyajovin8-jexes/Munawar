import { AppShell } from "./app-shell";

/**
 * Deliberately does no work.
 *
 * Anything read here — cookies, headers, a session — makes every route beneath
 * it dynamic, and a dynamic route cannot be prefetched past its loading
 * boundary. Keeping this empty is what allows the screens below to be static
 * shells that Next can fetch ahead of a click, so navigating is a component
 * swap rather than a round trip.
 *
 * The session is established by AppShell on the client, and enforced by the
 * proxy on the server.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
