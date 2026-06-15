/**
 * Client-side audit log — tracks user actions for activity trail.
 * Stored in localStorage with timestamps.
 * Used by: Settings, Dashboard activity feed
 */

const AUDIT_KEY = "filey_audit_log";
const MAX_ENTRIES = 500;

export interface AuditEntry {
  id: number;
  action: string;
  entity: string;
  entityId?: string | number;
  details?: string;
  userId?: string;
  timestamp: string;
}

/** Log an action to the audit trail. */
export function audit(
  action: string,
  entity: string,
  details?: string,
  entityId?: string | number
) {
  try {
    const logs = getAuditLog();
    logs.unshift({
      id: Date.now(),
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      details,
      timestamp: new Date().toISOString(),
    });
    if (logs.length > MAX_ENTRIES) logs.length = MAX_ENTRIES;
    localStorage.setItem(AUDIT_KEY, JSON.stringify(logs));
  } catch (e) {
    console.warn("Failed to write audit log", e);
  }
}

/** Get all audit entries, newest first. */
export function getAuditLog(): AuditEntry[] {
  try {
    return JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]");
  } catch (e) {
    console.warn("Failed to parse audit log", e);
    return [];
  }
}

/** Get recent entries (last N). */
export function getRecentAudit(n = 20): AuditEntry[] {
  return getAuditLog().slice(0, n);
}

/** Clear all audit entries. */
export function clearAuditLog() {
  try {
    localStorage.removeItem(AUDIT_KEY);
  } catch (e) {
    console.warn("Failed to clear audit log", e);
  }
}

/** Format an audit entry for display. */
export function formatAuditEntry(entry: AuditEntry): string {
  const detail = entry.details ? ` — ${entry.details}` : "";
  return `${entry.action} ${entry.entity}${detail}`;
}

/** Audit action types for consistency. */
export const AuditAction = {
  CREATE: "Created",
  UPDATE: "Updated",
  DELETE: "Deleted",
  LOGIN: "Logged in",
  LOGOUT: "Logged out",
  EXPORT: "Exported",
  IMPORT: "Imported",
  SEND: "Sent",
  PRINT: "Printed",
  SCAN: "Scanned",
  RECEIVE: "Received",
} as const;
