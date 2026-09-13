# dsh-client-ui-memory

engram 记忆 MCP 工具调用在 DSH Web 转录中的内联卡片。每个 `mcp__engram__<tool>`
调用渲染一张紧凑卡片：动作（保存/搜索/读取…）、标题或查询词、命中数、内容预览，
完整返回内容可展开。替换 DSH 内置的 generic tool row；未识别的工具名回退 generic。

## 结构

- `src/client/memory-model.ts` — 纯解析模型：工具分类（write/read/plain）、参数
  抽取（title/query/id）、结果计数与预览。对畸形 JSON 全防御。
- `src/client/MemoryToolCard.tsx` — 卡片组件，block 的纯函数。
- `src/client/locales.ts` — `memory` 命名空间双语字典（zh 为 key 事实源）。
- `src/client/index.ts` — 对 18 个 agent 工具各注册一个
  `tool.call.toolview`（key = `mcp__engram__<tool>`）+ 字典注册。
- 工具名单 `ENGRAM_TOOLS` 来自 engram 1.20.0 实测 `tools/list`
  （`--tools=agent`），schema 快照在仓库 `scratch/engram-tools.json`。

## 约束

- **serverName 必须是 `engram`**：keyed slot 按完整 wire 工具名精确分发，
  换 serverName 卡片不再命中（回退 generic row）。
- engram 本体通过 `@deepseek-ai/dsh-mcp-client` 接入（见 DSH
  `docs/user/guide/mcp-memory.md` 或 `~/.dsh/profiles/<name>/cordis.patch.yml`
  中的 `memory-engram` 行），本插件只做展示。

## 安装（进入 DSH）

```sh
pnpm --filter dsh-client-ui-memory build
dsh plugin --profile web add /Users/jelvin/000_source_code/dsh-plugins/packages/dsh-client-ui-memory
```

包声明 `dsh.bundle.patch`（插入 node half seat）与 `dsh.client`（浏览器半经
`exports["./client"]` 被发现）。注意：`dsh plugin add` 不会热加载——bundle
层只在实例启动时组合，**安装后必须重启 DSH 实例生效**。每个 profile bundle
都必须声明 `dsh.bundle.patch`，缺失会让 profile 加载直接失败。

## 开发

```sh
pnpm --filter dsh-client-ui-memory build   # tsc + tsdown 双面打包
pnpm test                                  # 仓库根统一 vitest（jsdom lane）
```
