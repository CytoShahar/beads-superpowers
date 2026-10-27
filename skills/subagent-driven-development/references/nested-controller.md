# Cheaper Orchestration: The Controller One Layer Down

Read this when your human partner asks for a cheaper subagent-driven run, or says
the session model is too expensive to spend on coordination. It is opt-in and
changes nothing `SKILL.md` requires.

## Why

The controller is the most expensive seat in a run: it reads every dispatch result
and every report, and it usually runs on the session's most capable model. Where
the harness supports nested subagents (a subagent that can itself dispatch
subagents), the whole loop can run one layer down. In measured runs this cost
roughly half the tokens and wall clock.

## How

Dispatch ONE orchestrator subagent on a **mid-tier model** with the plan path and
the instruction to use `beads-superpowers:subagent-driven-development` end to end.
The orchestrator dispatches its own implementers and reviewers per `SKILL.md`'s
Model Selection — reviews keep their most-capable-tier default. Beads and the plan
workspace live on disk, so nothing is lost to the extra layer.

Its final message must carry, verbatim:

- the "Rulings I made" list — relay it to your human partner, do not summarize it;
- every stop-class question, breaker trip (`references/breaker-trip.md`), and
  filed "Declined to judge" bead it surfaced — the orchestrator stops and reports
  these to you exactly as it would to the human, and you put them to the human.
  Neither layer adjudicates them.

## When not to

Only for a whole plan. Nesting a single task's dispatch buys nothing and adds a
seat. Without nested-subagent support, run the controller in the session as usual.
