import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { currentAccess, type Access } from "../lib/license";
import { toast } from "./Toaster";

const offer = (reason: "trial" | "freedom") =>
  window.dispatchEvent(new CustomEvent("filey:upgrade", { detail: { reason } }));

/** The Basic trial, always in view without getting in the way: days left while it runs, and
 *  once it ends a "view only" note with the way out. The first time it ends this session, the
 *  Freedom offer opens by itself. The $1 welcome credit says hello when it lands. */
export default function TrialBanner() {
  const [access, setAccess] = useState<Access>(currentAccess());

  useEffect(() => {
    let offered = false;
    const onAccess = () => {
      const next = currentAccess();
      setAccess(next);
      if (next.plan === "ended" && !offered) {
        offered = true;
        offer("trial");
      }
    };
    const onWelcome = () => toast.success("$1 of Filey AI is in your account. Ask Filey AI anything to try it.");
    onAccess();
    window.addEventListener("filey:access", onAccess);
    window.addEventListener("filey:welcome-credit", onWelcome);
    return () => {
      window.removeEventListener("filey:access", onAccess);
      window.removeEventListener("filey:welcome-credit", onWelcome);
    };
  }, []);

  if (access.plan !== "trial" && access.plan !== "ended") return null;
  const ended = access.plan === "ended";
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card py-1.5 pl-4 pr-1.5 text-[13px] shadow-lg">
      <span className={ended ? "font-medium text-foreground" : "text-muted-foreground"}>
        {ended
          ? "Your free trial has ended. Your data is view-only."
          : `Free trial · ${access.daysLeft} day${access.daysLeft === 1 ? "" : "s"} left`}
      </span>
      <button type="button" className="btn-primary h-8 rounded-full px-3 text-[13px]" onClick={() => offer(ended ? "trial" : "freedom")}>
        <Sparkles size={14} /> Get Freedom
      </button>
    </div>
  );
}
