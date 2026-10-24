# pm/ — dependencies and Filey environments

Applies on top of the root `AGENTS.md` (which carries the short form of the pinning rule).

## Dependency pinning policy

All dependencies carry upper bounds (litellm compromise #2796/#2810; Mini Shai-Hulud worm,
May 2026). PyPI: `>=floor,<next_major` (`"httpx>=0.28.1,<1"`); pre-1.0: `<0.(minor+2)`
(`>=0.29,<0.32`). Git URLs: 40-char commit SHA. GitHub Actions: SHA + `# vN` comment. CI-only
Python requirements: `==exact`. A bare `>=X.Y.Z` is rejected by CI and reviewers.
After changing `pyproject.toml`, run `filey pm lock`, re-source `./activate`, and commit
`pyproject.toml` with `uv.lock`. Reference: #2810 (bounds), #9801 (SHA pinning + audit CI).

PM owns Filey Python dependency changes. Use `pm.sync_venv(['extra'], explicit=True)`
for declared runtime extras, `filey pm install` for setup/sync, and `filey pm repair`
for damaged dependencies. Do not mutate Filey environments with raw pip or uv.
Use `pm.build_environment` for fresh build outputs and `pm.ensure_environment` for
isolated tool environments. Callers receive an interpreter or tool path, not uv.
Nix's declarative uv2nix builds and unrelated user projects remain independently owned.

The `[tool.uv] exclude-newer = "3 days"` release-age check covers **Filey's own dependencies
only**, exact pins included, with no per-package exemptions, and it runs when Filey LOCKS
(`filey pm lock`, CI's lock check), never on users' machines. When PM generates the plugin workspace
(`pm/workspace.py::_trust_core_lock`) it drops the cutoff and constrains every core-locked package to
its locked version: users trust the vetted lock, so a mirror without upload times cannot break an
install (#135589), and a plugin cannot move a core package. Plugin `python_dependencies` follow the
plugin's own policy. Teknium's rulings: "plugins dont have to abide by our 14 day rule … Only filey'
dependencies themselves have to"; dates are checked by us, not users; pinned deps need >3 days.
