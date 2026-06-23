# MDGraph Alpha Results

This document records external alpha smoke results for the 0.1a trust gate. It complements the fixture expectations in [Evaluation_Questions.md](Evaluation_Questions.md), the JSON contracts in [Output_Contracts.md](Output_Contracts.md), and the [release checklist](Release_Checklist.md).

## ECC external workspace

Run date: 2026-06-23

MDGraph command: local `dist/bin/mdgraph.js` after `npm run build`

Node.js: `v22.23.0`

ECC content was used in place as an external workspace. No ECC Markdown content was copied into MDGraph fixtures, and the temporary ECC `.mdgraph/` directory was removed after the run.

### Command results

| Command | Result |
|---|---|
| `index --json` | passed, full mode, `2205` files indexed |
| `status --json` | passed, counts matched the index result |
| `search "agent workflow" --limit 5 --json` | passed, returned ranked command/rule/skill documents |
| `context "How are skills and rules organized for agent workflow?" --json` | passed, packed `26` items and used `14076` of `28000` characters |
| `trace "README.md" "CLAUDE.md" --depth 4 --json` | passed, found a 4-step path with `CONTAINS`, `REFERENCES`, `REFERENCES`, `CONTAINS` |
| `doctor --json` | passed, returned a fresh health report with recorded alpha warnings |

### Index counts

| Count | Value |
|---|---:|
| documents | 2205 |
| sections | 29622 |
| entities | 20468 |
| sourceRefs | 0 |
| edges | 247661 |
| chunks | 29622 |
| vectors | 0 |

### Search and context samples

Top `search "agent workflow"` paths:

- `docs/zh-TW/commands/tdd.md`
- `docs/pt-BR/commands/orchestrate.md`
- `docs/ja-JP/rules/common/code-review.md`
- `docs/zh-CN/rules/common/code-review.md`
- `skills/skill-comply/SKILL.md`

Top context paths:

- `skills/ui-demo/SKILL.md`
- `docs/ANTIGRAVITY-GUIDE.md`
- `docs/business/team-agent-orchestration-content-pack.md`
- `skills/skill-comply/SKILL.md`
- `CLAUDE.md`
- `README.md`

### Doctor summary

| Issue | Count |
|---|---:|
| documents | 2205 |
| orphanDocs | 33 |
| deadLinks | 180 |
| staleSourceRefs | 0 |
| missingDefinitions | 0 |
| weaklyLinkedDocs | 3 |
| possibleContradictions | 264 |
| contentRisks | 67 |
| staleIndex | 0 |

These warnings are external-corpus alpha signals, not MDGraph release blockers. They show that `doctor` can surface actionable issues on a large agent workflow repository while keeping the index fresh.

### Run details

- Node printed the known experimental `node:sqlite` warning; all commands exited successfully.
- The first ECC attempt exposed malformed YAML front matter in a translated agent document. MDGraph now ignores invalid front matter metadata and still indexes the Markdown body.
- The failed probe `trace "AGENTS.md" "skills"` returned `End node not found: skills`; the successful trace above uses concrete document nodes.
