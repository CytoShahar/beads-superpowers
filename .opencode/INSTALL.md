# Installing beads-superpowers for OpenCode

## Prerequisites

- [OpenCode.ai](https://opencode.ai) installed
- `bd` (beads) CLI — `npm install -g @beads/bd` — required for persistent task memory

## Installation

OpenCode V2 requires version 2.0.4 or later.

### OpenCode V1

Add beads-superpowers to the `plugin` array in your `opencode.json` (global or project-level):

```json
{
  "plugin": ["beads-superpowers@git+https://github.com/DollarDill/beads-superpowers.git"]
}
```

### OpenCode V2 (2.0.4 or later)

V2 reads the `plugins` key instead:

```json
{
  "plugins": ["beads-superpowers@git+https://github.com/DollarDill/beads-superpowers.git"]
}
```

For a local V2 installation, configure the repository directory containing
`index.js`. OpenCode 2.0.4 and 2.0.7 reject a configured direct JavaScript-file
path. Discovered plugin symlinks remain supported.

Restart OpenCode. V2 uses the `opencode` command; `opencode2` may be available
as an alias. The plugin installs through OpenCode's plugin manager and
registers all skills.

Top-level sessions get the bootstrap (using-superpowers + composed beads
context); delegated child (subagent) sessions keep the skills but not the
bootstrap. After compaction the beads context is re-composed.

Verify by asking: "Tell me about your superpowers"

OpenCode uses its own plugin install. If you also use Claude Code, Codex, or
another harness, install beads-superpowers separately for each one.

## Migrating from the installer copy-mode (pre-0.12)

Earlier releases installed OpenCode support by copying files. If you used
`install.sh` before 0.12, remove the old copies to avoid double injection
once the git plugin is active:

```bash
rm -f ~/.config/opencode/plugins/beads-superpowers-plugin.ts
rm -f ~/.config/opencode/hooks/session-start
```

For the copied skills (superseded by the plugin's auto-registered skills), run
`install.sh --uninstall` — it removes exactly the set a prior install copied.
Note its scope: `--uninstall` is a full multi-harness teardown — it also
removes the Claude Code and Codex skills, hooks, and agents it installed, so
reinstall for those harnesses afterward if you still use them.
Avoid deleting from `~/.config/opencode/skills/` by hand: you risk removing
skills you authored yourself.

## Usage

Use OpenCode's native `skill` tool:

```text
use skill tool to list skills
use skill tool to load brainstorming
```

## Updating

OpenCode installs beads-superpowers through a git-backed package spec. Some
OpenCode and Bun versions pin that resolved git dependency in a lockfile or
cache, so a restart may not pick up the newest beads-superpowers commit. If
updates do not appear, clear OpenCode's package cache or reinstall the plugin.

To pin a specific version, append a `#vX.Y.Z` ref (substitute a real release
tag; same form for the V1 `plugin` key and the V2 `plugins` key):

```json
{
  "plugin": ["beads-superpowers@git+https://github.com/DollarDill/beads-superpowers.git#vX.Y.Z"]
}
```

On V2, pin a release that ships the root `index.js` and the V2 `setup()`
entrypoint; earlier releases load only on V1.

## Troubleshooting

### Plugin not loading

1. Check logs. V1: `opencode run --print-logs "hello" 2>&1 | grep -i beads-superpowers`.
   V2 loads plugins in the background server, so add `--standalone`:
   `opencode run --standalone --print-logs "hello" 2>&1 | grep -i beads-superpowers`,
   or inspect `~/.local/share/opencode/log/opencode.log` filtering for `role=server`.
2. Verify the plugin line in your `opencode.json`
3. Make sure you're running a recent version of OpenCode

### Windows install issues

Some Windows OpenCode builds have upstream installer issues with git-backed
plugin specs, including cache paths for `git+https` URLs and Bun not finding
`git.exe` even when it works in a normal terminal. If OpenCode cannot install
the plugin, try installing with system npm and pointing OpenCode at the local
package:

```powershell
npm install beads-superpowers@git+https://github.com/DollarDill/beads-superpowers.git --prefix "$HOME\.config\opencode"
```

Then use the absolute path of the installed package in `opencode.json` for your
OpenCode version. OpenCode does not expand `~`; a `~/...` entry is treated as a
package name, not a local directory.

**V1:**

```json
{
  "plugin": ["C:\\Users\\<you>\\.config\\opencode\\node_modules\\beads-superpowers"]
}
```

**V2 (2.0.4 or later):**

```json
{
  "plugins": ["C:\\Users\\<you>\\.config\\opencode\\node_modules\\beads-superpowers"]
}
```

### Skills not found

1. Use `skill` tool to list what's discovered
2. Check that the plugin is loading (see above)

### Tool mapping

See skills/using-superpowers/references/opencode-tools.md — note this plugin
tracks ALL tasks with the bd (beads) CLI, not the todo tools. V2 renamed
`task` → `subagent` (agent name in `agent`, continue with `sessionID`),
`apply_patch` → `patch`, and `bash` → `shell`, and has no todo tool at all
(beads replaces it on both flavors).

## Getting Help

- Report issues: <https://github.com/DollarDill/beads-superpowers/issues>
- Full documentation: <https://github.com/DollarDill/beads-superpowers>
