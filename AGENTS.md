# 项目指引

## 设计规范

UI 设计、实现和验收前，先读取 [.agents/design-principles.md](.agents/design-principles.md) 中适用的原则与检查项。源码结构、构建发布和测试流程见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

反馈或验收证据出现时，使用 $learn-design-principles 区分执行偏差、规范缺口与新的设计决策。对有依据且可复用的规范缺口，维护 `.agents/design-principles.md` 的对应段落；已有覆盖时直接回用，涉及方向改变时先说明取舍并解决冲突。

## 本地调试交付

需要交付本地调试版本时，运行 `npm run package:dev`，同时生成 ZIP 并更新固定插件目录 `artifacts/unpacked/`。用户从该目录加载扩展后，只需在 Chrome 中重新加载。不要仅提供临时 ZIP 而遗漏目录更新。
