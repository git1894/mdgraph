# MDGraph Alpha 结果

本文记录 `0.1a` 可信 alpha 门槛的外部语料冒烟结果。它补充[Evaluation_Questions.md](Evaluation_Questions.md)、[Output_Contracts.md](Output_Contracts.md) 和 [发布清单](Release_Checklist.md)。

## ECC 外部测试工作区

运行日期：2026-06-23

MDGraph 命令：执行 `npm run build` 后的本地 `dist/bin/mdgraph.js`

Node.js：`v22.23.0`

ECC 内容作为外部工作区原地使用。没有把 ECC Markdown 内容复制进 MDGraph fixture，运行后已删除 ECC 中的临时 `.mdgraph/` 目录。

### 命令结果

| 命令 | 结果 |
|---|---|
| `index --json` | 通过，full mode，索引 `2205` 个文件 |
| `status --json` | 通过，计数与 index 结果一致 |
| `search "agent workflow" --limit 5 --json` | 通过，返回排序后的 command/rule/skill 文档 |
| `context "How are skills and rules organized for agent workflow?" --json` | 通过，打包 `26` 个条目，使用 `14076` / `28000` 字符 |
| `trace "README.md" "CLAUDE.md" --depth 4 --json` | 通过，找到 4 步路径：`CONTAINS`、`REFERENCES`、`REFERENCES`、`CONTAINS` |
| `doctor --json` | 通过，返回 fresh health report 和已记录的 alpha warning |

### 索引计数

| 计数 | 值 |
|---|---:|
| documents | 2205 |
| sections | 29622 |
| entities | 20468 |
| sourceRefs | 0 |
| edges | 247661 |
| chunks | 29622 |
| vectors | 0 |

### Search 和 context 样本

`search "agent workflow"` 前 5 个路径：

- `docs/zh-TW/commands/tdd.md`
- `docs/pt-BR/commands/orchestrate.md`
- `docs/ja-JP/rules/common/code-review.md`
- `docs/zh-CN/rules/common/code-review.md`
- `skills/skill-comply/SKILL.md`

Context 前若干路径：

- `skills/ui-demo/SKILL.md`
- `docs/ANTIGRAVITY-GUIDE.md`
- `docs/business/team-agent-orchestration-content-pack.md`
- `skills/skill-comply/SKILL.md`
- `CLAUDE.md`
- `README.md`

### Doctor 摘要

| 问题 | 数量 |
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

这些 warning 是外部语料 alpha 信号，不是 MDGraph 发布阻塞项。它们说明 `doctor` 可以在大型 agent workflow 仓库上暴露可行动的问题，同时保持索引 fresh。

### 备注

- Node 输出了已知的 `node:sqlite` experimental warning；所有命令都成功退出。
- 第一次 ECC 尝试暴露了一个翻译后的 agent 文档中存在非法 YAML front matter。MDGraph 现在会忽略非法 front matter metadata，并继续索引 Markdown 正文。
- 失败探针 `trace "AGENTS.md" "skills"` 返回 `End node not found: skills`；上方记录的成功 trace 使用具体文档节点。
