/** Small route index: the full guide copy and animation load only on request. */
const sections: Record<string, string> = {
  company: "company-details", account: "account-setup", ai: "ai-setup", email: "email",
  credits: "coin", teams: "workspace-team", apps: "apps-settings", appearance: "appearance",
  preferences: "preferences", billing: "billing", devices: "devices", security: "security",
  notifications: "notifications", backup: "backups", datamode: "storage",
};
const routes: Record<string, string> = {
  agent: "agent", overview: "overview", "overview-modern": "overview", reports: "reports",
  orders: "orders", invoicing: "invoices", "packaging-list": "packing-lists", quoting: "quotes",
  crm: "crm", customers: "directories", "follow-ups": "follow-ups", marketing: "marketing",
  suppliers: "suppliers", purchase: "purchase", "purchase-orders": "purchasing",
  "purchase-invoices": "supplier-invoices", inventory: "inventory", people: "people",
  accounting: "accounting", "bank-accounts": "bank-cheques", cheques: "cheques",
  "payment-receipts": "receipts", declaration: "declaration", projects: "projects-support",
  helpdesk: "helpdesk", team: "team", comms: "communications", tools: "file-tools",
  files: "files", "my-files": "files", letters: "letters", "email-templates": "email-templates",
  "delivery-challans": "delivery-declarations", integrations: "integrations", browser: "browser",
};
export function guideForRoute(pathname: string, search = ""): string | null {
  const section = pathname.split("/")[1];
  if (section === "settings") {
    const requested = new URLSearchParams(search).get("section") || "company";
    return Object.prototype.hasOwnProperty.call(sections, requested) ? sections[requested] : "start";
  }
  return Object.prototype.hasOwnProperty.call(routes, section) ? routes[section] : null;
}

export function validGuideId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(value);
}
