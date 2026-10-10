# Pocketverse 架构

> 一个跑在浏览器里的"小手机"：角色扮演的外壳是一部虚拟手机，功能靠插件长出来，记忆靠分层上下文管理撑住。本文是项目的设计基线，代码以此为准，改设计先改这里。

## 0. 一句话

**微内核 + 插件 + 三层记忆。** 内核只管手机外壳、存储、模型网关、上下文拼装和插件注册表。聊天、微信、朋友圈、日记、主题，全部是插件。

## 1. 目标与非目标

目标：

- 纯前端 PWA，静态文件部署（GitHub Pages），手机加到主屏幕即可用，无服务器。
- 角色卡、世界书可导入（兼容 SillyTavern 常见格式），多世界、多角色、互不串台。
- 记忆系统对标 Claude Code 的用法：常驻摘要 + 按需检索 + 自动写回。
- 一切可见功能都是插件，内核不认识"微信"是什么。
- 视觉统一：插件只能用内核组件库拼界面，不许自带一套样式。
- 先烧掉 Anthropic 的 API 额度，所以 Claude 是一等适配器，缓存、工具循环、上下文编辑、memory 工具都用上。

非目标（现在不做，口子留着）：

- 后台运行、锁屏后主动推送。浏览器做不到，用"打开时补发"代替。
- 第三方插件沙箱。第一版只有内置插件，信任模型。
- 向量检索。关键词 + 模型自主搜索够用，等不够用再说。
- 多端同步。先本地，同步以后做成插件。

## 2. 技术栈

| 层 | 选择 | 理由 |
|---|---|---|
| 构建 | Vite | 快，零配置，PWA 插件现成 |
| 语言 | TypeScript，strict | 让编译器替人查错 |
| UI | Svelte 5 | 写法最接近 HTML，产物最小，手机上启动快 |
| 样式 | Tailwind + CSS 变量 | 变量是主题系统的根，Tailwind 只是写法 |
| 存储 | Dexie（IndexedDB） | 带版本迁移，插件可以声明自己的表 |
| 搜索 | MiniSearch | 几 KB 的内存 BM25，世界书和记忆的关键词检索 |
| 模型 | `@anthropic-ai/sdk`（浏览器模式）为主，Gemini / OpenAI 兼容为辅 | 适配器模式 |
| PWA | vite-plugin-pwa | manifest + service worker 只做离线缓存，不做保活 hack |

## 3. 仓库结构

```
pocketverse/
  docs/                  设计文档（本文）
  src/
    kernel/              内核，插件不能绕过它
      shell/             锁屏、桌面、Dock、App 切换、通知条
      registry/          插件注册表、贡献点收集
      bus/               事件总线
      storage/           Dexie 实例、schema 版本、插件表命名空间
      llm/               模型网关：适配器、流式、缓存、工具循环、计费表
      context/           上下文拼装器：L0/L1/L2、写回、压缩
      theme/             主题引擎：token 定义、主题包加载
      scheduler/         前台定时器 + 打开时补发
      importers/         角色卡 PNG/JSON、ST 世界书、预设
      ui/                基础组件库（插件只能用这里的东西）
    plugins/
      chat/              内核级聊天（不可关闭，但仍走插件接口，验证接口够不够用）
      characters/        角色与世界管理界面
      lore/              世界书管理界面
      settings/          API、主题、插件开关
      wechat/            示例：聊天换皮 + 转账/红包指令
      moments/           示例：朋友圈，注入提示词 + 解析 <moment>
      diary/             示例：定时写日记，作为记忆来源
      theme-*/           主题包也是插件
    app.ts               启动：加载内核 → 注册内置插件 → 挂载 shell
  public/                图标、manifest
```

规则：`plugins/*` 只能 import `kernel/api`（公开接口），不能 import 内核内部模块，也不能互相 import。插件间通信走事件总线或注册表。

## 4. 核心数据模型

全部存 Dexie。ID 一律 ULID 字符串，便于排序和合并。

```ts
// 世界：只读正典的容器
interface World {
  id: string; name: string; summary: string;   // summary 进 L0
  createdAt: number; updatedAt: number;
}

// 世界书条目：正典，导入后只读，用户手动编辑除外
interface LoreEntry {
  id: string; worldId: string;                 // 风格指令是全局的，worldId 为 'global'；人物背景跟卡走，为 'character'
  title: string; summary: string;              // title+summary 组成 L0 目录
  content: string;                             // 正文，L1 命中或 L2 拉取时才进上下文
  scope: 'world' | 'character' | 'relation';   // 作用域
  characterIds?: string[];                     // scope 为 character/relation 时绑定
  kind?: 'lore' | 'style';                     // 设定 or 风格指令
  triggers: { keywords: string[]; regex?: string; recursive?: boolean };
  constant: boolean;                           // 常驻（慎用，直接进 L0）
  order: number; enabled: boolean;
}

// 角色卡：演员本身，不绑世界。在哪个世界玩由存档决定，同一张卡可以在不同世界各开一局
interface Character {
  id: string;
  name: string; avatar?: Blob;
  core: string;          // 精简版人设，进 L0，目标 ≤ 800 token
  full: string;          // 完整人设、示例对话等，L2 可拉取
  firstMessage?: string;
  voice?: Record<string, unknown>;  // 插件自定义字段（口癖、语音等）
}

// 存档：一个世界 + 一组角色 的一次"游玩"，记忆的拥有者。
// 每张卡有一个「当前这一局」（kv `kernel.currentCampaign.<characterId>`），聊天、主页、补发、朋友圈只看它；别的局先睡着，主页上能切换或新开。
interface Campaign {
  id: string; worldId: string; characterIds: string[];
  name: string; createdAt: number; lastPlayedAt: number;
  state: CampaignState;                        // 当前状态，进 L0
}
interface CampaignState {
  inWorldTime?: string; location?: string;
  relations: Record<string, string>;           // characterId -> 一句话关系
  mood: Record<string, string>;                // characterId -> 一句话情绪
  facts: string[];                             // 最多 20 条当前事实，超出进记忆
}

// 对话：属于存档，一个存档可有多个对话（私聊、群聊）
interface Conversation {
  id: string; campaignId: string;
  kind: string;              // 'direct' | 'group' | 插件自定义（'wechat' 等）
  participantIds: string[];
  pluginId: string;          // 哪个插件渲染它
}

interface Message {
  id: string; conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: ContentBlock[];   // 文本、插件卡片、工具调用记录
  ts: number;                // 真实时间
  inWorldTs?: string;        // 剧情时间（补发时与 ts 不同）
  tokens?: number;
}
```

### 4.1 记忆模型（重点）

记忆全部挂在**存档**下，不挂世界，不挂角色本体。同一个世界换角色玩，是新存档，记忆为空。同一个角色在同一世界重开一局，也是新存档。

```ts
// 情节记忆：发生过什么
interface EpisodicMemory {
  id: string; campaignId: string;
  characterId?: string;        // 哪个角色视角，空表示旁白
  when: string;                // 剧情时间
  text: string;                // 一两句话
  importance: 1 | 2 | 3;       // 3 = 进 L0 的"近期要事"候选
  sourceMessageIds: string[];
  createdAt: number;
}

// 世界覆盖：这局玩出来的世界变化，覆盖正典但不改正典
interface LoreOverlay {
  id: string; campaignId: string;
  loreEntryId?: string;        // 覆盖哪条正典；空表示新增事实
  title: string; summary: string; content: string;
  reason: string;              // 哪次对话导致的
  createdAt: number;
}

// 用户画像：跨存档，唯一一份
interface UserProfile { facts: string[]; preferences: string[] }
```

界面归属（课题分离，2026-10 定）：

- 「世界」App 列的是一个个世界（背景：哈利·波特、修仙…），点进去是这个世界的条目（`scope: world`）。可新建、改名、删除（有存档在用的不能删）。
- 「人物背景」（`scope: character`，含角色卡内嵌的世界书）跟卡走，不属于任何世界，只在角色卡页里管，换世界也带着。
- 「风格」App 管 `kind: style`，全局，不属于任何世界。
- 拼上下文时取：所在世界（存档的 worldId）的 world 条目 + 在场角色的人物背景 + 全局 style 条目 + 本局覆盖层。规则在 `kernel/data/lore.ts` 的 `loreApplies`，拼装和记忆整理共用。

检索规则：**覆盖优先于正典**。查世界书时，若某条正典有覆盖，返回覆盖版并标注"本局已变化：原文 → 现状"。L0 目录里同样标注。正典永远不被程序修改。

## 5. 内核模块

### 5.1 Shell

- 锁屏（可关）、桌面网格、分页、Dock 四格、顶部通知条、App 切换动画。
- 桌面图标和 Dock 项都来自注册表，内核自己没有任何硬编码 App。
- Dock 可编辑，候选项 = 所有已启用插件暴露的 `shortcuts`。
- 通知条：插件可以 `notify()`，显示在顶部，点击跳转。

### 5.2 Registry

插件通过 `definePlugin()` 声明贡献点，注册表在启动时收集，启停插件时增删。贡献点清单见第 7 节。

### 5.3 Bus

类型化事件总线。内核事件：

```
app.opened / app.closed / app.resumed(elapsedMs)
conversation.message(convId, message)
conversation.beforeSend(convId, draft)       // 插件可修改或取消
llm.turn.start / llm.turn.tool(name) / llm.turn.end(usage)
campaign.switched(campaignId)
memory.written(kind, id)
theme.changed(themeId)
```

插件可自定义事件，命名必须带插件前缀 `wechat.transfer`。

### 5.4 Storage

- 单个 Dexie 实例，内核表 + 插件表。插件表名强制前缀 `p_<pluginId>_`。
- 插件在 manifest 里声明 `storage.tables`，内核合并进 schema，版本号由内核统一递增。
- 导出 = 整库 JSON + Blob 打包成 zip；导入反之。单个存档也可单独导出。

### 5.5 LLM 网关

接口：

```ts
interface LlmProvider {
  id: string;
  chat(req: ChatRequest, hooks: StreamHooks): Promise<ChatResult>;
  countTokens?(req: ChatRequest): Promise<number>;
  capabilities: { tools: boolean; caching: boolean; contextEditing: boolean; memoryTool: boolean };
}
```

Claude 适配器要做的事：

- 浏览器直连：SDK 开 `dangerouslyAllowBrowser`，Key 存本地（可选加 PIN 加密）。
- 默认模型 `claude-opus-5-5`，adaptive thinking，效果用 `output_config.effort` 控（默认 `medium`，用户可调）。流式输出。
- **缓存**：`tools → system → messages` 顺序固定。断点两处：system 末尾（L0），倒数第二条消息末尾。时间戳、L1 命中、随机内容一律放在最后一条用户消息里，绝不进 system。
- **工具循环**：最多 N 轮（默认 4），每轮发 `llm.turn.tool` 事件给 UI 显示"正在翻日记"之类的状态。工具结果带 `is_error` 返回，不吞异常。
- **上下文编辑**：开 `clear_tool_uses`，旧的工具结果自动清掉，历史不被查过的世界书撑肥。
- **服务端压缩**：开 beta 压缩作为保底；响应里的压缩块原样写回历史。
- **memory 工具**：注册 `memory_20250818`，后端映射到 Dexie 里的虚拟文件系统 `/memories/<campaignId>/...`，模型自己会维护。
- **refusal 处理**：检查 `stop_reason`，开服务端 fallback。
- **计费表**：每次响应记录 usage（含缓存读写），设置页能看到本月花了多少、缓存命中率多少。命中率低于 70% 要在设置页标红，这是最重要的省钱指标。

Gemini、OpenAI 兼容适配器：只实现 `chat` 和流式，其他能力标 false，上下文拼装器据此降级（没有工具就只用 L0+L1）。

### 5.6 Context 拼装器

每轮聊天的输入是这样拼的：

```
[tools]      内核工具 + 当前启用插件的工具（顺序固定，按 id 排序）
[system]     ← 缓存断点 1
  1. 全局规则（输出格式、禁止事项，固定文本）
  2. 用户画像
  3. 世界摘要
  4. 在场角色的 core
  5. 存档状态 CampaignState
  6. 世界书目录（title + summary，带覆盖标注）
  7. 近期要事（importance=3 的情节记忆，最近 10 条）
  8. 各插件的 promptContributors（固定部分）
[messages]
  历史消息（最近 N 条原文，更早的由压缩块代替）  ← 缓存断点 2
  最后一条用户消息：
    - L1 命中的世界书正文（按 order 排序）
    - 插件 promptContributors（易变部分，如"刚发了一条朋友圈"）
    - 当前真实时间与剧情时间
    - 用户输入
```

L1 触发：扫最近 K 条消息（默认 4）的文本，匹配 `triggers.keywords`（分词后整词匹配）和 `regex`；命中条目若 `recursive`，再用其正文做一轮匹配（最多递归 2 层）。总预算默认 4k token，按 `order` 截断。

L2 工具（内核提供）：

| 工具 | 说明 |
|---|---|
| `lore_search(query)` | BM25 搜当前存档作用域内的世界书 + 覆盖，返回 title/summary/id 列表 |
| `lore_read(id)` | 读正文，覆盖优先 |
| `memory_search(query, characterId?)` | 搜情节记忆 |
| `memory_recent(n)` | 最近 n 条情节记忆 |
| `character_read(id)` | 读角色 full 人设 |
| `state_update(patch)` | 更新 CampaignState（关系、情绪、地点、事实） |
| `overlay_write(entry)` | 写一条世界覆盖 |

工具描述里明确告诉模型：目录里有的东西需要细节时才查，不要每轮都查。

写回（消息驱动 + 定时）：

- 每轮结束：若模型调过 `state_update` / `overlay_write` / memory 工具，直接落库。
- 每 N 轮（默认 12）或切出 App 时：用 `claude-haiku-5-5` 跑一次合并，输入是上次合并后的消息，输出结构化 JSON：新增情节记忆（带 importance）、状态变化、世界覆盖候选。覆盖候选默认需要用户确认（通知条一键采纳），避免模型瞎改世界。
- 情节记忆超过 200 条时，对 importance=1 的做二次合并（十条并一条）。

**尾部指令**：`position: 'tail'` 的常驻风格条目不进 system，放在最后一条用户消息里、时间行之前。模型对最后几百字最敏感，管输出格式和口吻放这里。

**章节分隔**：推进时间先强制整理记忆，再写一条带 `meta.chapter` 的旁白。拼装时最近一次分隔点之前只保留几条原话衔接（`chapterTail`，默认 6），之前的事靠记忆而不是复读，防止模型抓着旧梗不放。

### 5.7 Theme

- 所有颜色、圆角、字体、间距、阴影都是 CSS 变量，定义在 `kernel/theme/tokens.css`，分深浅两套。
- 主题包 = 插件，提供 `tokens`（必填）、`wallpaper`、`iconStyle`、`bubbleStyle`、可选 `customCss`（默认禁用，设置里手动开）。
- 组件库只读变量，不写死颜色。违反的 PR 不合。

### 5.8 Scheduler

- 前台：`setInterval` 包一层，页面不可见时暂停，可见时恢复。
- 补发：`app.resumed(elapsedMs)` 事件带上离开时长，插件自行决定补什么（朋友圈插件可能补一条动态，日记插件可能补一篇日记）。补发生成的消息 `inWorldTs` 设为应该发生的时间。
- 补发有预算：一次最多补 3 条，避免离开三天回来被刷屏和烧钱。

### 5.9 Importers

- 角色卡：PNG 内嵌 `chara` 元数据（V2/V3）和纯 JSON。导入时拆成 `core`（description 的前 800 token，或让模型压一版，用户确认）和 `full`。
- 世界书：SillyTavern lorebook JSON，字段映射到 `LoreEntry`，`scope` 默认 world，导入后可批量改。
- 预设（风格包）：酒馆聊天补全预设的 `prompts[]` 按 `prompt_order` 取文字段落，marker 段跳过，`injection_position=1` 的放尾部，其余放 system；采样参数不要。导入前逐段扫描、可开关可改，入库成一组 `kind: 'style'`、`preset: 名字` 的常驻条目，整包开关、导出（本应用格式可再导入）。

### 5.10 分享卡与联网

角色在聊天里"分享一个东西"（歌、电影、新闻、链接）走同一条路，不按类型各写一套：

- 内核工具 `share({ type, title, subtitle?, quote?, note? })`。`type` 是大类（music / movie / book / news / link），由已启用插件声明的**分享解析器**决定可选值，没有解析器的类型不出现在 schema 里。
- 插件用 `shares: [{ type, label, hint, resolve(query) }]` 注册解析器。解析器负责查资料，返回两样东西：给模型看的文本（真实资料，比如完整歌词）和给用户看的卡片 `ShareCard`。
- `ShareCard` 是通用结构：`type / subtype / title / subtitle / cover / links / quote / excerpt / preview / source`。聊天插件只认这一种卡片，渲染时按字段有无决定显示什么（有 preview 就出播放键，有 cover 就出封面）。类型私有的东西放 `subtype` 和 `extra`，不加新卡片组件。
- 查找顺序固定：用户手动维护的本地库（最高优先，可以没有）→ 插件在浏览器里直接请求免费接口（不经过模型，不花 token）→ 都没有时告诉模型"没查到，不要编"，模型若被允许上网可再用 `web_search`。
- `quote` 是防幻觉点：模型想引用的那句必须在解析器查到的原文里出现，否则丢掉并告诉模型。歌词、台词、新闻原话都走这条规则。
- 音乐解析器（`plugins/music`）：iTunes Search 拿封面、试听、链接；LRCLIB 拿歌词。两个都免费、无 Key、允许跨域。
- **用户这边**：聊天输入框「+」面板，项由插件 `composerActions` 登记（歌曲、红包…）。面板组件产出一条 `OutgoingMessage`：`text` 给模型看（如「[分享了一首歌：《晴天》- 周杰伦] 歌词开头…」），`cards` 给人看，`cardOnly` 时不显示文字气泡。插件工具也能通过 `ctx.addCard(tag, body, attrs?, alt?)` 往回复里放卡片，由本插件 `outputHandlers` 同名 tag 的组件渲染。
- **卡片的 `alt`**：每张卡片带一句文字版（「[发了一个红包：¥8.88，留言「生日快乐」]」），分享卡由内核按解析器 `label` 自动生成。拼历史用 `modelTextOf`（正文 + alt），只有卡片的回复也进历史，否则角色下一轮不记得自己发过；聊天列表预览用 `previewOf`。用户 `cardOnly` 消息的 `text` 本身就是给模型的，alt 只用于预览。
- **角色主页**（`characters` 插件的 `profile` 页）：这一局里的他。名字、头像只读角色卡；状态 / 地点 / 和你直接显示 `CampaignState`（`mood` / `location` / `relations`），不加字段；页面标出「世界 · 存档」，让存档概念可见。插件用 `profileSections: [{ id, label?, component }]` 往主页挂段，组件拿到 `{ campaignId, characterId }` 自己读自己的表（钱包挂余额，朋友圈挂最近一条）。聊天页点头像和角色列表都进这里；编辑角色卡从主页底部进。
- **钱包**（`redpacket` 插件，内核不认识钱）：按存档分，表 `wallets` 主键 `${campaignId}:${ownerId}`，ownerId 是 `user` 或角色 id。他发红包从他的余额扣，不够工具直接拒绝；你领了进你这局的钱包，反之亦然。余额进 volatile 提示词。初始余额有默认值，主页钱包段里手改。
- 聊天页样式在外观里切：iOS 信息 / 微信（绿白气泡、灰底、两边头像）。只是样式，功能一样。

联网：设置里的"允许角色上网"开关对应 Anthropic 服务端的 `web_search` / `web_fetch` 工具。搜索由 Anthropic 执行，按次计费（每次搜索 $0.01，另加搜到内容占的 token），计入用量。默认关。每轮各最多 3 次。

### 5.11 补发（离开一段时间回来，角色"拿起手机"）

插件不再各自监听 `app.resumed` 调模型。内核统一做：

- **按角色计时**：每个存档的 `lastPlayedAt`（上次和他互动）和 `catchupAt`（上次补发）取大者，到现在的间隔决定档位。你天天聊 A、三天没碰 B，回来时只有 B 是三天没见的反应。
- **三个档位**：`h6`（≥ 6 小时）、`d1`（≥ 24 小时）、`days`（≥ 2 天，把天数传过去）。高档包含低档。阈值先写死，见 TODO。
- **依附档 `attach`**：本身不触发（评论不吵他），挂在这个角色**下一次模型调用**上，聊天回复或补发哪个先来算哪个。聊天时材料进最后一条用户消息，模型用稳定的 `handle_attached` 工具按 key 提交；补发时和其他段一起进 JSON。回评论挂在这里："你一发消息他就拿起手机了，顺手把评论也回了"。
- **插件登记**：`catchup: [{ id, tier, collect(ctx) }]`。`collect` 返回要处理的事：给模型看的材料和任务（`label` + `prompt`）、这一段的 JSON schema、模型答完怎么落库（`apply`）。返回 null 表示这次没事。
- **一个角色一次调用**：内核把该角色所有插件的事拼成一次请求（角色设定 + 近期记忆 + 各段任务），要求按 JSON 分段返回，再把每段交回对应插件的 `apply`。主模型、effort 低，走预览开关。
- **模型可以说"不用"**：每段 schema 自己定义"不做"的表达（不发、回复留空）。回评论被跳过的那条打标记，以后不再拿出来。
- **预算**：一次回来最多处理 3 个角色，按最近玩过的排序。

## 6. 聊天插件（内核级）

它是第一个插件，也是插件接口的试金石。做到这些：

- 对话列表、对话页、流式气泡、"正在输入"状态（工具调用时显示具体在干什么）。
- 长按消息：重新生成、编辑、删除、从此处分叉。
- 消息里的插件卡片由注册的 `outputHandlers` 渲染，聊天插件本身不认识任何标签。
- 群聊：多角色轮流，由拼装器按 `participantIds` 切换 core 和视角。

## 7. 插件接口

```ts
export default definePlugin({
  id: 'moments', name: '朋友圈', version: '0.1.0',
  icon: MomentsIcon,
  // 桌面与 Dock
  app?: { screen: Component, badge?: () => number },
  shortcuts?: Shortcut[],
  // 上下文
  promptContributors?: PromptContributor[],   // {stable: () => string, volatile: (ctx) => string}
  loreTriggers?: LoreTrigger[],               // 额外的 L1 规则
  tools?: ToolDef[],                          // L2 工具，带 handler
  outputHandlers?: OutputHandler[],           // 解析 <moment>…</moment> 并渲染卡片
  shares?: ShareResolver[],                   // 分享解析器：share 工具按 type 分发到这里
  catchup?: CatchupContributor[],             // 补发登记：离开一段时间回来，内核按档位统一调模型
  composerActions?: ComposerAction[],         // 聊天输入框「+」面板里的项：用户主动发东西（歌、红包…）
  profileSections?: ProfileSection[],         // 角色主页上挂的段：按存档读自己的表（钱包余额、最近一条朋友圈…）
  // 数据与事件
  storage?: { tables: Record<string, string> },
  onEvent?: Partial<EventHandlers>,
  // 生命周期
  setup?(ctx: PluginContext): void | Promise<void>,
  teardown?(): void,
  // 设置页
  settings?: SettingsSchema,
})
```

`PluginContext` 暴露：`db`（限本插件表 + 只读内核表）、`bus`、`llm`（带配额记账）、`ui`（组件库、notify、navigate）、`campaign`（当前存档的只读视图）、`memory`（写情节记忆的受限接口）。

插件不能：直接 fetch 模型 API（必须走 `ctx.llm`）、读 API Key、改其他插件的表、改正典世界书。

## 8. 视觉约束

- 一套组件库：列表、单元格、气泡、卡片、输入条、弹层、底部动作表、开关、分段控件。插件只能拼。
- 深浅模式都必须过。
- 具体风格等参考图定了再做，这里只定约束。

## 9. 里程碑

| 里程碑 | 内容 | 验收 |
|---|---|---|
| M0 骨架 | Vite + Svelte + TS + Tailwind + Dexie + PWA；内核各模块的空壳和接口；注册表能装卸插件；Shell 能显示图标和 Dock | 空手机能跑，GitHub Pages 能打开 |
| M1 聊天闭环 | Claude 适配器（流式、缓存、计费）、聊天插件、角色和世界的最小管理页、角色卡导入 | 导入一张卡能聊，设置页能看到缓存命中率 |
| M2 记忆 | L0/L1/L2 全部、工具循环、写回、合并任务、覆盖层、memory 工具 | 聊 50 轮后切出再回来，角色记得关键事；换角色玩同一世界互不影响 |
| M3 插件示范 | 朋友圈、日记、微信换皮；补发机制 | 开关插件桌面随之变化；离开一天回来有补发 |
| M4 主题与导入 | 主题引擎、两套内置主题、ST 世界书导入、导入导出整库 | 换主题全局生效；ST 的世界书能原样进来 |
| M5 开放 | 从 URL 加载插件、插件商店页、Gemini / OpenAI 适配器 | 第三方能写一个插件装进来 |

每个里程碑一个 PR，合并前跑类型检查和单元测试（拼装器、L1 触发、覆盖优先规则必须有测试）。

## 10. 待定问题

- 存档的 UI 心智：用户看到的是"角色"还是"存档"？倾向于默认隐藏存档概念，一角色一存档，高级用户在角色页里开"新开一局"。
- 群聊时多个角色的 core 都进 L0，4 个角色就 3k token，可接受；超过 6 个要考虑只放在场角色。
- 覆盖候选是否默认需要确认，先做成设置项，默认需要。
- 补发的内容由谁生成：主模型还是 Haiku？倾向主模型，因为是用户会看到的剧情；合并任务才用 Haiku。
