// Saved pipeline views — named, reusable filters over the deal board. Ported
// from trycompai's SavedView (entity + name + JSON filter), scoped down to what
// a five-stage kanban needs: text query, owner, stage.
//
// These are personal UI preferences, exactly like trycompai keeps them per
// owner — so localStorage is the right home, not the database. A view stores
// only its filter; it never stores row ids, so it stays honest as deals come
// and go.

import type { Opportunity } from "./api";

const KEY = "filey.crm.pipelineViews";

/** Just the filters — what a view stores beyond its name, and what live
 *  toolbar state is. Keeping them one shape lets saved and unsaved filters
 *  share the same matcher. */
export interface PipelineFilter {
  /** Substring matched against title + customer name (case-insensitive). */
  query?: string;
  /** Exact owner match; "" / undefined = anyone. */
  owner?: string;
  /** Exact stage match; "" / undefined = all stages. */
  stage?: string;
}

export interface PipelineView extends PipelineFilter {
  name: string;
}

export function listPipelineViews(): PipelineView[] {
  try {
    const raw = localStorage.getItem(KEY);
    const rows = raw ? (JSON.parse(raw) as PipelineView[]) : [];
    return rows.filter((r) => r && typeof r.name === "string" && r.name.trim());
  } catch {
    return [];
  }
}

/** Upsert by name — saving an existing name replaces its filters. */
export function savePipelineView(view: PipelineView): PipelineView[] {
  const name = view.name.trim();
  if (!name) throw new Error("A saved view needs a name.");
  const rest = listPipelineViews().filter(
    (v) => v.name.toLowerCase() !== name.toLowerCase()
  );
  const next: PipelineView[] = [
    ...rest,
    { name, query: view.query?.trim() || undefined, owner: view.owner || undefined, stage: view.stage || undefined },
  ];
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function deletePipelineView(name: string): PipelineView[] {
  const next = listPipelineViews().filter(
    (v) => v.name.toLowerCase() !== name.toLowerCase()
  );
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

/** Does one deal satisfy a filter set? Pure so tests and the board agree. */
export function matchesView(
  o: Pick<Opportunity, "title" | "customer_name" | "owner" | "stage">,
  v: PipelineFilter
): boolean {
  const q = (v.query ?? "").trim().toLowerCase();
  if (
    q &&
    !`${(o.title ?? "").toLowerCase()} ${(o.customer_name ?? "").toLowerCase()}`.includes(q)
  )
    return false;
  if (v.owner && (o.owner ?? "") !== v.owner) return false;
  if (v.stage && o.stage !== v.stage) return false;
  return true;
}
