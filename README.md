# Hair Formula

染发配色模拟器 —— 基于光谱的颜色预测，不是 RGB 调色游戏。
执行基准见 [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md)。

## 结构

```text
apps/web                 React + Vite + Tailwind v4，纯前端 UI
packages/color-science   光谱引擎：spectrum / K-M / XYZ / Lab / ΔE00 / sRGB
docs/MASTER_PLAN.md      单一执行基准（Single Source of Truth）
```

## 常用命令

```bash
pnpm install
pnpm dev          # 启动 web (http://localhost:5173)
pnpm test         # 所有包的测试
pnpm typecheck    # 所有包的类型检查
pnpm build        # 构建 web
```

## 开发顺序

严格按 MASTER_PLAN §17：先把 `packages/color-science` 的转换与 K-M
引擎用单元测试跑通，再接 UI。当前 UI 为骨架占位，引擎尚未接入。
