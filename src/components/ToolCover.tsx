import { ArrowRight } from "lucide-react";
import { toolFlow, type Tool } from "./PdfToolbox";

/** Original document drawings inherit the active light/dark theme. */
export default function ToolCover({ tool, className = "" }: { tool: Tool; className?: string }) {
  const Icon = tool.icon;
  const flow = toolFlow(tool);
  const combine = ["merge", "alternate", "combine-single", "grid", "nup", "booklet"].includes(tool.id);
  const separate = ["split", "split-at", "divide", "extract", "delete", "reorder", "reverse"].includes(tool.id);
  const unlock = ["decrypt", "remove-restrictions"].includes(tool.id);
  const image = /img|image|svg|heic|psd|tiff|raster|poster/.test(tool.id);
  const table = /csv|json|excel|xlsx|table|grid/.test(tool.id);
  const sign = /sign|stamp|watermark|logo|letterhead/.test(tool.id);
  return <div className={`tool-cover ${className}`} aria-hidden="true">
    <svg className="tool-cover-drawing" viewBox="0 0 120 140" fill="none" data-tool={tool.id}>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {combine && <g opacity=".3"><path d="M25 36H18V112H69V105" /><path d="M30 29H24V106H75V100" /></g>}
        {separate && <g opacity=".35"><path d="M22 53H12V104H27" /><path d="M96 36H107V88H97" /></g>}
        <path d="M34 23H73L87 37V103A4 4 0 0 1 83 107H34A4 4 0 0 1 30 103V27A4 4 0 0 1 34 23Z" />
        <path d="M73 23V37H87" />
        {image ? <g opacity=".5"><rect x="40" y="47" width="37" height="27" rx="2" /><circle cx="50" cy="55" r="3" /><path d="m40 69 11-9 9 7 9-12 8 10" /></g>
          : table ? <g opacity=".5"><rect x="40" y="47" width="37" height="29" rx="2" /><path d="M40 56H77M40 66H77M52 47V76M64 47V76" /></g>
          : <g opacity=".35"><path d="M41 50H68M41 58H76M41 66H62" /></g>}
        {sign && <path d="M41 91c8-13 3-16-1-6s4 10 9 1 2 10 11 0c3-4 3 4 10 1" strokeWidth="1.8" />}
        {separate && <path d="M25 81H94" strokeDasharray="3 5" opacity=".45" />}
        {unlock && <g><path d="M66 87V80a6 6 0 0 1 12 0" strokeWidth="2" /><rect x="63" y="87" width="20" height="17" rx="3" fill="hsl(var(--muted))" /><path d="M73 94V98" strokeWidth="2" /></g>}
        {!unlock && !sign && <Icon x={50} y={81} width={20} height={20} strokeWidth={1.6} />}
      </g>
      <path d="M28 119H91" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity=".12" />
    </svg>
    <span className="tool-cover-format">{flow.from}{flow.from !== flow.to && <><ArrowRight size={12} />{flow.to}</>}</span>
  </div>;
}
