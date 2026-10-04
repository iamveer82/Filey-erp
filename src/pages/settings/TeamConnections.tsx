import { useEffect, useRef, useState } from "react";
import { Copy, Mail, Link2 } from "lucide-react";
import {
  org,
  type TeamConnections as Connections,
  type TeamJoinRequest,
} from "../../lib/api";
import { useLiveSync } from "../../lib/realtime";
import { useUI } from "../../lib/ui";
import { SettingsSection } from "../../components/SettingsLayout";
import { Field, Modal } from "../../components/ui";
import { SelectMenu } from "../../components/ui-menu";

export const TEAM_ACCESS = [
  { value: "chat", label: "Team chat", modules: ["team"] },
  {
    value: "sales",
    label: "Sales",
    modules: ["team", "crm", "customers", "quoting", "invoicing", "packaging-list", "follow-ups"],
  },
  {
    value: "finance",
    label: "Finance",
    modules: [
      "team",
      "accounting",
      "invoicing",
      "payment-receipts",
      "bank-accounts",
      "cheques",
      "reports",
    ],
  },
  {
    value: "operations",
    label: "Operations",
    modules: [
      "team",
      "inventory",
      "orders",
      "packaging-list",
      "suppliers",
      "purchase-orders",
      "purchase-invoices",
      "delivery-challans",
      "projects",
    ],
  },
  { value: "all", label: "All apps", modules: null },
];
export function teamModules(role: string, access: string): string[] | null {
  return role === "admin"
    ? null
    : (TEAM_ACCESS.find((item) => item.value === access) ?? TEAM_ACCESS[0]).modules;
}
export function TeamAccessFields({
  role,
  access,
  onRole,
  onAccess,
}: {
  role: string;
  access: string;
  onRole: (value: string) => void;
  onAccess: (value: string) => void;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Role">
          <SelectMenu
            ariaLabel="Member role"
            value={role}
            onChange={onRole}
            options={["staff", "accountant", "manager", "admin"].map((value) => ({
              value,
              label: value[0].toUpperCase() + value.slice(1),
            }))}
          />
        </Field>
        <Field label="App access">
          <SelectMenu
            ariaLabel="App access"
            value={role === "admin" ? "all" : access}
            onChange={onAccess}
            disabled={role === "admin"}
            options={TEAM_ACCESS}
          />
        </Field>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {role === "admin"
          ? "Admins manage the workspace, its members and all apps. Only grant this role to people you trust to manage the team."
          : "Choose the sections they can use. Their role is a team label; app access controls their permissions. You can customize individual sections after they join."}{" "}
        Personal records stay private unless shared.
      </p>
    </>
  );
}

export default function TeamConnections({
  orgId,
  canInvite,
  onInvite,
  onSwitch,
  onChanged,
}: {
  orgId: string;
  canInvite: boolean;
  onInvite: () => void;
  onSwitch: (id: string) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const { toast, confirm } = useUI();
  const [data, setData] = useState<Connections | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [review, setReview] = useState<TeamJoinRequest | null>(null);
  const [role, setRole] = useState("staff");
  const [access, setAccess] = useState("chat");
  const generation = useRef(0);
  const load = async () => {
    const attempt = ++generation.current;
    try {
      const next = await org.connections();
      if (attempt === generation.current) {
        setData(next);
        setError("");
      }
    } catch {
      if (attempt === generation.current)
        setError("Team connections could not be loaded.");
    }
  };
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, []);
  useLiveSync(
    () => void load(),
    ["team_invite_codes", "team_join_requests", "org_members"]
  );
  const run = async (action: () => Promise<void>, message?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      if (message) toast.success(message);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const linked = data?.workspace_id === orgId;
  const incoming =
    data?.requests.filter(
      (item) => item.incoming && item.org_id === orgId && item.status === "pending"
    ) ?? [];
  const outgoing = data?.requests.filter((item) => !item.incoming) ?? [];
  return (
    <>
      <SettingsSection
        title="Invite your team"
        description="One account code. A shared workspace, with access you choose."
      >
        {error ? (
          <div role="alert">
            <p className="text-sm">{error}</p>
            <button
              className="btn-ghost mt-2"
              disabled={busy}
              onClick={() => void load()}
            >
              Retry connections
            </button>
          </div>
        ) : !data ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading your invitation code…
          </p>
        ) : (
          <>
            <Field label="Your invitation code">
              <input
                className="input max-w-52 font-mono text-xl tracking-[0.3em]"
                value={data.code}
                readOnly
              />
            </Field>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {linked
                ? `Linked to ${data.workspace_name}. Teammates enter this code and wait for an owner or admin to approve their access.`
                : data.workspace_name
                  ? `Your code is linked to ${data.workspace_name}. Link it to this workspace to invite people here.`
                  : "Create or choose a workspace you manage, then link your code to it. Your code stays the same."}
            </p>
            <div className="flex flex-wrap gap-2">
              {!linked && canInvite && (
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      data.workspace_id &&
                      !(await confirm({
                        title: "Link code to this workspace?",
                        message: `New requests using your code will go to this workspace instead of ${data.workspace_name}. Existing requests stay with their original workspace.`,
                        confirmLabel: "Link code",
                      }))
                    )
                      return;
                    void run(() => org.linkCode(orgId), "Code linked to this workspace.");
                  }}
                >
                  <Link2 size={15} />
                  Link this workspace
                </button>
              )}
              <button
                className={linked ? "btn-primary" : "btn-ghost"}
                disabled={busy || !canInvite || !linked}
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(data.code);
                  }, "Invitation code copied.")
                }
              >
                <Copy size={15} />
                Copy code
              </button>
              <button
                className="btn-ghost"
                disabled={busy || !canInvite}
                onClick={onInvite}
              >
                <Mail size={15} />
                Invite by email
              </button>
            </div>
            {!canInvite && (
              <p className="text-xs text-muted-foreground">
                Only workspace owners and admins can invite teammates.
              </p>
            )}
          </>
        )}
      </SettingsSection>
      <SettingsSection
        title="Join a workspace"
        description="Enter the six-character code your teammate shared with you."
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!/^[A-Z0-9]{6}$/.test(code)) return;
            void run(async () => {
              await org.requestJoin(code);
              setCode("");
            }, "Request sent. An owner or admin will review your access.");
          }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Invitation code">
              <input
                className="input max-w-52 font-mono tracking-[0.2em]"
                placeholder="A1B2C3"
                value={code}
                onChange={(event) =>
                  setCode(
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 6)
                  )
                }
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={6}
                pattern="[A-Z0-9]{6}"
                required
                disabled={busy}
              />
            </Field>
            <button className="btn-primary" disabled={busy || code.length !== 6}>
              Request to join
            </button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Joining adds a workspace to your account. It does not move or upload your
            personal records.
          </p>
        </form>
        {outgoing.length > 0 && (
          <ul className="divide-y divide-border">
            {outgoing.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">{item.workspace_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {
                      {
                        pending: "Waiting for approval",
                        approved: "Request approved",
                        declined: "Request declined",
                        canceled: "Request canceled",
                        expired: "Request expired",
                      }[item.status]
                    }
                  </p>
                </div>
                {item.status === "pending" && (
                  <button
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(() => org.cancelJoin(item.id), "Request canceled.")
                    }
                  >
                    Cancel request
                  </button>
                )}
                {item.status === "approved" && item.org_id !== orgId && (
                  <button
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() => void run(() => onSwitch(item.org_id))}
                  >
                    Open workspace
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
      {canInvite && incoming.length > 0 && (
        <SettingsSection
          title="Join requests"
          description="Review who is joining and choose their access before they enter."
        >
          <ul className="divide-y divide-border">
            {incoming.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0 flex-1 basis-40">
                  <p className="break-words text-sm font-medium">
                    {item.name || item.email}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">{item.email}</p>
                </div>
                <button
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    setReview(item);
                    setRole("staff");
                    setAccess("chat");
                  }}
                >
                  Review request
                </button>
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}
      <Modal
        open={!!review}
        onClose={() => {
          if (!busy) setReview(null);
        }}
        title="Review join request"
      >
        <fieldset disabled={busy} className="space-y-4">
          <p className="break-words text-sm">
            {review?.name || review?.email} wants to join {review?.workspace_name}.
          </p>
          <TeamAccessFields
            role={role}
            access={access}
            onRole={setRole}
            onAccess={setAccess}
          />
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <button className="btn-ghost" onClick={() => setReview(null)}>
              Cancel
            </button>
            {[false, true].map((approve) => (
              <button
                key={String(approve)}
                className={approve ? "btn-primary" : "btn-ghost"}
                onClick={() => {
                  if (!review) return;
                  void run(
                    async () => {
                      await org.reviewJoin(
                        review.id,
                        orgId,
                        approve,
                        role,
                        teamModules(role, access)
                      );
                      setReview(null);
                      await onChanged();
                    },
                    approve
                      ? "Member approved. They can now open this workspace."
                      : "Request declined."
                  );
                }}
              >
                {approve ? "Approve member" : "Decline"}
              </button>
            ))}
          </div>
        </fieldset>
      </Modal>
    </>
  );
}
