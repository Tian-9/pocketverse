# Pocketverse 开发约定

设计基线在 docs/ARCHITECTURE.md，改设计先改文档。

## 跑之前
- `npm run lint`（类型检查 + 单元测试）和 `npm run build` 必须过。
- 浏览器行为用 Playwright 对 `npx vite preview --port 4173` 跑一遍，Chromium 在 /opt/pw-browsers/chromium。

## 容易踩的坑
- Svelte 5 的 `$state` 对象是 Proxy，直接存进 Dexie 会 DataCloneError。写库前用 `$state.snapshot(x)`。
- `liveQuery` 里不能写库（创建默认世界、创建存档都算写），先在 `$effect` 里解析出 id，再把 id 作为 `live(fn, initial, deps)` 的 deps。
- 查询函数里读到的 Svelte 状态不会被追踪，依赖状态的 live 查询必须传 deps。
- `Sheet` 用 `open={!!x}` 驱动时一定传 `onclose={() => (x = null)}`，否则点背景关掉后同一项点不开。
- 页面和弹窗都登记进浏览器历史（`nav.push` / `Sheet` 自动做），系统返回走 popstate。不要自己调 `history.*`，返回一律 `nav.pop()`。
- 屏幕是叠着渲染的，Playwright 选择器要用 `p.locator('.screen').last()` 限定到最上层。
- 提示词里易变内容（时间、L1 命中、插件动态）只能进最后一条用户消息，system 必须稳定，否则缓存全废。
- 插件只能 import `$kernel/api`，不能 import 内核内部模块或其他插件；跨插件跳转走 `nav.push(pluginId, screen, params)`。

## 文案
- 第三人称一律用"他"。
