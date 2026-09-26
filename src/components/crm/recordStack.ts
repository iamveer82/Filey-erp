// Adapted from Comp AI's record-sheet/record-stack.ts. MIT; see licenses/comp-ai-crm.txt.
import { OBJECT_KEYS, type CrmObject } from "../../lib/crmWorkspace";

export type RecordRef = { kind: CrmObject; id: number };
export function recordKey(ref: RecordRef): string {
  return `${ref.kind}:${ref.id}`;
}
export function parseRecordStack(raw: string | null): RecordRef[] {
  if (!raw || raw.length > 2000) return [];
  const result: RecordRef[] = [];
  for (const entry of raw.split(",").slice(-20)) {
    const [kind, id, extra] = entry.split(":");
    if (
      extra !== undefined ||
      !OBJECT_KEYS.includes(kind as CrmObject) ||
      !/^[1-9]\d*$/.test(id || "") ||
      !Number.isSafeInteger(Number(id))
    )
      continue;
    const ref = { kind: kind as CrmObject, id: Number(id) };
    if (!result.some((item) => recordKey(item) === recordKey(ref))) result.push(ref);
  }
  return result;
}
export function pushRecord(stack: RecordRef[], ref: RecordRef): RecordRef[] {
  return [...stack.filter((entry) => recordKey(entry) !== recordKey(ref)), ref].slice(
    -20
  );
}
