import { useAuth } from "../../lib/auth";
import { useUI } from "../../lib/ui";
import { MODULES } from "../../modules/registry";
import { Badge, Modal, Field } from "../../components/ui";
import { Plus, Trash2 } from "lucide-react";
import { org, type OrgMember, type Organization, type Invitation } from "../../lib/api";
import { isLocalMode } from "../../lib/dataMode";
import { supabase } from "../../lib/supabase";
import { SelectMenu } from "../../components/ui-menu";
import { useEffect, useState } from "react";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";

/* ---------------- Users & Roles (Organization) ---------------- */

const ROLES = ["owner", "admin", "manager", "accountant", "staff"];

export default function UsersRoles() {
  const { profile, user, updateProfile } = useAuth();
  const { toast, confirm } = useUI();
  const [o, setO] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [myInvites, setMyInvites] = useState<Invitation[]>([]);
  const [editName, setEditName] = useState(profile?.name ?? "");
  const [editCompany, setEditCompany] = useState(profile?.company ?? "");
  // Sync the inline editors when the profile loads after mount (cloud mode
  // fetches it async — without this the fields sit empty and the Save
  // button compares against a stale baseline).
  useEffect(() => {
    setEditName(profile?.name ?? "");
    setEditCompany(profile?.company ?? "");
  }, [profile?.name, profile?.company]);
  const [name, setName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [accessFor, setAccessFor] = useState<OrgMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  // Desktop/local mode: team data lives in the cloud, so identity comes from
  // the separately signed-in cloud session (sync card), not the local shim.
  const local = isLocalMode();
  const [cloudUser, setCloudUser] = useState<{ id: string; email?: string } | null>(null);
  const [cloudOrgId, setCloudOrgId] = useState<string>("default");
  const [checked, setChecked] = useState(!local);
  useEffect(() => {
    if (!local || !supabase) {
      setChecked(true);
      return;
    }
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user;
      setCloudUser(u ? { id: u.id, email: u.email ?? undefined } : null);
      if (u) {
        const { data: p } = await supabase!
          .from("profiles")
          .select("org_id")
          .eq("id", u.id)
          .maybeSingle();
        setCloudOrgId(p?.org_id ?? "default");
      }
      setChecked(true);
    });
  }, [local]);

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
      .catch((e) => {
        setInvites([]);
        console.error("Failed to load invites:", e);
      });
    org
      .myInvites()
      .then(setMyInvites)
      .catch((e) => {
        setMyInvites([]);
        console.error("Failed to load my invites:", e);
      });
  };
  useEffect(() => {
    if (!local || cloudUser) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, cloudUser]);

  const uid = local ? cloudUser?.id : user?.id;
  const currentOrg = (local ? cloudOrgId : profile?.org_id) || "default";
  const personal = currentOrg === "default" || !o;
  // Scope to THIS org: the user may have org_members rows in other workspaces
  // (RLS lets their own rows through via user_id = auth.uid()), and a stale
  // row from an old org could shadow their real role here.
  const orgMembers = members.filter((m) => m.org_id === currentOrg);
  const myRole =
    orgMembers.find((m) => m.user_id === uid)?.role ?? (personal ? "owner" : "staff");
  const isAdmin = personal || ["owner", "admin"].includes(myRole);

  const switchOrg = async (id: string) => {
    if (local) {
      // The cloud profile's org_id is what current_org()/RLS key off — the
      // local shim profile has no cloud meaning.
      const { error } = await supabase!
        .from("profiles")
        .update({ org_id: id })
        .eq("id", cloudUser!.id);
      if (error) throw new Error(error.message);
      setCloudOrgId(id);
    } else {
      await updateProfile({ org_id: id });
    }
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
    const trimmed = inviteEmail.trim().toLowerCase();
    if (busy || !trimmed) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (invites.some((inv) => inv.email?.toLowerCase() === trimmed)) {
      toast.error("An invitation for that email is already pending.");
      return;
    }
    setBusy(true);
    try {
      await org.invite(trimmed, inviteRole, null);
      setInviteEmail("");
      toast.success(`Invitation sent to ${trimmed}.`);
      setInviteOpen(false);
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

  // Local mode without a connected cloud account: nothing to manage yet.
  if (local && checked && !cloudUser) {
    return (
      <SettingsPanel>
        <SettingsSection
          title="Team workspace"
          description="Bring your team together with a connected cloud account."
        >
          <p className="text-[13px] font-medium text-foreground">
            Connect a cloud account first
          </p>
          <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            Teams live in the cloud. Connect (or create) your Filey cloud account under{" "}
            <b>Settings → Data &amp; Storage → Cloud sync</b>, then come back here to
            create your organization and invite your team. Your data keeps working
            offline; it also syncs to the team.
          </p>
        </SettingsSection>
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel>
      <SettingsSection
        title="Workspace"
        description="The organization you are currently working in."
      >
        <p className="break-words font-medium text-foreground">
          {personal ? "Personal workspace" : o?.name}
        </p>
        <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          {personal
            ? "You're working solo. Create an organization to invite a team and share data."
            : local
              ? "Invite teammates by email. Business records sync to the whole team automatically; your files stay private."
              : "Invite teammates by email. Members keep their own private workspace and share records only when they choose."}
        </p>
      </SettingsSection>

      {/* Your name + company name — edit inline */}
      <SettingsSection
        title="Your details"
        description="Your name and company in this workspace."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Your name">
            <input
              className="input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={profile?.name || "Your name"}
            />
          </Field>
          <Field label="Company name">
            <input
              className="input"
              value={editCompany}
              onChange={(e) => setEditCompany(e.target.value)}
              placeholder={profile?.company || "Company name"}
            />
          </Field>
        </div>
        <div className="flex justify-end items-center gap-2 border-t border-border pt-4">
          <button
            className="btn-primary"
            disabled={
              busy ||
              (editName === (profile?.name ?? "") &&
                editCompany === (profile?.company ?? ""))
            }
            onClick={async () => {
              setBusy(true);
              try {
                await updateProfile({
                  name: editName.trim(),
                  company: editCompany.trim(),
                });
                toast.success("Profile updated.");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </SettingsSection>

      {/* Invitations addressed to you */}
      {myInvites.length > 0 && (
        <SettingsSection
          title="Invitations for you"
          description="Organizations that have invited you to join."
        >
          <ul className="space-y-2">
            {myInvites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">
                  Join as <b>{inv.role}</b>
                </span>
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => acceptInvite(inv.id)}
                >
                  Accept
                </button>
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}

      <SettingsSection
        title="Create organization"
        description="You become the owner. Your current data stays in your previous workspace."
      >
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            className="input"
            placeholder="Gulf Line Trading LLC"
            aria-label="Organization name"
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
      </SettingsSection>

      {/* Pending invitations the org has sent */}
      {!personal &&
        isAdmin &&
        invites.filter((i) => i.status === "pending").length > 0 && (
          <SettingsSection
            title="Pending invitations"
            description="People invited to your organization who have not joined yet."
          >
            <ul className="space-y-2">
              {invites
                .filter((i) => i.status === "pending")
                .map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 break-all text-sm">
                      <b className="text-foreground">{inv.email}</b>{" "}
                      <span className="text-muted-foreground">· {inv.role}</span>
                    </span>
                    <button
                      aria-label="Revoke invitation"
                      className="btn-ghost w-10 shrink-0 p-0 text-danger hover:bg-danger/10"
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
          </SettingsSection>
        )}

      {/* Members & Roles - team management */}
      <SettingsSection
        title="Members & Roles"
        stacked
        description={
          <>
            {orgMembers.length} member{orgMembers.length === 1 ? "" : "s"}
            {!isAdmin && " · only owners/admins can change roles"}
          </>
        }
      >
        {orgMembers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {personal
              ? "Just you for now — create an organization to invite a team."
              : "No members loaded."}
          </p>
        ) : (
          <div>
            {orgMembers.map((m) => {
              const isYou = m.user_id === uid;
              const isLastOwner =
                m.role === "owner" &&
                orgMembers.filter((o) => o.role === "owner").length === 1;
              const editable = isAdmin && !isYou && !isLastOwner;
              return (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0"
                >
                  <div className="flex min-w-0 max-w-full items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-foreground text-sm font-medium">
                      {(m.name || m.email || "?").charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {m.name}
                        {m.user_id === user?.id && (
                          <span className="text-[11px] font-normal text-muted-foreground">
                            {" "}
                            (you)
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {editable ? (
                      <SelectMenu
                        ariaLabel={`Role for ${m.name || m.email}`}
                        className="w-[118px]"
                        value={m.role}
                        onChange={async (v) => {
                          try {
                            await org.setRole(m.id, v);
                            load();
                            toast.success("Role updated.");
                          } catch (e) {
                            toast.error(
                              "Could not change role: " +
                                (e instanceof Error ? e.message : String(e))
                            );
                          }
                        }}
                        // "owner" is excluded from the dropdown — ownership
                        // transfer needs an explicit dedicated flow, not a
                        // dropdown accident.
                        options={ROLES.filter((r) => r !== "owner").map((r) => ({
                          value: r,
                          label: r,
                        }))}
                      />
                    ) : (
                      <Badge tone="info">{m.role}</Badge>
                    )}
                    {editable && (
                      <>
                        <button className="btn-ghost" onClick={() => setAccessFor(m)}>
                          Access
                        </button>
                        <button
                          aria-label={`Remove ${m.name}`}
                          className="btn-ghost w-10 p-0 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                          onClick={async () => {
                            const ok = await confirm({
                              title: "Remove member",
                              message: `Remove ${m.name} from the organization?`,
                              confirmLabel: "Remove",
                              danger: true,
                            });
                            if (!ok) return;
                            try {
                              await org.remove(m.id);
                              load();
                              toast.success("Member removed.");
                            } catch (e) {
                              toast.error(
                                "Could not remove member: " +
                                  (e instanceof Error ? e.message : String(e))
                              );
                            }
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
          <button className="btn-primary" onClick={() => setInviteOpen(true)}>
            <Plus size={15} /> Invite Member
          </button>
        )}
      </SettingsSection>

      <Modal
        open={inviteOpen}
        onClose={() => {
          if (!busy) setInviteOpen(false);
        }}
        title="Invite a member"
      >
        <fieldset disabled={busy} className="space-y-3">
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
            <SelectMenu
              value={inviteRole}
              onChange={(v) => setInviteRole(v)}
              options={ROLES.filter((r) => r !== "owner").map((r) => ({
                value: r,
                label: r,
              }))}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            They sign up with this email, then accept from their Settings → Users &amp;
            Roles.
          </p>
        </fieldset>
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={() => setInviteOpen(false)}
          >
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={busy || !inviteEmail.trim()}
            onClick={() => void sendInvite()}
          >
            {busy ? "Sending…" : "Send invite"}
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
    </SettingsPanel>
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
    <Modal open={!!member} onClose={onClose} title={`App access - ${member?.name ?? ""}`}>
      <p className="text-xs text-muted-foreground mb-3">
        Choose which apps this member can open. Overview &amp; Settings are always
        available.
      </p>
      <label className="flex items-center gap-2 mb-3 cursor-pointer">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        <span className="text-sm font-medium text-foreground">All apps</span>
      </label>
      {!all && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
          {assignable.map((m) => (
            <label
              key={m.id}
              className="flex min-h-10 items-center gap-2 text-sm cursor-pointer"
            >
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
      <div className="flex flex-wrap justify-end gap-2 mt-5 border-t border-border pt-4">
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
