# Pre-installed agent skills

Bundled with Filey and offered to the Filey agent by `src/lib/bundledSkills.ts`. The packs are
copied unchanged from their repositories (MIT, each folder keeps its LICENSE); their Python helpers
run sandboxed in Pyodide through the `run_skill_script` tool.

| Folder | Source | Commit |
|---|---|---|
| instagram | https://github.com/Jakeschincariol/instagram-agent-skill | d03c56bb598be770c60b201f94237e5d1a4268a6 |
| youtube | https://github.com/Jakeschincariol/youtube-agent-skill | a2feb2104981a375ffd4f87ee04f4f5344ac43c6 |
| linkedin | https://github.com/Jakeschincariol/linkedin-agent-skill | add2c23882fe79180737d242ff80a5da205eda6a |
| agent-reach | https://github.com/Panniantong/Agent-Reach | 94f06c1969dfc1834001269d79d3ad0972d9dee6 (playbook rewritten for Filey's tools; the CLI is not bundled) |

To update a pack, copy its `skills/`, `templates/` and `LICENSE` over the folder at a new commit,
update the table, and run `src/lib/__tests__/bundled-skills.test.ts`.
