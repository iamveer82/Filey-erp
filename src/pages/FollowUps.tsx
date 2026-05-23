import { useEffect, useState } from "react";
import { PageHeader } from "../components/ui";
import FollowUps from "../components/FollowUps";
import { crm, type CrmCustomer } from "../lib/api";
import { useLiveSync } from "../lib/realtime";

export default function FollowUpsPage() {
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const load = () => crm.customers().then(setCustomers).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Follow-ups"
        subtitle="Reminders and to-dos — we surface them in-app when they're due"
      />
      <FollowUps
        customers={customers.map((c) => ({
          id: c.id,
          name: c.name,
          company: c.company,
        }))}
      />
    </div>
  );
}
