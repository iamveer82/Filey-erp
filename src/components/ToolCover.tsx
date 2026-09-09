import { ArrowRight } from "lucide-react";
import { toolFlow, type Tool } from "./PdfToolbox";

/** Each registered tool has its own illustration of the operation it performs. */
export default function ToolCover({ tool, className = "" }: { tool: Tool; className?: string }) {
  const Icon = tool.icon;
  const flow = toolFlow(tool);
  return <div className={`tool-cover ${className}`} aria-hidden="true">
    <img src={`/tool-covers/tools/${tool.id}.webp`} alt="" loading="lazy" decoding="async" width="1536" height="1024" />
    <span className="tool-cover-operation"><Icon size={22} /></span>
    <span className="tool-cover-format">{flow.from}{flow.from !== flow.to && <><ArrowRight size={12} />{flow.to}</>}</span>
  </div>;
}
