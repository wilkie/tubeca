# <Part Name>

> One-paragraph summary: what this part of the system is and why it exists.

## Responsibilities

What this part does, as a short bulleted list of concrete behaviours.

## Goals

The design goals this part serves (user-facing and technical). Derive these from the code
and the commit history; be honest about what the code actually optimises for.

## Components

A table of the primary files/modules that make up this part:

| File | Role |
|------|------|
| `backend/src/...` | ... |

## How It Works

The key mechanisms, flows, and data structures, described in prose and (where useful)
short numbered flows. Cover the important edge cases and behaviours that a newcomer
would need to know. Reference files as `path:line` where a precise pointer helps.
Keep code snippets to a minimum; prefer describing behaviour.

## Interactions

How this part depends on, and is depended on by, other parts of the system. Use the
spec names from the list below as link targets, e.g. `[Metadata Scraping](metadata-scraping.md)`.

- **Depends on:** ...
- **Used by:** ...
- **Shared data:** which Prisma models / config keys / queues it reads or writes.

## History

A short chronological list of the commits that shaped this part (hash + one line),
so a reader can see how it evolved and why.

## Known Limitations

Things the code does not handle, or handles poorly, that are observable today.

## Opportunities

Potential improvements, each with a one-line rationale and a rough size (S/M/L).
Include: gaps vs. goals, TODOs/stubs found in code, robustness issues, missing tests,
duplication, and product features the current design makes natural. Be specific and
grounded in what you saw in the code; do not pad with generic advice.
