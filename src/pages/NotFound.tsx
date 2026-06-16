import { Home, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/ui";

export default function NotFound() {
  const nav = useNavigate();
  return (
    <div className="max-w-[1320px] mx-auto px-4 sm:px-6 py-4 animate-fade-up">
      <PageHeader title="Page not found" subtitle="That route doesn't exist in Filey." />
      <div className="card p-8 text-center max-w-md mx-auto mt-8">
        <p className="text-5xl font-bold text-brand-200">404</p>
        <p className="mt-4 text-ink font-medium">We couldn't find the page you requested.</p>
        <p className="mt-1 text-sm text-brand-500">Check the URL or return to the dashboard.</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button className="btn-ghost" onClick={() => nav(-1)}>
            <ArrowLeft size={15} /> Back
          </button>
          <button className="btn-primary" onClick={() => nav("/")}>
            <Home size={15} /> Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
