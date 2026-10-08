# Pocketverse

跑在浏览器里的插件化"小手机"，用于 AI 角色扮演。无服务器，纯 PWA。

- 设计基线：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 状态：M0 骨架完成（内核模块、插件注册表、Shell、Dock、主题明暗）。M1 接 Claude。

## 开发

```bash
npm install
npm run dev      # 本地预览，桌面浏览器会显示手机外框
npm run lint     # 类型检查 + 单元测试
npm run build    # 产物在 dist/
```

推到 main 会自动部署到 GitHub Pages（需在仓库 Settings → Pages 里把 Source 设为 GitHub Actions）。

核心思路：微内核 + 插件 + 三层记忆（常驻摘要 / 关键词触发 / 模型按需检索），世界书只读正典，玩出来的变化以"覆盖层"形式跟随存档。
