import type { CustomTemplate } from "./TemplateDesigner";

// ─── Accent color map for built-in templates ───────────────────────────────
const ACCENTS: Record<string, string> = {
  minimal: "#333333",
  classic: "#1a1a2e",
  modern: "#2563eb",
  corporate: "#0f172a",
  elegant: "#b8860b",
  bold: "#dc2626",
  tech: "#06b6d4",
  creative: "#7c3aed",
  receipt: "#374151",
  monogram: "#0f766e",
  clean: "#2563eb",
  professional: "#1e40af",
  "em-minimal": "#262626",
  "em-uae": "#171717",
  "em-classic": "#171717",
  "em-modern": "#3b82f6",
  "em-corporate": "#171717",
  "em-elegant": "#92400e",
};

// ─── Miniature SVG previews for built-in templates ─────────────────────────

function MinimalPreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#fff" rx="4" />
      {/* accent bar */}
      <rect y="0" width="100" height="4" fill="#333" rx="4" />
      <rect y="0" x="96" width="4" height="4" fill="#fff" />
      {/* heading lines */}
      <rect x="8" y="12" width="50" height="4" fill="#333" rx="2" opacity="0.8" />
      <rect x="8" y="20" width="30" height="2.5" fill="#999" rx="1" />
      {/* body lines */}
      <rect x="8" y="28" width="84" height="2" fill="#ccc" rx="1" />
      <rect x="8" y="33" width="84" height="2" fill="#ccc" rx="1" />
      <rect x="8" y="38" width="84" height="2" fill="#ccc" rx="1" />
      <rect x="8" y="43" width="50" height="2" fill="#ccc" rx="1" />
      {/* total accent */}
      <rect x="8" y="52" width="74" height="1" fill="#ddd" rx="0.5" />
      <rect x="60" y="58" width="32" height="4" fill="#333" rx="2" opacity="0.6" />
    </svg>
  );
}

function ClassicPreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#fff" rx="4" />
      {/* top accent */}
      <rect y="0" width="100" height="5" fill="#1a1a2e" rx="4" />
      <rect y="0" x="96" width="4" height="5" fill="#fff" />
      {/* left column */}
      <rect x="6" y="11" width="40" height="5" fill="#1a1a2e" rx="2" opacity="0.7" />
      <rect x="6" y="20" width="25" height="2.5" fill="#888" rx="1" />
      <rect x="6" y="26" width="35" height="2" fill="#bbb" rx="1" />
      <rect x="6" y="31" width="30" height="2" fill="#bbb" rx="1" />
      {/* divider */}
      <rect x="50" y="11" width="1" height="40" fill="#ddd" />
      {/* right column */}
      <rect x="56" y="11" width="36" height="3" fill="#ccc" rx="1" />
      <rect x="56" y="18" width="36" height="3" fill="#ccc" rx="1" />
      <rect x="56" y="25" width="36" height="3" fill="#ccc" rx="1" />
      <rect x="56" y="32" width="36" height="3" fill="#ccc" rx="1" />
      <rect x="56" y="39" width="36" height="3" fill="#ccc" rx="1" />
      {/* bottom accent */}
      <rect x="6" y="56" width="88" height="0.5" fill="#ddd" />
      <rect x="60" y="62" width="34" height="4" fill="#1a1a2e" rx="2" opacity="0.4" />
    </svg>
  );
}

function ModernPreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#f8faff" rx="4" />
      {/* large left accent block */}
      <rect x="0" y="0" width="8" height="72" fill="#2563eb" rx="4" />
      <rect x="4" y="0" width="4" height="72" fill="#fff" rx="0" />
      {/* heading */}
      <rect x="18" y="14" width="42" height="5" fill="#2563eb" rx="2" opacity="0.85" />
      <rect x="18" y="23" width="28" height="2.5" fill="#93b5f0" rx="1" />
      {/* body */}
      <rect x="18" y="32" width="74" height="2" fill="#dbe9fa" rx="1" />
      <rect x="18" y="37" width="74" height="2" fill="#dbe9fa" rx="1" />
      <rect x="18" y="42" width="74" height="2" fill="#dbe9fa" rx="1" />
      <rect x="18" y="47" width="40" height="2" fill="#dbe9fa" rx="1" />
      {/* accent total */}
      <rect x="18" y="55" width="74" height="0.5" fill="#e0e7ff" />
      <rect x="62" y="60" width="30" height="5" fill="#2563eb" rx="2" opacity="0.7" />
    </svg>
  );
}

function CorporatePreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#f9fafb" rx="4" />
      {/* centered logo block */}
      <rect x="38" y="8" width="24" height="12" fill="#0f172a" rx="3" opacity="0.15" />
      <rect x="42" y="11" width="16" height="6" fill="#0f172a" rx="1" opacity="0.3" />
      {/* twin accent bars */}
      <rect x="0" y="26" width="100" height="0.5" fill="#0f172a" opacity="0.2" />
      <rect x="0" y="28" width="100" height="0.5" fill="#0f172a" opacity="0.1" />
      {/* horizontal layout lines */}
      <rect x="10" y="34" width="80" height="2" fill="#ddd" rx="1" />
      <rect x="10" y="39" width="80" height="2" fill="#ddd" rx="1" />
      <rect x="10" y="44" width="80" height="2" fill="#ddd" rx="1" />
      <rect x="10" y="49" width="80" height="2" fill="#ddd" rx="1" />
      {/* footer bar */}
      <rect x="0" y="56" width="100" height="4" fill="#0f172a" rx="4" opacity="0.9" />
    </svg>
  );
}

function ElegantPreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#fefdf8" rx="4" />
      {/* gold thin accent bars */}
      <rect x="8" y="6" width="84" height="0.5" fill="#b8860b" opacity="0.5" />
      <rect x="8" y="8" width="84" height="0.5" fill="#b8860b" opacity="0.3" />
      {/* heading - serif feel */}
      <rect x="8" y="16" width="44" height="4" fill="#8b6914" rx="1" opacity="0.7" />
      <rect x="8" y="23" width="30" height="2" fill="#c4a44a" rx="1" />
      {/* body lines */}
      <rect x="8" y="30" width="84" height="1.5" fill="#e8dcc8" rx="0.5" />
      <rect x="8" y="34" width="84" height="1.5" fill="#e8dcc8" rx="0.5" />
      <rect x="8" y="38" width="84" height="1.5" fill="#e8dcc8" rx="0.5" />
      <rect x="8" y="42" width="50" height="1.5" fill="#e8dcc8" rx="0.5" />
      {/* bottom border */}
      <rect x="8" y="50" width="84" height="0.5" fill="#b8860b" opacity="0.4" />
      <rect x="8" y="52" width="84" height="0.5" fill="#b8860b" opacity="0.2" />
      {/* elegant total */}
      <rect x="60" y="58" width="32" height="3" fill="#8b6914" rx="1" opacity="0.5" />
    </svg>
  );
}

function BoldPreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#fff" rx="4" />
      {/* heavy accent bar */}
      <rect y="0" width="100" height="10" fill="#dc2626" rx="4" />
      <rect y="0" x="96" width="4" height="10" fill="#fff" />
      {/* heading in accent */}
      <rect x="8" y="2.5" width="44" height="5" fill="#fff" rx="2" opacity="0.9" />
      {/* body lines */}
      <rect x="8" y="16" width="84" height="3" fill="#333" rx="1.5" />
      <rect x="8" y="23" width="84" height="3" fill="#333" rx="1.5" />
      <rect x="8" y="30" width="84" height="3" fill="#333" rx="1.5" />
      <rect x="8" y="37" width="84" height="3" fill="#333" rx="1.5" />
      <rect x="8" y="44" width="50" height="3" fill="#333" rx="1.5" />
      {/* bottom accent */}
      <rect x="8" y="52" width="84" height="1" fill="#fecaca" />
      <rect x="50" y="58" width="42" height="6" fill="#dc2626" rx="2" opacity="0.7" />
    </svg>
  );
}

function TechPreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#0a0e27" rx="4" />
      {/* neon top bar */}
      <rect y="0" width="100" height="3" fill="#06b6d4" rx="4" opacity="0.9" />
      <rect y="0" x="96" width="4" height="3" fill="#0a0e27" />
      {/* monospace heading */}
      <rect x="8" y="10" width="56" height="4" fill="#06b6d4" rx="1" opacity="0.85" />
      <rect x="8" y="18" width="38" height="2" fill="#22d3ee" rx="1" opacity="0.5" />
      {/* matrix-style lines */}
      <rect x="8" y="26" width="84" height="1.5" fill="#334155" rx="0.5" />
      <rect x="8" y="30" width="84" height="1.5" fill="#334155" rx="0.5" />
      <rect x="8" y="34" width="84" height="1.5" fill="#334155" rx="0.5" />
      <rect x="8" y="38" width="84" height="1.5" fill="#334155" rx="0.5" />
      <rect x="8" y="42" width="50" height="1.5" fill="#334155" rx="0.5" />
      {/* neon accent dot */}
      <circle cx="86" cy="14" r="3" fill="#06b6d4" opacity="0.6" />
      {/* bottom total */}
      <rect x="8" y="50" width="84" height="0.5" fill="#06b6d4" opacity="0.2" />
      <rect x="56" y="56" width="36" height="4" fill="#06b6d4" rx="1" opacity="0.5" />
    </svg>
  );
}

function CreativePreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#faf5ff" rx="4" />
      {/* asymmetrical accent shapes */}
      <rect x="0" y="0" width="30" height="24" fill="#7c3aed" rx="4" opacity="0.85" />
      <rect x="0" y="0" width="30" height="24" fill="#fff" rx="4" />
      <rect x="0" y="20" width="30" height="4" fill="#7c3aed" opacity="0.85" />
      {/* heading - offset right */}
      <rect x="38" y="6" width="48" height="4" fill="#7c3aed" rx="2" opacity="0.7" />
      <rect x="38" y="14" width="30" height="2.5" fill="#a78bfa" rx="1" />
      {/* body - offset layout */}
      <rect x="4" y="30" width="88" height="2" fill="#e9d5ff" rx="1" />
      <rect x="4" y="35" width="88" height="2" fill="#e9d5ff" rx="1" />
      <rect x="4" y="40" width="88" height="2" fill="#e9d5ff" rx="1" />
      <rect x="4" y="45" width="50" height="2" fill="#e9d5ff" rx="1" />
      {/* accent circle */}
      <circle cx="76" cy="58" r="8" fill="#7c3aed" opacity="0.2" />
      <rect x="40" y="62" width="30" height="4" fill="#7c3aed" rx="2" opacity="0.6" />
    </svg>
  );
}

function ReceiptPreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#fafafa" rx="4" />
      {/* receipt header */}
      <rect x="20" y="4" width="60" height="4" fill="#374151" rx="2" />
      <rect x="30" y="11" width="40" height="2" fill="#6b7280" rx="1" />
      {/* dashed divider */}
      <line
        x1="12"
        y1="18"
        x2="88"
        y2="18"
        stroke="#d1d5db"
        strokeWidth="0.5"
        strokeDasharray="3,3"
      />
      {/* narrow receipt lines */}
      <rect x="10" y="23" width="80" height="2" fill="#9ca3af" rx="1" />
      <rect x="10" y="28" width="80" height="2" fill="#9ca3af" rx="1" />
      <rect x="10" y="33" width="80" height="2" fill="#9ca3af" rx="1" />
      <rect x="10" y="38" width="80" height="2" fill="#9ca3af" rx="1" />
      <rect x="10" y="43" width="80" height="2" fill="#9ca3af" rx="1" />
      {/* dashed divider */}
      <line
        x1="12"
        y1="50"
        x2="88"
        y2="50"
        stroke="#d1d5db"
        strokeWidth="0.5"
        strokeDasharray="3,3"
      />
      {/* total */}
      <rect x="46" y="55" width="44" height="1" fill="#d1d5db" />
      <rect x="46" y="59" width="44" height="4" fill="#374151" rx="2" />
    </svg>
  );
}

function MonogramPreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#f0fdfa" rx="4" />
      {/* large monogram box - left */}
      <rect x="6" y="6" width="20" height="20" fill="#0f766e" rx="4" opacity="0.8" />
      {/* monogram letter */}
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontSize="14"
        fontWeight="bold"
        fill="#fff"
        fontFamily="serif"
      >
        F
      </text>
      {/* heading next to monogram */}
      <rect x="32" y="10" width="40" height="4" fill="#0f766e" rx="2" opacity="0.7" />
      <rect x="32" y="18" width="24" height="2" fill="#5eead4" rx="1" opacity="0.6" />
      {/* body lines */}
      <rect x="6" y="32" width="88" height="2" fill="#ccfbf1" rx="1" />
      <rect x="6" y="37" width="88" height="2" fill="#ccfbf1" rx="1" />
      <rect x="6" y="42" width="88" height="2" fill="#ccfbf1" rx="1" />
      <rect x="6" y="47" width="50" height="2" fill="#ccfbf1" rx="1" />
      {/* bottom accent */}
      <rect x="6" y="54" width="88" height="1" fill="#99f6e4" />
      <rect x="54" y="60" width="40" height="4" fill="#0f766e" rx="2" opacity="0.5" />
    </svg>
  );
}

// ─── Quoting-specific previews ──────────────────────────────────────────────

function CleanPreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#fff" rx="4" />
      {/* blue accent top */}
      <rect y="0" width="100" height="4" fill="#2563eb" rx="4" />
      <rect y="0" x="96" width="4" height="4" fill="#fff" />
      {/* clean heading */}
      <rect x="8" y="12" width="50" height="4" fill="#2563eb" rx="2" opacity="0.8" />
      <rect x="8" y="20" width="30" height="2" fill="#93b5f0" rx="1" />
      {/* body */}
      <rect x="8" y="28" width="84" height="2" fill="#dbe9fa" rx="1" />
      <rect x="8" y="33" width="84" height="2" fill="#dbe9fa" rx="1" />
      <rect x="8" y="38" width="84" height="2" fill="#dbe9fa" rx="1" />
      <rect x="8" y="43" width="50" height="2" fill="#dbe9fa" rx="1" />
      {/* total */}
      <rect x="8" y="52" width="74" height="1" fill="#e0e7ff" />
      <rect x="60" y="58" width="32" height="4" fill="#2563eb" rx="2" opacity="0.6" />
    </svg>
  );
}

function ProfessionalPreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#fff" rx="4" />
      {/* navy accent bar */}
      <rect y="0" width="100" height="6" fill="#1e40af" rx="4" />
      <rect y="0" x="96" width="4" height="6" fill="#fff" />
      {/* formal heading */}
      <rect x="8" y="14" width="44" height="4" fill="#1e40af" rx="2" opacity="0.8" />
      <rect x="8" y="22" width="28" height="2" fill="#60a5fa" rx="1" />
      {/* two-column body */}
      <rect x="8" y="30" width="40" height="2" fill="#dbeafe" rx="1" />
      <rect x="54" y="30" width="38" height="2" fill="#dbeafe" rx="1" />
      <rect x="8" y="35" width="40" height="2" fill="#dbeafe" rx="1" />
      <rect x="54" y="35" width="38" height="2" fill="#dbeafe" rx="1" />
      <rect x="8" y="40" width="40" height="2" fill="#dbeafe" rx="1" />
      <rect x="54" y="40" width="38" height="2" fill="#dbeafe" rx="1" />
      {/* bottom */}
      <rect x="8" y="50" width="84" height="0.5" fill="#bfdbfe" />
      <rect x="56" y="56" width="36" height="5" fill="#1e40af" rx="2" opacity="0.6" />
    </svg>
  );
}

// ─── Map template IDs to preview components ─────────────────────────────────

const BUILTIN_PREVIEWS: Record<string, React.ComponentType> = {
  minimal: MinimalPreview,
  classic: ClassicPreview,
  modern: ModernPreview,
  corporate: CorporatePreview,
  elegant: ElegantPreview,
  bold: BoldPreview,
  tech: TechPreview,
  creative: CreativePreview,
  receipt: ReceiptPreview,
  monogram: MonogramPreview,
  clean: CleanPreview,
  professional: ProfessionalPreview,
  "em-minimal": EmMinimalPreview,
  "em-uae": EmUaePreview,
  "em-classic": EmClassicPreview,
  "em-modern": EmModernPreview,
  "em-corporate": EmCorporatePreview,
  "em-elegant": EmElegantPreview,
};

// ─── Emergent-reference ports (v2.1) ────────────────────────────────────────

function EmMinimalPreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#fff" rx="4" />
      <rect x="8" y="8" width="44" height="4" fill="#262626" rx="2" />
      <rect x="8" y="18" width="84" height="1" fill="#d4d4d4" />
      <rect x="8" y="24" width="84" height="2" fill="#d4d4d4" rx="1" />
      <rect x="8" y="29" width="68" height="2" fill="#d4d4d4" rx="1" />
      <rect x="8" y="34" width="76" height="2" fill="#d4d4d4" rx="1" />
      <rect x="58" y="56" width="34" height="3" fill="#262626" rx="1.5" />
    </svg>
  );
}

function EmUaePreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#fff" rx="4" />
      <rect x="8" y="8" width="34" height="3" fill="#171717" rx="1.5" />
      <rect x="66" y="8" width="26" height="3" fill="#171717" rx="1.5" />
      <rect x="8" y="18" width="84" height="1.5" fill="#171717" />
      <rect x="8" y="26" width="84" height="7" fill="#171717" rx="1" />
      <rect x="8" y="38" width="84" height="2" fill="#d4d4d4" rx="1" />
      <rect x="8" y="43" width="84" height="2" fill="#d4d4d4" rx="1" />
      <rect x="8" y="48" width="62" height="2" fill="#d4d4d4" rx="1" />
    </svg>
  );
}

function EmClassicPreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#fff" rx="4" />
      <rect x="25" y="8" width="50" height="4" fill="#171717" rx="2" />
      <rect x="8" y="17" width="84" height="1.5" fill="#171717" />
      <rect x="34" y="24" width="32" height="3" fill="#525252" rx="1.5" />
      <rect x="8" y="34" width="84" height="2" fill="#d4d4d4" rx="1" />
      <rect x="8" y="39" width="70" height="2" fill="#d4d4d4" rx="1" />
      <rect x="30" y="58" width="40" height="2.5" fill="#171717" rx="1" />
    </svg>
  );
}

function EmModernPreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#fff" rx="4" />
      <rect x="8" y="8" width="2.5" height="16" fill="#3b82f6" rx="1.25" />
      <rect x="15" y="9" width="40" height="4" fill="#3b82f6" rx="2" />
      <rect x="15" y="17" width="26" height="2.5" fill="#a3a3a3" rx="1" />
      <rect x="8" y="30" width="84" height="6" fill="#3b82f6" rx="1.5" />
      <rect x="8" y="41" width="84" height="2" fill="#d4d4d4" rx="1" />
      <rect x="8" y="46" width="70" height="2" fill="#d4d4d4" rx="1" />
      <rect x="56" y="56" width="36" height="6" fill="#3b82f6" rx="2" />
    </svg>
  );
}

function EmCorporatePreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#fff" rx="4" />
      <rect width="100" height="14" fill="#171717" rx="4" />
      <rect y="10" width="100" height="4" fill="#171717" />
      <rect x="8" y="22" width="84" height="2" fill="#d4d4d4" rx="1" />
      <rect x="8" y="27" width="84" height="2" fill="#d4d4d4" rx="1" />
      <rect x="8" y="32" width="66" height="2" fill="#d4d4d4" rx="1" />
      <rect y="60" width="100" height="12" fill="#171717" rx="4" />
      <rect y="60" width="100" height="4" fill="#171717" />
    </svg>
  );
}

function EmElegantPreview() {
  return (
    <svg viewBox="0 0 100 72" className="w-full h-full" preserveAspectRatio="none">
      <rect width="100" height="72" fill="#fbf7f0" rx="4" />
      <rect x="8" y="9" width="48" height="4" fill="#92400e" rx="2" />
      <rect x="8" y="18" width="84" height="1" fill="#92400e" opacity="0.4" />
      <rect x="8" y="26" width="84" height="2" fill="#92400e" opacity="0.25" rx="1" />
      <rect x="8" y="31" width="70" height="2" fill="#92400e" opacity="0.25" rx="1" />
      <rect x="8" y="36" width="78" height="2" fill="#92400e" opacity="0.25" rx="1" />
      <rect x="52" y="56" width="40" height="3" fill="#92400e" rx="1.5" />
    </svg>
  );
}

// ─── Wireframe placeholder for builder-typed custom templates ───────────────

function WireframePlaceholder() {
  return (
    <div className="p-2 h-full">
      <div className="h-1.5 w-10 rounded bg-brand-300" />
      <div className="mt-1 h-1 w-16 rounded bg-brand-200" />
      <div className="mt-3 space-y-1">
        <div className="h-1 w-full rounded bg-brand-200" />
        <div className="h-1 w-full rounded bg-brand-200" />
        <div className="h-1 w-2/3 rounded bg-brand-200" />
      </div>
      <div className="mt-2 ml-auto h-1.5 w-10 rounded bg-primary-300" />
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function TemplateTilePreview({
  templateId,
  customTemplates,
}: {
  templateId: string;
  customTemplates: CustomTemplate[];
}) {
  const isCustom = templateId.startsWith("custom-");

  if (isCustom) {
    const ct = customTemplates.find((c) => c.id === templateId);
    const isFile = ct?.type === "file";
    const hasFilePreview = isFile && ct?.fileData && ct?.fileType === "image";

    if (hasFilePreview) {
      return (
        <div className="h-24 rounded-3xl bg-brand-50 border border-brand-100 overflow-hidden relative">
          <img src={ct!.fileData} alt={ct!.name} className="w-full h-full object-cover" />
        </div>
      );
    }

    // builder type or file without image data
    return (
      <div className="h-24 rounded-3xl bg-brand-50 border border-brand-100 overflow-hidden relative">
        <WireframePlaceholder />
      </div>
    );
  }

  // Built-in template
  const PreviewComponent = BUILTIN_PREVIEWS[templateId];

  if (PreviewComponent) {
    const accent = ACCENTS[templateId] || "#333333";
    return (
      <div
        className="h-24 rounded-3xl overflow-hidden relative"
        style={{ backgroundColor: accent + "08" }}
      >
        <PreviewComponent />
      </div>
    );
  }

  // Fallback for unknown template IDs
  return (
    <div className="h-24 rounded-3xl bg-brand-50 border border-brand-100 overflow-hidden relative">
      <WireframePlaceholder />
    </div>
  );
}
