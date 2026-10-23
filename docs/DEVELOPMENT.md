# 开发与维护

## 环境与命令

- Node.js 22+、npm；`.nvmrc` 指定 Node.js 24。
- Python 3：仅 `npm run package` 需要，使用标准库，无额外 Python 依赖。
- 本机 Google Chrome：浏览器回归和重建图标需要；普通构建使用已提交的 PNG，无需浏览器。
- `npm ci` 按锁文件安装开发和运行依赖。项目不使用工作区包、父目录模块、外部脚本或本地辅助进程。

| 命令 | 用途 |
| --- | --- |
| `npm run typecheck` | 严格 TypeScript 检查 |
| `npm run build` | 类型检查并生成根目录 JS |
| `npm run build:icons` | 从 SVG 母版生成图标 PNG |
| `npm test` | 构建并运行核心逻辑测试 |
| `npm run test:browser` | 构建并运行主浏览器回归、内容脚本恢复和最近标签页测试 |
| `node tests/theme-browser.cjs` | 已构建产物的首屏主题专项回归 |
| `npm run package` | 构建并生成 `artifacts/aside-<manifest版本>.zip` |

测试默认通过 Playwright 的 `chrome` channel 查找已安装的 Chrome。自定义路径示例：

```sh
CHROME_PATH="/path/to/chrome" npm run test:browser
```

浏览器回归使用较新的 Chrome 扩展调试接口，请使用当前稳定版 Chrome；它不是对最低声明版本 Chrome 120 的兼容性认证。无需安装 Playwright 自带的 Chromium。

## 构建与分发

根目录是未打包扩展的加载目录。`scripts/build.mjs` 先执行类型检查，再用 esbuild 打包模块和依赖；后台与界面使用 ESM，内容脚本单独打包为 IIFE。构建会清理根目录所有 `.js` 文件，因此源码和开发脚本必须放在 `src/`、`scripts/` 或 `tests/` 中。不要手工修改生成文件，也不要在浏览器回归运行期间重新构建。

`build.py` 使用明确的运行文件清单打包 JS、CSS、HTML、manifest、图标、语言资源和许可证。安装包不包含源码、依赖目录、测试、截图或本机配置。发布前同步 `manifest.json`、`package.json` 和锁文件中的版本。

品牌资源：`icons/icon.svg` 是标准母版，`icons/icon-small.svg` 用于 16/32px 光学校正版；`icons/brand-mark.svg` 是界面共用标记。修改母版后运行 `npm run build:icons` 并检查生成图标。

## 源码结构

| 文件 | 职责 |
| --- | --- |
| `src/app.ts`、`src/copy.ts`、`src/controls.ts` | 收藏与设置界面、双语文案和共享控件 |
| `style.css`、`themes.css` | 扩展页面样式与主题 |
| `src/popup.ts`、`popup.html`、`popup.css` | 浏览器入口弹窗 |
| `src/background.ts`、`src/store.ts`、`src/client.ts` | 权限、任务、受限存储及消息边界 |
| `src/providers.ts`、`src/model-spec.ts` | 各协议适配及模型推理能力契约 |
| `src/processor.ts`、`src/cache.ts`、`src/scheduler.ts` | 内容切分、缓存、共享任务与连接级并发 |
| `src/extract.ts`、`src/content.ts`、`content-*.css` | 网页提取、增量处理、隔离结果面板与原位译文 |
| `src/selection-tools.ts`、`src/result-content.ts` | 划词工具条状态和结果渲染 |
| `src/recent-tabs.ts` | 当前窗口最近标签页记录与切换 |
| `src/lights.ts`、`src/lights-*.ts` | 网页暗色模式、框架控制和本地图形修复 |
| `src/usage.ts`、`src/app.ts` | 服务上报用量的统一与显示 |
| `tests/` | 核心与隔离 Chrome 回归 |

内部 `pagework` 标识用于存储、DOM 和消息等既有契约，不因仓库更名而批量替换。

## 需要保持的实现约定

### 模型与协议

四种生成协议独立编码请求及读取流式事件，不因错误自动猜测或切换协议。模型列表来自所选服务，推理能力由本仓库 `src/model-spec.ts` 管理；已知型号使用明确 ID/别名和能力，未知型号使用服务默认，不按系列名称推断。UI 选项、保存校验、请求编码与缓存身份必须保持一致。维护时核对该文件记录的官方来源，并更新 `tests/reasoning.mjs` 和对应浏览器回归。

服务端前缀缓存与本地结果缓存是两个不同机制。协议适配将稳定指令与变化正文分离；推理参数、协议和模型参与本地缓存身份。服务端是否命中以及用量字段是否完整取决于服务响应；不要把缺失值当成零，或把缓存细分 token 重复计入总量。

### 网页处理与取消

页内逐段翻译使用可见区域加上下各 600px 预加载，滚动和 DOM 变化增量调度；原文被编辑时丢弃旧版本结果。插件自己的结果节点不参与重复提取。整页结果面板、总结和提炼要点仍处理全文。

原文节点和事件保留，恢复原文会移除结果及插件的布局调整。相同任务可共享请求，同一连接共用并发额度；只有所有订阅者都取消才中止共享上游请求。完整有效的结果才进入缓存，手动重新生成绕过缓存；不引入静默重试。

内容脚本处理扩展重载后的失效上下文，后台与页面消息客户端应共用既有错误处理。不要把消息通道断开误报成服务商返回错误。

### 数据与渲染

密钥仅保存在后台受限存储中，内容脚本只获得不含密钥的配置快照。模型返回的 Markdown 经 Marked 和 DOMPurify 处理；网页内容和模型输出都是数据，不是可执行指令。提取排除表单、编辑区域、隐藏内容和整块代码。

本地结果缓存在 IndexedDB 中按容量淘汰，当前数据预算 50 MiB；清空后，在途任务不应重新写回旧结果。缓存结果可能包含原文信息，不能当作脱敏数据。最近标签页记录保存在 `chrome.storage.session`，重启浏览器或重载扩展后重新建立。

### 暗色模式

Dark Reader 固定版本随扩展打包，不下载远程代码；CSSOM 代理作为本地脚本在 MAIN world 执行。构建中的适配严格校验源码锚点；升级依赖时需检查补丁和网站、框架、恢复回归。原生暗色或其他 Dark Reader 接管时保留其主题。

决策模型和模型增强代码仍保留，但 `DECISION_MODELS_ENABLED` 当前为 `false`，不是可用产品功能。普通暗色模式和本地 SVG/混合模式修复无需模型。恢复增强入口前需要重新审查对应协议、权限和暂停前的测试，不可只打开开关。

## 验证范围

先构建，再按改动选择专项；不需要为文案和样式重复添加逻辑测试：

```sh
npm run build
node tests/browser.cjs --shortcuts-only
node tests/browser.cjs --qa-only
node tests/browser.cjs --page-translation-only
node tests/browser.cjs --reasoning-only
node tests/browser.cjs --connections-only
node tests/browser.cjs --appearance-only
node tests/browser.cjs --website-only
node tests/browser.cjs --lights-recovery-only
```

完整入口为 `npm run test:browser`。测试在临时 Chrome 配置中通过 CDP 加载当前根目录，用本地 HTTP 模拟模型验证实际请求、流式结果和 DOM 交互；不读取个人密钥或访问付费模型。截图和诊断写入忽略的 `artifacts/`。

快捷键测试验证注册、处理器和真实标签切换，不模拟操作系统全局按键派发；原生快捷键是否被其他应用占用、Chrome 原生授权提示和实际服务商兼容性仍需手动验收。本地测试不代表所有网站布局或模型质量。

## 加载路径与本地数据

独立仓库以迁移时完整版本作为首次提交，不带入旧项目历史。原目录保留用于核对和切换，运行或开发新仓库不依赖它。

当前 manifest 不固定扩展 `key`。未打包扩展更换加载路径可能改变扩展 ID，Chrome 会将新 ID 视为另一个扩展，旧的配置、密钥、收藏及缓存不会自动出现在新实例中。项目目前没有数据导入/导出功能。

切换前保留旧扩展及其目录，记下连接和自定义处理方式，妥善保存需要的收藏。加载新目录后重新配置，并在 `chrome://extensions/shortcuts` 检查快捷键；确认新实例正常后再处理旧实例。验证新实例时先禁用旧实例，避免两个扩展同时向网页注入界面。不要通过卸载旧扩展来尝试迁移数据，卸载会删除其本地数据。
