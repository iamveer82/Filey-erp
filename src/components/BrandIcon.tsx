import { useEffect, useState } from "react";
import { File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, type LucideIcon } from "lucide-react";

const ICONS: Record<string, { src: string; dark?: string; alt: string }> = {
  supabase: { src: "/icons/supabase.svg", alt: "Supabase" },
  gmail: { src: "/icons/gmail.svg", alt: "Gmail" },
  google: { src: "/icons/google.svg", alt: "Google" },
  microsoft: { src: "/icons/microsoft.svg", alt: "Microsoft" },
  word: { src: "/icons/microsoft-word.svg", alt: "Word" },
  excel: { src: "/icons/microsoft-excel.svg", alt: "Excel" },
  outlook: { src: "/icons/microsoft-outlook.svg", alt: "Outlook" },
  pdf: { src: "/icons/pdf.svg", alt: "PDF" },
  twilio: { src: "/icons/twilio.svg", alt: "Twilio" },
  whatsapp: { src: "/icons/whatsapp-icon.svg", alt: "WhatsApp" },
};

function useIsDark() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => setDark(el.classList.contains("dark")));
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export default function BrandIcon({
  name,
  className = "h-5 w-5",
  fallback,
}: {
  name: keyof typeof ICONS;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const dark = useIsDark();
  const meta = ICONS[name];
  if (!meta) return <>{fallback ?? null}</>;
  const src = dark && meta.dark ? meta.dark : meta.src;
  return <img src={src} alt={meta.alt} className={className} />;
}

const FILE_ICONS: Record<string, LucideIcon> = {
  pdf: FileText, doc: FileText, docx: FileText, txt: FileText, rtf: FileText,
  xls: FileSpreadsheet, xlsx: FileSpreadsheet, csv: FileSpreadsheet, ods: FileSpreadsheet,
  png: FileImage, jpg: FileImage, jpeg: FileImage, webp: FileImage, gif: FileImage, svg: FileImage, heic: FileImage,
  zip: FileArchive, rar: FileArchive, '7z': FileArchive,
  mp3: FileAudio, wav: FileAudio, m4a: FileAudio, ogg: FileAudio,
  mp4: FileVideo, mov: FileVideo, webm: FileVideo,
};

export function FileIcon({
  name,
  className = "h-5 w-5",
}: {
  name: string;
  className?: string;
}) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const Icon = Object.prototype.hasOwnProperty.call(FILE_ICONS, ext) ? FILE_ICONS[ext] : File;
  return <Icon className={className} aria-hidden="true" />;
}
