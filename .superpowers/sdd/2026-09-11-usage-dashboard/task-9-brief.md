### Task 9: dsh-client-ui-usage 包脚手架

**Files:**
- Create: packages/client-ui-usage/package.json
- Create: packages/client-ui-usage/tsconfig.json
- Create: packages/client-ui-usage/tsdown.config.ts
- Create: packages/client-ui-usage/src/index.ts(node 半空 apply)
- Create: packages/client-ui-usage/src/client/index.ts(Task 12 前为占位)
- Modify: vitest.config.ts(根:environmentMatchGlobs 增加 client-ui-usage jsdom)

**Interfaces:**
- Produces: bundle id dsh-client-ui-usage;node 半空 apply 模式与 client-ui-git 一致;client 测试走根 vitest jsdom lane。

- [ ] **Step 1: package.json(复制 packages/client-ui-git/package.json 后修改)**

name → dsh-client-ui-usage;description → "Settings usage-statistics dashboard over the dsh-usage-host summary route";dsh.client.inject → ["@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-primitives"];devDependencies:保留 client-ui-git 现有 link 集,去掉 "dsh-git-host": "workspace:^" 与 "@deepseek-ai/dsh-client-ui-conversation",加 "@deepseek-ai/dsh-client-ui-settings": "link:../../../deepseek-harness/packages/client/ui-settings"。

- [ ] **Step 2: tsconfig.json** — 复制 packages/client-ui-git/tsconfig.json 全文(jsx/DOM 保留)。

- [ ] **Step 3: tsdown.config.ts** — 复制 client-ui-git,改 const id = 'dsh-client-ui-usage';EXTERNALS 改为 ['react', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives'];cssModulesPlugin 的 name 改为 'dsh-usage-css-modules'。

- [ ] **Step 4: node 半 src/index.ts**

```
ts
/**
 * Node half: presence only, so the loader sees the package. All behavior is
 * browser-side via exports["./client"].
 * @module dsh-client-ui-usage
 */

export function apply(): void {}
```

- [ ] **Step 5: 占位 src/client/index.ts(Task 12 整体替换)**

```
ts
export function apply(): void {}
```

- [ ] **Step 6: 根 vitest.config.ts 的 environmentMatchGlobs 增加**

```
ts
['packages/client-ui-usage/tests/**', 'jsdom'],
```

- [ ] **Step 7: 构建验证**

Run: pnpm install && pnpm --filter dsh-client-ui-usage build
Expected: 退出码 0,生成 lib/client.js(banner 含 dsh-client-ui-usage)。

- [ ] **Step 8: Commit**

```
bash
git add packages/client-ui-usage vitest.config.ts
git commit -m "feat(client-ui-usage): package scaffold"
```

---

