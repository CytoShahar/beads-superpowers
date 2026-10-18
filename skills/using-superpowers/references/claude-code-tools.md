# Claude Code Tool Notes

Claude Code is the reference harness: skills speak its vocabulary
(`Agent` for a subagent dispatch, `Skill`), with task tracking in the
`bd` (beads) CLI. These notes cover the one place Claude Code can run a
plan cheaper than the skills' default shape. It is opt-in by your human
partner and changes nothing the skills require.

## Cheaper orchestration for subagent-driven development

The controller session is the most expensive seat in a
beads-superpowers:subagent-driven-development run: it reads every
dispatch result and every report, and it usually runs on the session's
most capable model. Claude Code supports nested subagents (three layers
below the main conversation by default;
`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` adjusts it), so the whole loop
can run one layer down.

When your human partner asks for it — or has said the session model is
too expensive to spend on coordination — dispatch ONE orchestrator
subagent on a mid-tier model with the plan path and the instruction to
use beads-superpowers:subagent-driven-development end to end. The
orchestrator dispatches its own implementers and reviewers per that
skill's Model Selection; the task state lives in beads and the
workspace in `.internal/sdd/<plan-basename>/`, so nothing is lost to the
extra layer.

The orchestrator cannot reach your human partner. When the breaker
trips or a decision needs them, it stops and returns the question to
you — relay it, never answer it yourself. Its final message must carry
every decision it made on your human partner's behalf verbatim; you
relay that list, not a summary of it.

The harness-neutral procedure is `beads-superpowers:subagent-driven-development`'s
`references/nested-controller.md`; this note only adds the Claude Code
spawn-depth mechanics.

Do this only for a whole plan. Nesting a single task's dispatch buys
nothing and adds a seat.
