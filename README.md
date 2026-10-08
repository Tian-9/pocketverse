# Pocketverse

跑在浏览器里的插件化"小手机"，用于 AI 角色扮演。无服务器，纯 PWA。

- 设计基线：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 状态：M2 完成。三层记忆（常驻目录 / 触发词 / 模型按需检索）、工具循环、Claude memory 工具、Haiku 记忆整理、世界书导入与本局覆盖。M3 进行中：朋友圈插件（对话里发、工具发、离开后补发、点赞评论注入提示词）已完成，日记和微信换皮待做。

## 开发

```bash
npm install
npm run dev      # 本地预览，桌面浏览器会显示手机外框
npm run lint     # 类型检查 + 单元测试
npm run build    # 产物在 dist/
```

推到 main 会自动部署到 GitHub Pages（需在仓库 Settings → Pages 里把 Source 设为 GitHub Actions）。

核心思路：微内核 + 插件 + 三层记忆（常驻摘要 / 关键词触发 / 模型按需检索），世界书只读正典，玩出来的变化以"覆盖层"形式跟随存档。
