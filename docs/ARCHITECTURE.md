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
| 检索与状态 | [annals](https://github.com/Tian-9/annals) | 自研零依赖库：事件日志、折叠视图、分档词袋倒排索引。世界书按正文分词检索，记忆用整理时模型给的词袋；硬事实走状态事件 |
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
      calendar/          他的日程：挂在存档时钟上，按周自动排
      theme-*/           主题包也是插件
    app.ts               启动：加载内核 → 注册内置插件 → 挂载 shell
  public/                图标、manifest
```

规则：`plugins/*` 只能 import `kernel/api`（公开接口），不能 import 内核内部模块，也不能互相 import。插件间通信走事件总线（通知）或 `services`（要返回值的，如扣钱）。

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
  timeZone?: string;                // 他所在的时区（IANA 名）。默认不填＝和你用同一个时间；出远门才填，时间行里多给一个"他那边几点"
  place?: Place;                    // 他在哪座城市（data/place.ts）。不填＝和你在同一个地方；选了城市 timeZone 跟着填。时区、天气都从位置派生
  voice?: Record<string, unknown>;  // 插件自定义字段（口癖、语音等）
}

// 位置：城市级，够算时区和天气。角色卡的「他在哪座城市」和设置里的「你在哪座城市」（KV kernel.userPlace，代码默认伦敦）都是它。
// 地理编码走 Open-Meteo（自带时区），定位走浏览器 Geolocation，坐标只留两位小数。插件读位置走 ctx.data（character().place / userPlace()），选城市用 PlacePicker。
interface Place { name: string; lat: number; lon: number; timeZone: string }

// 存档：一个世界 + 一组角色 的一次"游玩"，记忆的拥有者。
// 每张卡有一个「当前这一局」（kv `kernel.currentCampaign.<characterId>`），聊天、主页、补发、朋友圈只看它；别的局先睡着，主页上能切换或新开。
interface Campaign {
  id: string; worldId: string; characterIds: string[];
  name: string; createdAt: number; lastPlayedAt: number;
  state: CampaignState;                        // 当前状态，进 L0
  userPersona?: string;                        // 你在这局里是谁（修仙世界里是师弟，校园里是同桌），进 system 的「对方」段；没有就只用全局画像
  userName?: string;                           // 你在这局叫什么，留空＝设置里的名字（repo.userNameOf）。{{user}} 在这一局里都换成它
  // 「对方」在库里统一存成 {{user}}（context/userref.ts）：模型写的记忆、状态、硬事实、世界变化，存库前把这一局的名字和「用户」换成占位符；
  // 发给模型（assemble 末尾统一展开、工具结果 expandForModel、补发、整理）和显示（主页、ctx.data）时再换成这一局的名字。改名后旧内容自动跟着变。
  // 内置规则里也不写「用户」，写 {{user}}。名字太短（默认的「我」）不做名字替换，只换「用户」。v8 迁移把老数据换了一遍。
  clock?: CampaignClock;                       // 存档时钟：这局「现在几点」。没有＝和真实时间一样
}
// 存档时钟（context/clock.ts，设计见 designs/clock-and-calendar.md）：剧情时刻是普通毫秒时间戳，显示时套角色时区。
// now = running ? anchorStoryTs + (真实现在 - anchorRealTs) : anchorStoryTs。走表：剧情时间随真实时间流逝；停表：只有推进才动。
// 谁能动：用户（聊天页「推进时间」、主页「这局的时间」，新开一局可选起始日期）；模型（state_update 的 advance，只往前、一次 ≤ 24 小时）。
// 每条消息盖 storyTs；插件要「现在几点」拿 ctx.data / PromptContext 里的 now，不自己 Date.now()。插件自己落的东西（帖子、订单、动态、日程）也盖 storyTs，「刚发过」「最近两天」和显示都按它。
// 「哪一天」「几点」按角色的时区（Character.timeZone，CampaignView / CharacterView 上也有）：clock.dateKey / formatTime / zoned(dateKey, 'HH:MM', tz) / dayRange，别自己 new Date(y, m, d)。
interface CampaignClock { anchorStoryTs: number; anchorRealTs: number; running: boolean }
interface CampaignState {
  location?: string;
  relations: Record<string, string>;           // characterId -> 一句话关系
  mood: Record<string, string>;                // characterId -> 一句话情绪
  facts: string[];                             // 老的自由文本事实，只剩手改入口；新的硬事实走 events 表（下面）
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
  storyTs?: number;          // 这条消息时的剧情时刻（存档时钟），没时钟的局等于 ts；聊天页分隔线按它
  tokens?: number;
}
```

### 4.1 记忆模型（重点）

记忆全部挂在**存档**下，不挂世界，不挂角色本体。同一个世界换角色玩，是新存档，记忆为空。同一个角色在同一世界重开一局，也是新存档。

```ts
// 硬事实：annals 状态事件，表 events，scope = campaignId。谁欠谁、东西在哪、归谁、承诺——这类有方向、有数额的事
// 不让模型从历史里推，由代码折叠成视图每轮注入（「当前事实」）。模型只给 {entity, attr, value}，旧值代码从视图取，
// 没变的丢；每条带 source：整理挂那批最后一条消息 id，聊天里 state_update 挂这一轮的 turnId（回复的 meta.turn），手改是 manual。
// 删消息、重新生成按 source 撤回，视图自动退回；手改清除是写一条空值，历史不丢。注入最多 20 条，按最近写入淘汰。
// 类型和折叠函数在 annals/airp，存取在 kernel/memory/state.ts。

// 情节记忆：发生过什么
interface EpisodicMemory {
  id: string; campaignId: string;
  characterId?: string;        // 哪个角色视角，空表示旁白
  when: string;                // 剧情时间
  text: string;                // 一两句话
  importance: 1 | 2 | 3;       // 3 = 进 L0 的"近期要事"候选
  sourceMessageIds: string[];
  createdAt: number;
  bag?: Bag;                   // 整理时模型给的检索词袋（annals 三档 core/related/hint）；老记忆没有就按正文分词
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
- **模型分三档**（`llm/roles.ts`）：请求按用途归档，每档在设置里选一个模型和一个思考深度。`chat` 对话档（`chat`、`catchup`、插件默认调用；默认 Opus 5.5 / medium）吃缓存，贵模型命中缓存可能比便宜模型没命中还便宜；`consolidate` 整理档（记忆合并；默认 Haiku 5.5 / low）和 `bulk` 批量档（插件 `cheap: true`：论坛路人、货架、搜索、日程；默认 Haiku 5.5 / low）都是一次性输入。网关按 `req.role ?? roleOf(purpose)` 填 `model` 和 `effort`，调用方不写死模型名，也不写死 effort（显式给 `effort` 才覆盖档位设置）。模型升级只改 `DEFAULT_MODELS`。老设置的单个 `model` / `effort` 迁移成对话档。
- 模型列表从 API 拉（`client.models.list()`，只有 id 和名字），存 KV，拉不到用 `pricing.ts` 的内置表兜底。价格 API 不给，`PRICES` 表继续维护，只用来记账；表里没有的模型照样能选，标「价格未知」，用量按 $0 记。
- adaptive thinking，效果用 `output_config.effort` 控。`max_tokens` 只是上限不是花费，留小了只会截断，所以网关统一算：正文预算取调用方给的和默认 4096 之中大的，再按 effort 加一截思考额度（`THINKING_ROOM`，低 1k 到最高 16k；思考和正文共用 `max_tokens`），最后按 API 列表里该模型的上限夹住。调用方的 `maxTokens` 只在要得更多时（货架 16k）才有意义。流式输出。
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
[system]     place 'cached'：又大又几乎不变的        ← 缓存断点 1
  100 全局规则（输出格式、禁止事项，固定文本）
  150 常驻写作风格
  200 对方（这局的名字 + 这局里你是谁 `userPersona` + 全局画像）
  300 世界摘要
  400 在场角色的 core
  500 世界书（常驻）
  600 世界书目录（title + summary，带覆盖标注）
  700 他的笔记 /memories 正文（memory 工具维护的文件，单文件 1500 字、总共 4000 字以内，超了截断并提示用工具看全文。最长 4000 字、只在他写笔记时变：放尾巴每轮全价太贵，留在缓存里）
  800 插件 promptContributors 的 stable（默认）
[messages]
  历史消息（最近 N 条原文，更早的由压缩块代替）  ← 缓存断点 2
  最后一条用户消息，place 'tail'：会变的（不管多久一次），每轮重算，不存进历史：
    100 当前状态（地点、关系、情绪、硬事实、老事实）。几轮一变，放 system 的话一变整段历史缓存作废
    150 近期要事（importance=3 的情节记忆，最近 10 条）
    200 L1 命中的风格 / 300 L1 命中的世界书正文（按条目 order 排序）
    400 自动召回 `<可能相关的往事>`：用你这一轮说的话（他上次回复之后的所有用户消息）在情节记忆里搜，annals 分档词袋 + 倒排，不调模型；已在「近期要事」里的跳过，最多 3 条，分数低于 1 的不要（memory/recall.ts）
    500 插件 promptContributors 的 volatile（默认），稍后联系、顺手处理的事
    800 尾部指令（position: tail 的常驻风格）
    900 时间那一行：存档时钟的「现在」（`context/time.ts`）。钟和真实时间对不上（跳过了、停表）就标「剧情时间」；角色设了别的时区就多一句"你在 Asia/Tokyo，那边是 …"
    用户输入（聊天引擎先存进历史再拼，所以它就是历史里最后那条；拼装器把上面几段插在它前面，他最后读到的是对方刚说的话）
```

**段的统一登记**：上面每一项都是一个 `PromptSection { id, place, order, text }`（`context/assemble.ts`）。拼装器只做一件事：收集内核的段和外面给的段（插件 promptContributors、稍后联系、顺手处理的事），按 place 分两组，组内按 order 排（同 order 保持登记顺序），拼起来。数字见 `ORDER`，留了空隙，插件用 `PromptContributor.order` 插到想要的位置。选 place 看「变一次的代价」而不是多久变一次：又大、又几乎不变的才放 cached；会变的一律 tail，每轮多付几百 token 也比变一次就重写整段历史便宜。`context/prefix.test.ts` 模拟连续两轮（中间状态、近期要事、插件易变段都变了），断言上一轮最后一个缓存断点之前的内容下一轮原样不动。

**追加段**（`context/append.ts`）：变得少的内容（钱包、他有的东西）不每轮在尾巴里全价重发。插件用 `PromptContributor.append` 返回这一段的完整快照（尖括号标签包着），引擎每轮算一次，和拼装窗口里最近一份不一样、或窗口里没有（推进时间截掉了、滑出 60 条）才写一条隐藏消息（role system + `meta.context`），排在你这一轮的话前面，之后跟着历史一起缓存。拼装时它当作用户侧内容进上下文，不参与 L1 扫描；聊天页、会话列表、整理、日记都看不到它。写的是完整快照不是变化量，规则里写明「同一种以最后出现的为准」，模型不用自己拼。导出是 dry run，只算不写。

**检索试验台**：角色主页「他记得什么」下面，输入一句话，列出自动召回会翻出哪些记忆、各多少分、靠哪些词命中、会不会召回（`memory/recall.ts` 的 `explainRecall`，和聊天时同一套索引和打分），点一条直接改词袋再试。

L1 触发：扫最近 K 条消息（默认 4）的文本，匹配 `triggers.keywords`（分词后整词匹配）和 `regex`；命中条目若 `recursive`，再用其正文做一轮匹配（最多递归 2 层）。总预算默认 4k token，按 `order` 截断。

L2 工具（内核提供）：

| 工具 | 说明 |
|---|---|
| `lore_search(query)` | BM25 搜当前存档作用域内的世界书 + 覆盖，返回 title/summary/id 列表 |
| `lore_read(id)` | 读正文，覆盖优先 |
| `memory_search(query, characterId?)` | 搜情节记忆：有词袋的按词袋（正文做弱提示），没有的按正文分词；查询端不调模型 |
| `memory_recent(n)` | 最近 n 条情节记忆 |
| `character_read(id)` | 读角色 full 人设 |
| `state_update(patch)` | 更新 CampaignState（关系、情绪、地点）；`set` 是硬事实的增量 patch（entity/attr/value，走状态事件，来源是这一轮）；`advance` 把剧情时间往前拨几分钟（≤ 一天，只往前，「明早见」之后接着说用） |
| `overlay_write(entry)` | 写一条世界覆盖 |
| `wake_later(afterMinutes, intent, onlyIfSilent?)` | 给自己定"稍后联系"：真实时间几分钟后拿起手机决定发不发消息（见 5.11）。一局只记一件，新的覆盖旧的 |

工具描述里明确告诉模型：目录里有的东西需要细节时才查，不要每轮都查。

写回（消息驱动 + 定时）：

- 每轮结束：若模型调过 `state_update` / `overlay_write` / memory 工具，直接落库。
- 每 N 条回复（默认 12）后检查一次，另外推进时间和手动整理时强制跑：用整理档模型（默认 Haiku 5.5）跑一次合并，输入是上次合并后的消息，输出结构化 JSON：新增情节记忆（带 importance 和检索词袋）、状态变化、硬事实 patch（来源挂这批最后一条消息）、世界覆盖候选。prompt 附带当前状态行和已有词表，要求复用词项。覆盖候选默认需要用户确认（通知条一键采纳），避免模型瞎改世界。回到桌面、刷新不触发合并：那种触发看不出原因，导入的旧记录也会被悄悄整理一遍。
- 情节记忆超过 200 条时，对 importance=1 的做二次合并（十条并一条）。

**尾部指令**：`position: 'tail'` 的常驻风格条目不进 system，放在最后一条用户消息里、时间行之前。模型对最后几百字最敏感，管输出格式和口吻放这里。

**上下文排查**：角色卡页「导出这一局的上下文」。聊天引擎每轮收集材料的那段是 `chat.prepare()`，真实发送和导出共用，导出的就是下一轮实际会发的请求（和发送前预览同一个 `render`），外加每样设定进了哪里、没进的原因（`context/report.ts`：常驻 / 目录 / L1 命中 / 超预算 / 没关键词永远不会进 / 只能靠工具读 / 不适用于这局）和原始设定 JSON。导出是 dry run：不收集「顺手处理的事」，不调模型。文件名只用 ASCII。

**章节分隔**：推进时间（用户在聊天页选一个时刻，快捷项按这局的钟算）先强制整理记忆，拨时钟，再写一条带 `meta.chapter` 的旁白。旁白不触发回复：它是用户侧的一条，和用户下一条消息并成一轮一起给模型（拼装时连着的用户消息合成一条），不然每次推进他都先说一段。拼装时最近一次分隔点之前只保留几条原话衔接（`chapterTail`，默认 6），之前的事靠记忆而不是复读，防止模型抓着旧梗不放。

### 5.7 Theme

- 所有颜色、圆角、字体、间距、阴影都是 CSS 变量，定义在 `kernel/theme/tokens.css`，分深浅两套。
- 主题包 = 插件，提供 `tokens`（必填）、`wallpaper`、`iconStyle`、`bubbleStyle`、可选 `customCss`（默认禁用，设置里手动开）。
- 组件库只读变量，不写死颜色。违反的 PR 不合。

### 5.8 Scheduler

- 前台：`setInterval` 包一层（`every`），页面不可见时暂停，可见时恢复；另有一次性的 `after`，给角色定的"稍后联系"用，同样切后台清掉、回前台重排。
- 补发：`app.resumed(elapsedMs)` 事件带上离开时长，插件自行决定补什么（朋友圈插件可能补一条动态，日记插件可能补一篇日记）。补发生成的消息 `storyTs` 设为应该发生的时间。
- 补发有预算：一次最多补 3 条，避免离开三天回来被刷屏和烧钱。
- 前台开着的时候也每小时查一次补发（`catchup.TICK`），不然网页挂一天谁也不会动；切到后台定时器清掉，回到前台先补一次再重新上表。

### 5.9 Importers

- 角色卡：PNG 内嵌 `chara` 元数据（V2/V3）和纯 JSON。导入时拆成 `core`（description 的前 800 token，或让模型压一版，用户确认）和 `full`。
- 世界书：SillyTavern lorebook JSON，字段映射到 `LoreEntry`，`scope` 默认 world，导入后可批量改。
- 预设（风格包）：酒馆聊天补全预设的 `prompts[]` 按 `prompt_order` 取文字段落，marker 段跳过，`injection_position=1` 的放尾部，其余放 system；采样参数不要。导入前逐段扫描、可开关可改，入库成一组 `kind: 'style'`、`preset: 名字` 的常驻条目，整包开关、导出（本应用格式可再导入）。

### 5.10 分享卡与联网

角色在聊天里"分享一个东西"（歌、电影、新闻、链接）走同一条路，不按类型各写一套：

- 内核工具 `share({ type, title, subtitle?, quote?, note? })`。`type` 是大类（music / movie / book / news / link），由已启用插件声明的**分享解析器**决定可选值，没有解析器的类型不出现在 schema 里。
- 插件用 `shares: [{ type, label, hint, resolve(query, ctx) }]` 注册解析器，`ctx` 带当前存档和在场角色（按存档存的东西，如论坛帖子，靠它找）。解析器负责查资料，返回两样东西：给模型看的文本（真实资料，比如完整歌词）和给用户看的卡片 `ShareCard`。查不到又不该编的（本地帖子）直接 throw，错误信息原样回给模型。
- `ShareCard` 是通用结构：`type / subtype / title / subtitle / cover / links / quote / excerpt / preview / source / open`。聊天插件只认这一种卡片，渲染时按字段有无决定显示什么（有 preview 就出播放键，有 cover 就出封面，有 `open` 点卡片就 `nav.push` 过去）。类型私有的东西放 `subtype` 和 `extra`，不加新卡片组件。
- 查找顺序固定：用户手动维护的本地库（最高优先，可以没有）→ 插件在浏览器里直接请求免费接口（不经过模型，不花 token）→ 都没有时告诉模型"没查到，不要编"，模型若被允许上网可再用 `web_search`。
- `quote` 是防幻觉点：模型想引用的那句必须在解析器查到的原文里出现，否则丢掉并告诉模型。歌词、台词、新闻原话都走这条规则。
- 音乐解析器（`plugins/music`）：iTunes Search 拿封面、试听、链接；LRCLIB 拿歌词。两个都免费、无 Key、允许跨域。
- **用户这边**：聊天输入框「+」面板，项由插件 `composerActions` 登记（歌曲、红包…）。面板组件产出一条 `OutgoingMessage`：`text` 给模型看（如「[分享了一首歌：《晴天》- 周杰伦] 歌词开头…」），`cards` 给人看，`cardOnly` 时不显示文字气泡；`note` 是用户随卡片说的一句（像微信转发时的留言），内核统一处理：界面上卡片下面单独一个气泡（`meta.note`），模型在 `text` 后面看到「并说：「…」」（`withNote`），面板组件只负责收一个「留言」框，不自己拼。插件工具也能通过 `ctx.addCard(tag, body, attrs?, alt?)` 往回复里放卡片，由本插件 `outputHandlers` 同名 tag 的组件渲染。
- **卡片的 `alt`**：每张卡片带一句文字版（「[发了一个红包：¥8.88，留言「生日快乐」]」），分享卡由内核按解析器 `label` 自动生成。拼历史用 `modelTextOf`（正文 + alt），只有卡片的回复也进历史，否则角色下一轮不记得自己发过；聊天列表预览用 `previewOf`。用户 `cardOnly` 消息的 `text` 本身就是给模型的，alt 只用于预览。
- **消息动作**（聊天插件，不是卡片）：引用是长按菜单，把被引那句的截断存进 `meta.quote { id, role, text }`，原消息删了也照样显示，`modelTextOf` 在正文前加「（引用你的话「…」）」。撤回和拍一拍是「+」面板里的事件：发出去就是一行小灰字（`OutgoingMessage.narration` 是界面那行，`text` 是给模型看的，存成 `meta.narration + meta.modelText`），他照常回复。长按撤回已去掉：发出去他就看了，没戏可演。拍一拍的后缀（「拍了拍他的小脑袋」）存 `CampaignState.nudge[characterId]`，他用 `state_update` 自己定，主页能改；他拍你走内核工具 `nudge`，工具把事件推进 `ToolContext.events`，引擎在回复前写成一行「他拍了拍你」。
- **转账**归红包插件（界面上叫「钱包」），和红包同一张表、同一套钱包，`kind: 'transfer'` 区分。红包是送礼：金额藏着，拆了才到账；转账是付钱：金额明摆着，收款才到账，还能退（`refundedAt`，钱回发的人）。你转给他的，他回复完自动收下，回复中途可用 `transfer_refund` 退回；他转给你的，卡片上点「收款」或「退还」。
- **角色主页**（`characters` 插件的 `profile` 页）：这一局里的他。名字、头像只读角色卡；状态 / 地点 / 和你直接显示 `CampaignState`（`mood` / `location` / `relations`），不加字段；页面标出「世界 · 存档」，让存档概念可见。插件用 `profileSections: [{ id, label?, component }]` 往主页挂段，组件拿到 `{ campaignId, characterId }` 自己读自己的表（钱包挂余额，朋友圈挂最近一条）。聊天页点头像和角色列表都进这里；编辑角色卡从主页底部进。
- **钱包**（`redpacket` 插件，内核不认识钱）：按存档分，表 `wallets` 主键 `${campaignId}:${ownerId}`，ownerId 是 `user` 或角色 id。他发红包从他的余额扣，不够工具直接拒绝；你领了进你这局的钱包，反之亦然。余额进 volatile 提示词。初始余额有默认值，主页钱包段里手改。
- 聊天页样式在外观里切：iOS 信息 / 微信（绿白气泡、灰底、两边头像）。只是样式，功能一样。

- **商店**（`shop` 插件，内核不认识商品）：一局一家店，货架是便宜模型按世界生成的（首次打开进货，分类能换一批，搜索本地没有就现编几件存起来），和论坛路人同一个办法。买东西的钱走 `services` 里的 `wallet`，钱包没开只能看、只能分享。商品分享走 `product` 解析器 + 通用分享卡；送礼（你送他、他送你）也是同一张卡，`subtype: 'gift'`，留言借 `quote` 行显示，送出去就到了，没有「收下」。他有的东西（他买的 + 你送的）是状态，走追加段（变了才写进历史，见下面「追加段」），主页「他的东西」段和它是同一个查询；你给自己买的他默认不知道。不买重复：货架和搜索结果里他已有的标「（你已经有了）」，给自己买已有的直接拦下（送对方不拦），补发逛商店时已有的不摆出来；「已有」按商品 id 和名字都认（店家现找的同名商品是新 id），不靠他记得（「你有的东西」只列最近 12 件）。

- **天气**（`weather` 插件，内核不认识天气）：照时区那套——他没选城市就和你在同一个地方。你那边的位置在设置里（和名字一起），他那边的在角色卡上；两边天气各查一次（同一个地方只查一次），Open-Meteo 免费无 Key，浏览器直接请求，30 分钟缓存，查不到就沉默。只在这局的钟和真实时间对齐（`CampaignView.aligned`）时给：易变段一句「你们这边现在：伦敦，多云，18°C；今天 12～21°C」或「你那边现在：东京，晴，22°C；对方那边：伦敦，多云，18°C，今天可能下雨」，约 60～80 token，不进 system。工具 `weather_forecast`（未来 7 天逐日，`whose` 选哪边）。服务 `weather.line(campaignId, characterId)` 给日记、朋友圈以后用。天气 App 显示你那边的现在和这几天，选了别的城市的角色列在「他们那边」。
- **日历**（`calendar` 插件，内核不认识日程）：挂在存档时钟上的事件表 `events`（`owner` 是角色 id 或 `user`，`source` plan / chat / manual，`status` planned / done / skipped）。他的日历只记「特别的事」，不是作息表（2026-10 定，AIRP 里排满的上课和辅导会把剧情挤没）：便宜模型按周排（`plan.ts`，和商店进货同一个办法），工作日不写上班上课吃饭这类固定作息，只在有生日、节日、考试、约好的事时写一条；周末和节假日最多一两件，可以一件都不写。代码兜底 `shapePlan`：工作日滤掉作息、每天最多 1 条，周末最多 2 条。打开日历或聊天时发现往后「排过」的不足 3 天就补一周；排过哪几天单独记在插件设置 `planned.<campaignId>`（空着的日子也算排过，不然工作日每轮都重排）。规矩改了用 `PLAN_POLICY` 版本号：老版本排的、今天起还没过的模型排程清掉重排一次，聊天里约的、手填的、已经过去的不动。易变段一句「你今天的安排 … 现在正在 … 接下来 …」：今天没事、两天内也没事就整行不出现，作息让他按身份自己过。工具 `calendar_add`（聊天里约的事，`together` 时你的日历也一条）、`calendar_read`。补发登记 `passed`（h6）：这段时间排了的事做了没做，写回 `status` / `note`。服务 `calendar`（`today` / `between` / `next`）给聊天页「到下一个安排」和日记、朋友圈用：日记材料带那天他日历上的事（做没做、备注），朋友圈补发带这段时间排了的事，没开日历就没有这一段。日界和 HH:MM 都按他的时区。主页「他今天」段。日历里某一天「在聊天里推进到这天」走 `nav.push('chat', 'conversation', { campaignId, skipTo })`，聊天页带着时刻打开推进面板。

- **模型画的图（SVG）**：模型写的 SVG 只能经内核 `sanitizeSvg` 清洗再入库（白名单元素和属性，删脚本、事件、外链、`foreignObject`、`image`、`use`、`style`，超 8 KB 或解析失败返回 null），显示只走 `Picture` 组件或分享卡的 `cover`（`svgDataUrl`），都是图片元素，不内联进页面。图只给人看，不回给模型。商品小图随货架一次生成（`Product.svg`，可选，画不出就留空）；他画画是 `draw` 插件的一个工具，产出 `type: 'drawing'` 的分享卡。

联网：设置里的"允许角色上网"开关对应 Anthropic 服务端的 `web_search` / `web_fetch` 工具。搜索由 Anthropic 执行，按次计费（每次搜索 $0.01，另加搜到内容占的 token），计入用量。默认关。每轮各最多 3 次。

### 5.11 补发（离开一段时间回来，角色"拿起手机"）

插件不再各自监听 `app.resumed` 调模型。内核统一做：

- **按角色计时，按剧情钟算**：每个存档上次互动（`playedStoryTs`）和上次补发（`catchupStoryTs`）的剧情时刻取大者，到剧情此刻的间隔决定档位。走表的局就是真实时长（你天天聊 A、三天没碰 B，回来时只有 B 是三天没见的反应）；停表的局你不来他一秒没过，不补发。
- **跳过时间也是一段时间**：用户在聊天里推进时间，`advanceTime` 拨完钟、写旁白之前调 `catchup.skipped(from, to)`，按跳过的长度定档跑同一个 `runFor`：跳三天他发了朋友圈、写了日记、回了评论，然后写旁白，等你下一条消息再接话。`CatchupContext` 带 `from` / `to` / `now`（剧情时刻）和 `skipped`，插件用它们当「现在」，不用 `Date.now()`；日记跳过时只补最后一个完整的一天，没对话也写他自己过的日子。
- **三个档位**：`h6`（≥ 6 小时）、`d1`（≥ 24 小时）、`days`（≥ 2 天，把天数传过去）。高档包含低档。阈值先写死，见 TODO。
- **依附档 `attach`**：本身不触发（评论不吵他），挂在这个角色**下一次模型调用**上，聊天回复或补发哪个先来算哪个。聊天时材料进最后一条用户消息，模型用稳定的 `handle_attached` 工具按 key 提交；补发时和其他段一起进 JSON。回评论挂在这里："你一发消息他就拿起手机了，顺手把评论也回了"。
- **插件登记**：`catchup: [{ id, tier, collect(ctx) }]`。`collect` 返回要处理的事：给模型看的材料和任务（`label` + `prompt`）、这一段的 JSON schema、模型答完怎么落库（`apply`）。返回 null 表示这次没事。
- **一个角色一次调用**：内核把该角色所有插件的事拼成一次请求（角色设定 + 近期记忆 + 各段任务），要求按 JSON 分段返回，再把每段交回对应插件的 `apply`。主模型、effort 低，走预览开关。
- **模型可以说"不用"**：每段 schema 自己定义"不做"的表达（不发、回复留空）。回评论被跳过的那条打标记，以后不再拿出来。
- **预算**：一次回来最多处理 3 个角色，按最近玩过的排序。
- **触发时机**：回到前台（含冷启动）立刻查一次；前台开着每小时再查一次。查是免费的，只有到档才调模型。
- **稍后联系（角色自己定的）**：聊天里他用 `wake_later({ afterMinutes, intent, onlyIfSilent })` 给自己定一件事（"等我下班跟你说""没回就追一句"），存 kv `kernel.wake.<campaignId>`，一局一件。`fireAt` 是剧情时刻：走表的局和真实时间一样到点，停表的局用户一跳过它就到点。到点就是一次"拿起手机"：走同一个 `runFor`，`intent` 作为一段（字段 `kernel_wake`，schema `{ send, messages[] }`）和同时到档的插件的事拼成同一次调用；没到档时只带它和依附档。发出来的消息直接进私聊（`meta.wake`），顶部通知条提醒。`onlyIfSilent` 的，你一回消息就作废。分钟级的到点靠 `scheduler.after` 排一个一次性定时器（定了新的、跑完一轮、回到前台都重排），不另起轮询。聊天的易变段会告诉他"已经记下了"，免得每轮重定。

## 6. 聊天插件（内核级）

它是第一个插件，也是插件接口的试金石。做到这些：

- 对话列表、对话页、流式气泡、"正在输入"状态（工具调用时显示具体在干什么）。回复按行拆成几条（`splitReply`），流式时聊天页就用同一个函数边生成边分条显示；生成完一个事务写进库（`repo.addMessages`，ts 逐条加 1 毫秒保证顺序），不再人为隔开冒出来。列表刷新前留着最后一帧的气泡，交接不闪。
- 长按消息：重新生成、编辑、删除、从此处分叉。
- 消息里的插件卡片由注册的 `outputHandlers` 渲染，聊天插件本身不认识任何标签。
- 群聊（未实现，设计已定 2026-10-11）：**一次调用出所有在场角色的话**，不是每人一次。`participantIds` 的 core 全进 system，模型按带名字前缀的分段返回（`[名字] 一行一条`），拼装器拆成各自的消息。便宜，也更像真群聊（互相接话）。

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
  services?: Record<string, unknown>,         // 给别的插件用的服务，按名字取；插件不能互相 import，跨插件调东西只能走这里
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

`PluginContext` 暴露：`table`（限本插件表）、`data`（内核数据的只读视图：当前存档、存档状态、世界、角色卡、情节记忆、条目目录，返回快照）、`settings`（本插件 KV）、`emit`、`navigate` / `back`、`notify`、`llm`（带配额记账，`cheap: true` 走批量档，否则走对话档，模型和思考深度都按档位设置来；支持 `jsonSchema`）。

`ctx.service<T>(name)` 取别的插件登记的服务，提供它的插件没开就是 `undefined`，调用方要能退化（商店没钱包就只能看不能买）。服务的形状只写在提供方的 `index.ts` 里，不进 `$kernel/api`：内核不认识钱包是什么，调用方自己声明一个一样形状的最小接口。第一个服务是钱包插件的 `wallet`（`balance` / `charge` / `credit`，`charge` 不够钱返回 false、一分不动，不暴露裸的加减）。

`$kernel/api` 另外导出界面要用的 `live`（响应式查询）和 `nav`（只有 `push` / `pop` / `home`）。插件读内核数据只有 `ctx.data` 一条路；它没有的东西先加到它上面，不要去 import `storage/db`。

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
