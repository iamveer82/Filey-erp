# Filey CLI Reference

Live sources when anything looks stale: `filey --help`, `filey <command> --help`,
https://hermes-agent.nousresearch.com/docs/reference/cli-commands

### Global Flags

```
filey [flags] [command]        (no subcommand = interactive chat)

  --version, -V             Show version
  -z, --oneshot PROMPT      One-shot: print ONLY the final response (for scripts/pipes)
  -m MODEL  --provider P    Model/provider override for this invocation
  -t, --toolsets LIST       Comma-separated toolsets for this invocation
  --resume, -r SESSION      Resume session by ID or title
  --continue, -c [NAME]     Resume by name, or most recent session
  --worktree, -w            Isolated git worktree mode (parallel agents)
  --skills, -s SKILL        Preload skills (comma-separate or repeat)
  --profile, -p NAME        Use a named profile
  --yolo                    Skip dangerous command approval
  --tui / --cli             Force the Ink TUI / classic REPL
  --ignore-rules            Skip AGENTS.md/SOUL.md/memory/skill injection
  --safe-mode               Disable ALL customizations (troubleshooting)
  --pass-session-id         Include session ID in system prompt
```

### Chat

```
filey chat [flags]
  -q, --query TEXT          Single query, non-interactive
  --image PATH              Attach a local image to a single query
  -Q, --quiet               Suppress banner, spinner, tool previews
  --checkpoints             Enable filesystem checkpoints (/rollback)
  --max-turns N             Cap tool-calling iterations
  --source TAG              Session source tag (default: cli)
```
(plus the global flags above)

### Configuration

```
filey setup [section]      Wizard (model|tts|terminal|gateway|tools|agent)
filey model                Interactive model/provider picker
filey fallback [add|remove|list]  Fallback provider chain
filey config [show|edit|get|set|unset|path|env-path|check|migrate]
filey login / logout       OAuth sign-in / clear stored auth
filey doctor [--fix]       Check dependencies and config
filey status [--full]      Component summary (--full: every section)
```

### Tools & Skills

```
filey tools [list|enable NAME|disable NAME]   Per-platform toolsets (curses UI with no args)

filey skills list|browse|search QUERY|inspect ID
filey skills install ID    Hub identifier OR a direct https://…/SKILL.md URL
filey skills config        Enable/disable skills per platform
filey skills check|update|uninstall|publish PATH
filey skills tap add REPO  Add a GitHub repo as a skill source
filey bundles              Skill bundles (one /<name> alias loads several skills)
```

### MCP Servers

```
filey mcp add NAME (--url or --command) | remove | list | test NAME
filey mcp catalog | install NAME     Curated catalog install
filey mcp configure NAME             Toggle tool selection
filey mcp serve                      Run Filey as an MCP server
```
Details (transport, tool discovery, catalog): `references/native-mcp.md`.

### Gateway (Messaging Platforms)

```
filey gateway run|install|start|stop|restart|status|setup
```

20+ platforms: Telegram, Discord, Slack, WhatsApp (Baileys + Business Cloud API), iMessage (Photon — `filey photon setup`), Signal, Email, SMS, Matrix, Mattermost, Teams, LINE, SimpleX, ntfy, Google Chat, Home Assistant, DingTalk, Feishu, WeCom, Weixin, API Server, Webhooks. Open WebUI connects via the API Server adapter. Most adapters ship under `plugins/platforms/`.
Docs: https://hermes-agent.nousresearch.com/docs/user-guide/messaging/

### Sessions

```
filey sessions list|browse|rename ID TITLE|delete ID|export OUT|prune|stats
```

### Cron / Webhooks

```
filey cron list|create SCHED|edit ID|pause|resume|run ID|remove|status
    Schedules: '30m', 'every 2h', '0 9 * * *', ISO timestamp
filey webhook subscribe NAME|list|remove NAME|test NAME
```
Webhook payloads/routes: `references/webhooks.md`.

### Profiles

```
filey profile list|create NAME (--clone|--clone-all|--clone-from)|use|show|delete
filey profile rename A B | alias NAME | export NAME | import FILE
filey profile migrate-identity A B   Retry a completed rename's session/routing identity migration
```

### Credentials & Pools

```
filey auth                 Interactive credential manager
filey auth add [PROVIDER]  Add OAuth or API-key credential (nous, openai-codex, qwen-oauth, …)
filey auth list|remove P IDX|reset PROVIDER|status
```
Multiple credentials per provider form a pool that rotates automatically and skips exhausted keys.

### Other

```
filey desktop / gui        Native desktop app
filey dashboard            Web admin panel + embedded chat (--stop / --status)
filey proxy                OpenAI-compatible local proxy backed by an OAuth provider
filey portal               Quick setup / sign in via Nous Portal
filey kanban <verb>        Multi-agent work-queue board
filey project              Named multi-folder workspaces
filey skin list|use|set    Switch/tweak skins (see references/themes.md)
filey pets <verb>          Pet mascots (see references/petdex.md)
filey memory setup|status|off|reset   Memory provider
filey secrets bitwarden|onepassword   External secret stores
filey moa                  Mixture-of-Agents slots
filey hooks / security / backup / import / checkpoints / console
filey logs [-f] [errors]   View agent/error logs
filey send                 One-off message through a gateway platform
filey pairing / plugins / insights / journey / computer-use
filey acp                  ACP server (IDE integration)
filey completion bash|zsh|fish
filey update / uninstall / claw migrate
```

Plugin- and provider-supplied subcommands (e.g. `filey photon setup`) only appear once their plugin is installed/active.

### Where to Find Things

| Looking for... | Location |
|---|---|
| Config options | `filey config edit` · [Configuration docs](https://hermes-agent.nousresearch.com/docs/user-guide/configuration) |
| Tools / toolsets | `filey tools list` · [Tools reference](https://hermes-agent.nousresearch.com/docs/reference/tools-reference) |
| Skills catalog | `filey skills browse` · [Skills catalog](https://hermes-agent.nousresearch.com/docs/reference/skills-catalog) |
| Provider setup | `filey model` · [Providers guide](https://hermes-agent.nousresearch.com/docs/integrations/providers) |
| Env variables | `filey config env-path` · [Env vars reference](https://hermes-agent.nousresearch.com/docs/reference/environment-variables) |
| Gateway logs | `~/.filey-agent/logs/gateway.log` (or `filey logs`) |
| Sessions | `filey sessions browse` (reads state.db) |
