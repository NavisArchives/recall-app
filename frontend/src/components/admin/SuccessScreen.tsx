import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";

/**
 * Full-screen confirmation after a management action succeeds.
 *
 * One unmissable statement of what just happened, then back to the dashboard
 * on its own — nobody has to find the way out of a form they are done with.
 */
export function SuccessScreen({
  title,
  to = "/admin",
  delayMs = 3000,
}: {
  title: string;
  to?: string;
  delayMs?: number;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => navigate(to, { replace: true }), delayMs);
    return () => clearTimeout(timer);
  }, [navigate, to, delayMs]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-[4vh] px-[4vw] text-center">
      {/* Green, not amber: this is the one screen that only ever means "done". */}
      <span
        className="flex h-24 w-24 items-center justify-center rounded-full"
        style={{
          background: "oklch(0.75 0.15 150 / 0.18)",
          boxShadow: "0 0 0 3px oklch(0.75 0.15 150)",
        }}
      >
        <Check className="h-12 w-12" style={{ color: "oklch(0.75 0.15 150)" }} aria-hidden />
      </span>

      <h1 className="t-title uppercase">{title}</h1>

      <p className="hint-mono" role="status">
        Taking you back…
      </p>
    </div>
  );
}
