# MDGraph 发布清单

在发布 MDGraph 或请求维护者切 release 前使用此清单。它补充 [CHANGELOG.md](../../CHANGELOG.md)、[Output_Contracts.md](Output_Contracts.md)、[Public_Contracts.md](Public_Contracts.md)、[Alpha_Results.md](Alpha_Results.md) 和 [docs/tasks/README.md](../tasks/README.md) 中的 task public check。

## 公开检查

- 确认 `package.json` 版本和 CLI `program.version(...)` 一致。
- 确认 [CHANGELOG.md](../../CHANGELOG.md) 已包含本次发布条目。
- 当公开 CLI/MCP 行为变化时，复查 README quick start、运行要求、MCP setup、输出契约、公开契约标签和已知 tradeoff。
- 当 parser、scanner、storage、query、MCP 或 doctor 行为对外部语料产生实质变化时，刷新 [Alpha_Results.md](Alpha_Results.md)。

## 0.8 契约门槛

- 确认 [Public_Contracts.md](Public_Contracts.md) 为每个被触及的 public surface 标注 `stable`、`stable-additive`、`experimental`、`reserved` 或 `internal`。
- 确认 focused contract tests 覆盖 MCP tool definitions、代表性 JSON fields、edge kinds、doctor warning shape、config defaults 和 schema compatibility guidance。
- 已经返回结构化错误的命令，应确认错误输出包含稳定 `code` 和 remediation。

## 0.9 证据门槛

- 确认 [Public_Contracts.md](Public_Contracts.md) 将 context recovery fields 标注为 `stable-additive`。
- 确认 context、MCP 和 contract tests 覆盖 `nodeId`、`documentId`、可选 `sectionId`、可选 `anchor` 和 graph-expansion `edgePath`。
- 确认 `smoke:cli` 覆盖多问题结构化 benchmark，并记录 external ECC skip/pass 行为。
- 除非单独 release 明确冻结，否则确认 optional semantic 行为仍保持 experimental。

## 1.0 readiness 门槛

- 确认已知 output-shape 不一致已经规范化，或被明确记录为刻意保留。
- 确认 `context --json` 和 MCP `mdgraph_context.structuredContent` 暴露恢复字段（`nodeId`、`documentId`、可选 `sectionId`、可选 `anchor` 和 graph-expansion `edgePath`），方便 agent 交接到 `node`、`trace` 和 raw Markdown。
- 确认 Node.js `>=22.5.0` 仍是支持下限，且当前 release 已在当前 Node 22.x 上测试。
- 确认 Windows 已在本地或 CI smoke。`1.0` 前 macOS 和 Linux 应有 CI 或 release maintainer smoke。
- 确认 1.0 release notes 将兼容承诺与功能新增分开说明。

## 命令门槛

安装依赖后，从仓库根目录运行：

```bash
npm run typecheck
npm test
npm run build
npm run smoke:cli
npm run smoke:pack
node dist/bin/mdgraph.js index --json
node dist/bin/mdgraph.js doctor --strict --json
node dist/bin/mdgraph.js status --storage --json
node dist/bin/mdgraph.js bundle create --profile private --json
node dist/bin/mdgraph.js bundle verify BUNDLE_DIR_FROM_CREATE_OUTPUT --json
node dist/bin/mdgraph.js report --json --eval --bundle BUNDLE_DIR_FROM_CREATE_OUTPUT
node dist/bin/mdgraph.js diff --base HEAD --json
node dist/bin/mdgraph.js report --json --base HEAD
node dist/bin/mdgraph.js report --json --benchmark PATH_TO_BENCHMARK_RUN_RECORDS
npm run task:public-check
git diff --check
```

预期结果：

- Typecheck、tests、build、CLI smoke 和 pack smoke 均以 0 退出。
- `doctor --strict --json` 对 MDGraph 仓库报告 `staleIndex: 0`，且没有问题计数。
- `status --storage --json` 返回 `{ counts, storage }`，并包含 database、object、path group、edge kind、high-degree node 和 vector 信息。
- `bundle create`、`bundle verify` 和 `report --json --eval --bundle` 为当前仓库索引返回有效的私有工作流 artifact。
- `diff --base` 和 `report --base` 返回 documentation graph impact summary，且不会替换当前 index。
- `report --benchmark` 为多问题 smoke set 返回 paired run-record delta，将不完整 pair 报告为 skipped，并且不需要 transcript 或 agent/model 执行。
- `task:public-check` 不应发现 `docs/tasks/` 下除允许公开文件外的已跟踪任务工件。
- `git diff --check` 干净。Windows CRLF 文件如出现未改动行尾误报，可设置仓库本地 `core.whitespace=cr-at-eol`。
- 当 scanner、parser、storage、query、MCP 或 doctor 行为对外部语料产生实质变化时，必须运行 external corpus smoke。如果未设置 `MDGRAPH_EXTERNAL_ECC_PATH`，应明确记录 skip。

## Package 门槛

- 如果 package metadata 或 included public docs 变化，使用 `npm pack --dry-run` 检查 tarball 内容。
- 确认 package 包含 `dist`、`README.md`、`CHANGELOG.md` 和 `LICENSE`。
- 确认 package 不包含 `.mdgraph/`、任务工件目录、临时输出、本地数据库或外部工作区内容。

## Release notes 文案

- 总结用户可见的 CLI/MCP 行为变化。
- 明确指出输出契约变化。
- 仅把已知 `node:sqlite` experimental warning 描述为非失败运行时 warning。
- 将外部 alpha warning 与 MDGraph 仓库发布阻塞项分开。
