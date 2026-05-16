import { PageHeader } from "../components/ui";
import PdfToolbox from "../components/PdfToolbox";

export default function ToolsPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Tools"
        subtitle="Local PDF toolkit — every tool runs on this device"
      />
      <PdfToolbox />
    </div>
  );
}
