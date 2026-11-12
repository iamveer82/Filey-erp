/* Pharma mode: one workspace switch (Settings → Apps) that shows the pharmacy counter,
 * product batches and expiry, and lets Filey AI use its pharmacy tools. Off by default. */
import { tools } from "./api";

export const PHARMA_MODE_KEY = "pharma_mode";
export const PHARMA_OFF = "Pharma mode is off. An administrator can turn it on in Settings → Apps.";

let cached = false;

/** The last value read from settings, for code that cannot wait on a read (the agent's app map). */
export const pharmaModeCached = () => cached;

export function pharmaModeFrom(rows: { key: string; value: string }[]): boolean {
  cached = rows.find((r) => r.key === PHARMA_MODE_KEY)?.value === "on";
  return cached;
}

export async function pharmaModeOn(): Promise<boolean> {
  return pharmaModeFrom(await tools.settings());
}

export async function savePharmaMode(on: boolean): Promise<void> {
  await tools.setSetting(PHARMA_MODE_KEY, on ? "on" : "off");
  cached = on;
}
