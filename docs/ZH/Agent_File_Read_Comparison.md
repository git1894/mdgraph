# Agent File-Read 对比记录

本文记录 0.3 阶段 query-first、file-read-second agent 工作流的早期证据。它是工程 case note，不是完整的真实 agent A/B benchmark。

## 方法

对比使用仓库中已有的两个确定性来源：

- [Evaluation_Questions.md](../EN/Evaluation_Questions.md) 中的 alpha evaluation records。这里把 expected documents 当作 raw-file workflow 在已经知道正确目标后至少需要直接读取的 Markdown 文件数。
- [Alpha_Results.md](../EN/Alpha_Results.md) 中的 ECC external alpha smoke。这里把它的 context 结果当作一个已记录的大语料 MDGraph 检索案例。

该方法不声称 final-answer quality、elapsed wall time 或实际宿主 agent 行为。这些需要后续捕获完整 tool transcript 的真实 A/B run。

## 案例 1：Requirement-To-Implementation Chain

问题：`What is the documentation chain for LoginFlow from requirement to implementation?`

来源：alpha evaluation case `alpha-10`。

不使用 MDGraph 时，raw-file workflow 在发现目标后至少需要检查 5 个 expected Markdown documents：

- `docs/login-flow.md`
- `docs/api/login-api.md`
- `docs/auth-v2-design.md`
- `docs/redis-cache-design.md`
- `docs/adr/adr-001-cache-failure-policy.md`

使用 MDGraph 时，推荐第一步是针对任务文本调用一次 `mdgraph_context`。如果 agent 需要解释关系链，而不只是上下文包，可以再用 `mdgraph_trace` 追踪 `LoginFlow` 到 `src/auth/AuthService.ts`。

记录的 read delta：至少 `5` 次直接 Markdown 读取变为 `1` 次 context 调用，加可选 trace。

## 案例 2：Source Path To Documentation

问题：`Which documents correspond to src/routes/auth.ts?`

来源：alpha evaluation case `alpha-7`。

不使用 MDGraph 时，raw-file workflow 需要先发现 `src/routes/auth.ts` 的引用，再至少检查 2 个 expected Markdown documents：

- `docs/api/login-api.md`
- `docs/login-flow.md`

使用 MDGraph 时，推荐第一步是携带 `knownFiles: ["src/routes/auth.ts"]` 调用 `mdgraph_context`；如果输出需要关系路径，则用 `mdgraph_trace` 从 `src/routes/auth.ts` 追踪到 `LoginFlow`。

记录的 read delta：至少 `2` 次直接 Markdown 读取加 discovery search，变为 `1` 次 context 或 trace 调用。

## 案例 3：ECC Large Workflow Corpus

问题：`How are skills and rules organized for agent workflow?`

来源：[Alpha_Results.md](../EN/Alpha_Results.md) 中的 ECC external alpha smoke。

已记录的 MDGraph 结果：

- `mdgraph context "How are skills and rules organized for agent workflow?" --json`
- 打包 `26` 个 context items。
- 使用 `14076` / `28000` 字符。
- top context paths 包括 `skills/ui-demo/SKILL.md`、`docs/ANTIGRAVITY-GUIDE.md`、`docs/business/team-agent-orchestration-content-pack.md`、`skills/skill-comply/SKILL.md`、`CLAUDE.md` 和 `README.md`。

不使用 MDGraph 时，raw-file workflow 需要先做宽泛 text search，再直接检查多个 top-ranked documents。只按列出的 top context paths 计算，保守下限也是发现目标后 `6` 次直接 Markdown 读取。

记录的 read delta：在 2205-document 外部语料上，至少 `6` 次发现后的直接 Markdown 读取变为 `1` 次 context 调用。

## 后续测量

真正的 0.3 A/B benchmark 应捕获相同问题下的完整 agent transcript，并比较：

- 直接 file reads 和 text searches。
- MDGraph tool calls。
- 最终引用的文档。
- 是否仍需要 raw file fallback。
- 时间和 token budget。

在该 benchmark 出现前，本文只能作为 agent integration design 的有限证据，不能作为产品级性能承诺。