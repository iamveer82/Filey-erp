import { useAuth } from "../../lib/auth";
import { useUI } from "../../lib/ui";
import { MODULES } from "../../modules/registry";
import { Badge, Modal, Field } from "../../components/ui";
import { Plus, Trash2, Building } from "lucide-react";
import { org, type OrgMember, type Organization, type Invitation } from "../../lib/api";
import { useEffect, useState } from "react";

/* ---------------- Users & Roles (Organization) ---------------- */

const ROLES = ["owner", "admin", "manager", "accountant", "staff"];

export default function UsersRoles() {
  const { profile, user, updateProfile } = useAuth();
  const { toast, confirm } = useUI();
  const [o, setO] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [myInvites, setMyInvites] = useState<Invitation[]>([]);
  const [name, setName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [accessFor, setAccessFor] = useState<OrgMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const load = () => {
    org
      .get()
      .then(setO)
      .catch((e) =>
        toast.error(
          "Failed to load organization: " + (e instanceof Error ? e.message : e)
        )
      );
    org
      .members()
      .then(setMembers)
      .catch((e) =>
        toast.error("Failed to load members: " + (e instanceof Error ? e.message : e))
      );
    org
      .invites()
      .then(setInvites)
      .catch(() => setInvites([]));
    org
      .myInvites()
      .then(setMyInvites)
      .catch(() => setMyInvites([]));
  };
  useEffect(load, []);

  const currentOrg = profile?.org_id || "default";
  const personal = currentOrg === "default" || !o;
  const myRole =
    members.find((m) => m.user_id === user?.id)?.role ?? (personal ? "owner" : "staff");
  const isAdmin = personal || ["owner", "admin"].includes(myRole);

  const switchOrg = async (id: string) => {
    await updateProfile({ org_id: id });
    setName("");
    setTimeout(load, 150);
  };

  const createOrg = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const id = await org.create(name.trim());
      await switchOrg(id);
      toast.success("Organization created.");
    } catch (e) {
      toast.error(`Could not create org: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    try {
      await org.invite(inviteEmail.trim(), inviteRole, null);
      setInviteEmail("");
      toast.success(`Invitation sent to ${inviteEmail.trim()}.`);
      load();
    } catch (e) {
      toast.error(`Could not invite: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  const acceptInvite = async (id: string) => {
    setBusy(true);
    try {
      await org.acceptInvite(id);
      toast.success("Joined organization.");
      setTimeout(load, 150);
    } catch (e) {
      toast.error(`Could not accept: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-primary-100 text-ink p-2.5">
            <Building size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-ink">
              {personal ? "Personal workspace" : o?.name}
            </p>
            <p className="text-sm text-brand-500 mt-0.5">
              {personal
                ? "You're working solo. Create an organization to invite a team and share data."
                : "Invite teammates by email. Members keep their own private workspace and share records only when they choose."}
            </p>
          </div>
        </div>
      </div>

      {/* Invitations addressed to you */}
      {myInvites.length > 0 && (
        <div className="card border-primary-300 bg-primary-50/50">
          <p className="font-medium text-ink mb-2">Invitations for you</p>
          <ul className="space-y-2">
            {myInvites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink">
                  Join as <b>{inv.role}</b>
                </span>
                <button
                  className="btn-primary text-xs"
                  disabled={busy}
                  onClick={() => acceptInvite(inv.id)}
                >
                  Accept
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <p className="font-medium text-ink mb-1">Create organization</p>
          <p className="text-xs text-brand-400 mb-3">
            You become the owner. Your current data stays in your previous workspace.
          </p>
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Acme Trading LLC"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="btn-primary shrink-0"
              disabled={busy || !name.trim()}
              onClick={createOrg}
            >
              <Plus size={15} /> Create
            </button>
          </div>
        </div>
      </div>

      {/* Pending invitations the org has sent */}
      {!personal &&
        isAdmin &&
        invites.filter((i) => i.status === "pending").length > 0 && (
          <div className="card">
            <p className="font-medium text-ink mb-2">Pending invitations</p>
            <ul className="space-y-2">
              {invites
                .filter((i) => i.status === "pending")
                .map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3">
                    <span className="text-sm">
                      <b className="text-ink">{inv.email}</b>{" "}
                      <span className="text-brand-400">· {inv.role}</span>
                    </span>
                    <button
                      aria-label="Revoke invitation"
                      className="text-danger hover:bg-danger/10 rounded-2xl p-1.5 cursor-pointer"
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Revoke invitation",
                          message: `Revoke the invitation sent to ${inv.email}?`,
                          confirmLabel: "Revoke",
                          danger: true,
                        });
                        if (!ok) return;
                        await org.revokeInvite(inv.id);
                        load();
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}

      {/* Members & Roles — team management */}
      <div className="card">
        <div className="mb-4">
          <p className="text-lg font-medium text-ink">Members &amp; Roles</p>
          <p className="text-sm text-brand-500 mt-0.5">
            {members.length} member{members.length === 1 ? "" : "s"}
            {!isAdmin && " · only owners/admins can change roles"}
          </p>
        </div>

        {members.length === 0 ? (
          <p className="py-6 text-center text-sm text-brand-400">
            {personal ? "Just you for now." : "No members loaded."}
          </p>
        ) : (
          <div>
            {members.map((m) => {
              const editable = isAdmin && m.user_id !== user?.id;
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 border-b border-brand-100 dark:border-[#2C2C2E] py-3 last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-100 text-ink text-sm font-medium dark:bg-primary-400/15 dark:text-primary-300">
                      {(m.name || m.email || "?").charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {m.name}
                        {m.user_id === user?.id && (
                          <span className="text-[11px] font-normal text-brand-400">
                            {" "}
                            (you)
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-brand-400">{m.email}</p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {editable ? (
                      <select
                        className="select !h-8 !w-[118px] !py-1 text-xs"
                        value={m.role}
                        onChange={async (e) => {
                          await org.setRole(m.id, e.target.value);
                          load();
                        }}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge tone="info">{m.role}</Badge>
                    )}
                    {editable && (
                      <>
                        <button
                          className="btn-ghost h-8 text-xs"
                          onClick={() => setAccessFor(m)}
                        >
                          Access
                        </button>
                        <button
                          aria-label={`Remove ${m.name}`}
                          className="rounded-full p-1.5 text-brand-400 transition-colors hover:bg-danger/10 hover:text-danger cursor-pointer"
                          onClick={async () => {
                            const ok = await confirm({
                              title: "Remove member",
                              message: `Remove ${m.name} from the organization?`,
                              confirmLabel: "Remove",
                              danger: true,
                            });
                            if (!ok) return;
                            await org.remove(m.id);
                            load();
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!personal && isAdmin && (
          <button className="btn-ghost mt-4 w-full" onClick={() => setInviteOpen(true)}>
            <Plus size={15} /> Invite Member
          </button>
        )}
      </div>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a member"
      >
        <div className="space-y-3">
          <Field label="Email address">
            <input
              className="input"
              type="email"
              placeholder="teammate@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Role">
            <select
              className="select"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              {ROLES.filter((r) => r !== "owner").map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-brand-400">
            They sign up with this email, then accept from their Settings → Users &amp;
            Roles.
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setInviteOpen(false)}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={busy || !inviteEmail.trim()}
            onClick={async () => {
              await sendInvite();
              setInviteOpen(false);
            }}
          >
            Send Invite
          </button>
        </div>
      </Modal>

      <MemberAccessModal
        member={accessFor}
        onClose={() => setAccessFor(null)}
        onSaved={() => {
          setAccessFor(null);
          load();
        }}
      />
    </div>
  );
}

function MemberAccessModal({
  member,
  onClose,
  onSaved,
}: {
  member: OrgMember | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  // Assignable modules = everything except core (always available).
  const assignable = MODULES.filter((m) => !m.core);
  const [sel, setSel] = useState<string[]>([]);
  const [all, setAll] = useState(true);

  useEffect(() => {
    if (member) {
      const m = member.modules;
      if (Array.isArray(m)) {
        setAll(false);
        setSel(m);
      } else {
        setAll(true);
        setSel(assignable.map((x) => x.id));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member]);

  const save = async () => {
    if (!member) return;
    try {
      await org.setMemberModules(member.id, all ? null : sel);
      toast.success("Access updated.");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal open={!!member} onClose={onClose} title={`App access — ${member?.name ?? ""}`}>
      <p className="text-xs text-brand-400 mb-3">
        Choose which apps this member can open. Overview &amp; Settings are always
        available.
      </p>
      <label className="flex items-center gap-2 mb-3 cursor-pointer">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        <span className="text-sm font-medium text-ink">All apps</span>
      </label>
      {!all && (
        <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
          {assignable.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={sel.includes(m.id)}
                onChange={(e) =>
                  setSel((s) =>
                    e.target.checked ? [...s, m.id] : s.filter((x) => x !== m.id)
                  )
                }
              />
              {m.label}
            </label>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" onClick={save}>
          Save access
        </button>
      </div>
    </Modal>
  );
}
