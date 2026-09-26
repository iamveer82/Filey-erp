import {useState} from "react";
import {createRoot} from "react-dom/client";
import MentionInput from "../../src/components/MentionInput";
import "../../src/index.css";
function Fixture(){const [value,setValue]=useState("");return <main className="min-h-screen bg-background text-foreground p-8"><h1>Isolated mention check</h1><p>Generated members; nothing is saved or posted.</p><button className="btn-secondary mt-4" onClick={()=>document.documentElement.classList.toggle("dark")}>Toggle theme</button><div className="mt-64 overflow-hidden border border-border p-4"><MentionInput label="Fixture message" value={value} onChange={setValue} members={[{id:"fixture-1",name:"Alex Fixture"},{id:"fixture-2",name:"نور التجربة"}]}/></div></main>}
createRoot(document.getElementById("root")!).render(<Fixture/>);
