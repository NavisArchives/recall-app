import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, type Role } from "@/context/AuthContext";

/**
 * Route protection. This is a UX gate only — the backend independently
 * rejects anything a role may not do, so bypassing it grants nothing.
 *
 * `requireProfile: false` covers the display, which needs a trusted machine
 * but no particular person signed in.
 */
export function AuthGuard({
  children,
  allow,
  requireProfile = true,
}: {
  children: ReactNode;
  allow?: Role[];
  requireProfile?: boolean;
}) {
  const { hasDevice, signedIn, role, loading } = useAuth();

  if (loading) {
    return <p className="flex h-full items-center justify-center text-fg-muted">Loading…</p>;
  }

  /*
   * Two ways of being somebody here, and this used to know about one.
   *
   * A family session — signed in from anywhere with the family password —
   * satisfies every protected route in the backend (M40), but this guard
   * only ever asked about the device. So a person who signed in correctly
   * was bounced to sign in again, forever. Management accepts either; the
   * *display* still needs the machine, because a screen in a living room is
   * a machine the family trusted, not a person who knows a password.
   */
  if (requireProfile ? !signedIn : !hasDevice) return <Navigate to="/login" replace />;
  if (!requireProfile) return <>{children}</>;
  if (!role) return <Navigate to="/profiles" replace />;

  // A page this role cannot open is not explained, it is simply not where
  // they are: the tab was never rendered for them either.
  if (allow && !allow.includes(role)) {
    return <Navigate to={role === "user" ? "/" : "/admin"} replace />;
  }

  return <>{children}</>;
}
