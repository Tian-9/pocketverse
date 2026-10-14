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
- 页面和弹窗都登记进浏览器历史（`nav.push` / `Sheet` 自动做），系统返回走 popstate。不要自己调 `history.*`，返回一律 `nav.pop()`。`pop()` / `home()` 是异步的（等 popstate），返回后再 push 必须 `await`。
- 屏幕是叠着渲染的，Playwright 选择器要用 `p.locator('.screen').last()` 限定到最上层。
- 提示词里会变的内容（时间、L1 命中、召回、当前状态、近期要事、插件动态）只能进最后一条用户消息，system 必须稳定，否则缓存全废。加新内容一律登记成 `PromptSection`（`context/assemble.ts`），会变的 place 用 'tail'；插件用 `PromptContributor` 的 volatile，要定位置给 `order`。变得少的（钱包、拥有的东西、最近的日记和朋友圈、笔记）用 `append`：变了才追加进历史，返回完整快照（`context/append.ts`）。`context/prefix.test.ts` 守着这条。历史窗口按块截（`visibleHistory`），不要改回每轮滑一条。
- 工具名只能是字母、数字、下划线、连字符（API 校验 `^[a-zA-Z0-9_-]{1,128}$`），不能带点。假接口不校验这个，真接口会 400；`definePlugin` 和 tools.test.ts 已加校验。
- 角色分享东西（歌、电影、新闻）一律走内核 `share` 工具 + 插件 `shares` 解析器，卡片用通用 `ShareCard`，不要为每种类型新加输出标签和卡片组件。引用原文必须经解析器校验。
- 离开回来的补发（发动态、写日记、回评论）一律登记到 manifest 的 `catchup`，由内核按角色、按档位合成一次调用；`attach` 档挂在下一次聊天回复或补发上。插件不要自己听 `app.resumed` 调模型。
- 用户主动发的东西（歌、红包…）走「+」面板 `composerActions`，产出 `OutgoingMessage`；插件工具往回复里放卡片用 `ctx.addCard`，不要新造消息类型。
- 插件只能 import `$kernel/api`，不能 import 内核内部模块或其他插件；跨插件跳转走 `nav.push(pluginId, screen, params)`。读存档、世界、角色、记忆、条目目录走 `ctx.data`（只读快照），界面响应式查询用 `$kernel/api` 的 `live`。`ctx.data` 缺什么就加到它上面，别绕过去读 `db()`。
- 有副作用的写入（扣钱、建订单、记日程、发动态…）一律带来源：工具和输出标签用 `PromptContext.sourceId`（这一轮的 turnId），「+」面板用 `ComposerActionProps.sourceId`（这条消息的 id），插件登记 `retract` 按来源删。钱只走 `wallet` 服务并带上 `sourceId`。删消息、重新生成走 `chat.deleteMessage(s)` / `regenerate`，不要直接删 messages 表（见 ARCHITECTURE 5.12）。
- 「现在几点」一律问存档时钟：插件用 `ctx.data.campaign().now` / `PromptContext.now`，内核用 `clock.now(cp.clock)`，不要 `Date.now()`（真实局两者一样，跳过时间或停表的局就不一样了）。
- 调模型不要写死模型名和 effort：内核按 `purpose` 归档（`llm/roles.ts`），插件用 `cheap: true` 选批量档，用户在设置里按档位选模型和思考深度。
- 模型写的 SVG 一律先 `sanitizeSvg`（`$kernel/api`）再存，显示只用 `Picture` 组件或分享卡 `cover`，不要把模型给的字符串内联进页面。
- 开发机可能是 macOS（文件系统不区分大小写）：两个文件名不能只差大小写。`inspect.svelte.ts` 和 `Inspect.svelte` 曾经撞车，在 Mac 上直接 29 个类型错误。

## 文案
- 第三人称一律用"他"。
