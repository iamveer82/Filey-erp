import { useNavigate } from "react-router-dom";
import { FileQuestion, ArrowLeft, Home } from "lucide-react";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="grid min-h-[80vh] place-items-center px-6">
      <div className="text-center max-w-md">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-2xl bg-brand-100 dark:bg-brand-800">
          <FileQuestion size={36} className="text-brand-500" />
        </div>
        <h1 className="mt-6 font-medium text-5xl font-medium text-ink">404</h1>
        <p className="mt-2 text-lg font-medium text-ink">Page not found</p>
        <p className="mt-2 text-sm text-brand-500 leading-relaxed">
          The page you're looking for doesn't exist or has been moved. Check the URL or go
          back to your dashboard.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="btn-ghost inline-flex items-center gap-2"
          >
            <ArrowLeft size={16} /> Go back
          </button>
          <button
            onClick={() => navigate("/overview")}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Home size={16} /> Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
