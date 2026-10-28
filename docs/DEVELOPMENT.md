# 开发与维护

UI 设计原则与验收检查项集中在 [设计规范](../.agents/design-principles.md)。本文保留实现约定、源码位置与开发流程。

## 环境与命令

- Node.js 22+、npm；`.nvmrc` 指定 Node.js 24。
- Python 3：打包命令需要，使用标准库，无额外 Python 依赖。
- 本机 Google Chrome：浏览器回归和重建图标需要；普通构建使用已提交的 PNG，无需浏览器。
- `npm ci` 按锁文件安装开发和运行依赖。项目不使用工作区包、父目录模块、外部脚本或本地辅助进程。

| 命令 | 用途 |
| --- | --- |
| `npm run typecheck` | 严格 TypeScript 检查 |
| `npm run format:check` | 检查源码、测试和界面样式格式 |
| `npm run format` | 按共享 Prettier 配置整理格式 |
| `npm run build` | 类型检查并生成根目录 JS |
| `npm run build:icons` | 从 SVG 母版生成图标 PNG |
| `npm test` | 构建并运行核心逻辑测试 |
| `npm run test:browser` | 构建并运行主浏览器回归、内容脚本恢复和最近标签页测试 |
| `node tests/browser.cjs --onboarding-only` | 已构建产物的首次安装引导、设置跳转及配置实时更新回归 |
| `node tests/credentials-browser.cjs` | 已构建产物的本机凭据加密、升级迁移、重启保留及密文损坏回归 |
| `node tests/theme-browser.cjs` | 已构建产物的首屏主题专项回归 |
| `npm run package` | 构建并生成 `artifacts/aside-<manifest版本>.zip` |
| `npm run package:dev` | 构建、打包，并将同一 ZIP 解压至固定调试目录 `artifacts/unpacked/` |

测试默认通过 Playwright 的 `chrome` channel 查找已安装的 Chrome。自定义路径示例：

```sh
CHROME_PATH="/path/to/chrome" npm run test:browser
```

浏览器回归使用较新的 Chrome 扩展调试接口，请使用当前稳定版 Chrome；它不是对最低声明版本 Chrome 120 的兼容性认证。无需安装 Playwright 自带的 Chromium。

## 构建与分发

根目录是未打包扩展的加载目录。`scripts/build.mjs` 先执行类型检查，再用 esbuild 打包模块和依赖；后台与界面使用 ESM，内容脚本单独打包为 IIFE。构建会清理根目录所有 `.js` 文件，因此源码和开发脚本必须放在 `src/`、`scripts/` 或 `tests/` 中。不要手工修改生成文件，也不要在浏览器回归运行期间重新构建。

`build.py` 使用明确的运行文件清单打包 JS、CSS、HTML、manifest、图标、语言资源和许可证。安装包不包含源码、依赖目录、测试、截图或本机配置。发布前同步 `manifest.json`、`package.json` 和锁文件中的版本。

### 本地调试安装

运行 `npm run package:dev`，同时生成 ZIP 和更新 `artifacts/unpacked/`。首次在 `chrome://extensions` 开启开发者模式，选择「加载已解压的扩展程序」，加载当前仓库的 `artifacts/unpacked/` 目录。之后仍运行同一命令，再点击该扩展的「重新加载」，无需重新解压或卸载插件。

`artifacts/unpacked/` 是专用构建产物目录，每次会清理旧文件，再从 ZIP 解压，避免残留过期模块。不要在该目录保存其他文件。运行中的扩展依赖此目录，请保留它；本地配置存储在 Chrome 的扩展数据中，不在该目录内。

品牌资源：`icons/icon.svg` 是标准母版，`icons/icon-small.svg` 用于 16/32px 光学校正版；`icons/brand-mark.svg` 是界面共用标记。修改母版后运行 `npm run build:icons` 并检查生成图标。

### 自动发布

`.github/workflows/release.yml` 只响应推送到 GitHub 的 `v*` 标签，普通提交、分支推送和 Pull Request 不打包。只有要发布的提交才打版本标签，其他提交无需添加跳过标记。

工作流检出标签对应的提交，要求标签格式为 `vX.Y.Z`，且与 `manifest.json`、`package.json`、`package-lock.json` 顶层及根包版本一致。格式检查、产品页生成检查和 `npm test` 全部通过后，使用 `build.py` 生成 ZIP，再创建草稿 GitHub Release 并上传附件，不会自动公开发布。发布使用内置 `GITHUB_TOKEN`，不需要配置个人令牌或模型密钥。浏览器回归仍根据改动范围在本地运行。

首次使用前，先提交并推送工作流文件。之后以发布 `0.1.1` 为例：

1. 同步三个版本文件中的版本号，保留 manifest 中的固定公钥。
2. 运行 `npm run build:site` 更新产品页版本和下载链接，并更新 README 中的安装包链接。
3. 提交发布相关改动，再创建并推送标签：

```sh
git tag -a v0.1.1 -m "Aside 0.1.1"
git push origin main
git push origin v0.1.1
```

需要发布特定历史提交时，在创建标签时指定它（将 `COMMIT_SHA` 替换为目标提交）：

```sh
git tag -a v0.1.1 COMMIT_SHA -m "Aside 0.1.1"
git push origin v0.1.1
```

该提交必须已经包含工作流，且版本校验通过；打包取标签指向的代码，不取当时最新的 `main`。可先运行 `node scripts/check-release.mjs v0.1.1` 检查当前目录的版本。到 GitHub 的 Actions 页面查看进度，完成后登录仓库管理账号，从 Releases 草稿下载 `aside-0.1.1.zip`。用该包验证安装和覆盖升级，确认配置、收藏、调用记录与核心功能正常后，再点击 **Publish release** 公开发布。

草稿附件仅仓库有权限的成员可下载；网站中的新版下载链接要等草稿公开发布后才能访问。

若验收发现问题，且该版本仍是 **Draft**，可在修复提交后将版本标签更新到新提交。工作流会替换同一草稿中的同名 ZIP、更新对应提交，并保留草稿标题与说明，不会公开发布。先在 GitHub 确认草稿状态，再操作：

```sh
previous_release_tag=$(git rev-parse refs/tags/v0.1.1)
git push origin main
git tag -f -a v0.1.1 -m "Aside 0.1.1"
git push --force-with-lease="refs/tags/v0.1.1:$previous_release_tag" origin refs/tags/v0.1.1
```

已公开发布的标签不重复使用或移动，后续更新使用新版本；工作流会拒绝覆盖已公开 Release 的附件。草稿附件被替换后需重新下载验证。仅在本地试包仍可运行 `npm run package`，无需打标签。

这条流水线不上传 Chrome Web Store。GitHub Pages 仍按 `main` 分支的 `/docs` 发布：推送普通网页改动可能更新网站，但不会触发扩展打包。

## 源码结构

| 文件 | 职责 |
| --- | --- |
| `src/app.ts`、`src/ui.ts`、`src/copy.ts`、`src/controls.ts` | 页面调度、共享界面元素、文案选择和控件 |
| `src/locale.ts`、`src/locales/`、`_locales/` | 界面语言定义、完整文案与 Chrome 扩展元数据 |
| `style.css`、`themes.css` | 扩展页面样式与主题 |
| `src/popup.ts`、`popup.html`、`popup.css` | 浏览器入口弹窗 |
| `src/background.ts`、`src/store.ts`、`src/client.ts` | 权限、任务、受限存储及消息边界 |
| `src/providers.ts`、`src/model-spec.ts` | 各协议适配及模型推理能力契约 |
| `src/processor.ts`、`src/cache.ts`、`src/scheduler.ts` | 内容切分、缓存、共享任务与连接级并发 |
| `src/extract.ts`、`src/content.ts`、`content-*.css` | 网页提取、增量处理、隔离结果面板与原位译文 |
| `src/selection-tools.ts`、`src/result-content.ts` | 划词工具条状态和结果渲染 |
| `src/recent-tabs.ts` | 当前窗口最近标签页记录与切换 |
| `src/lights.ts`、`src/lights-*.ts` | 网页暗色模式、框架控制和本地图形修复 |
| `src/usage.ts`、`src/usage-store.ts`、`src/usage-page.ts` | 用量统一、IndexedDB 记录存储与分页显示 |
| `tests/` | 核心与隔离 Chrome 回归 |

内部 `pagework` 标识用于存储、DOM 和消息等既有契约，不因仓库更名而批量替换。

## 需要保持的实现约定

### 界面语言

当前支持英语、简体中文、繁体中文、日语、韩语、法语、德语、西班牙语、葡萄牙语（巴西）、俄语、印尼语、意大利语、土耳其语、泰语和越南语。`src/locale.ts` 统一声明语言名称、缩写、输出语言及系统语言匹配，界面与后台共用解析规则。繁体中文地区（台湾、香港、澳门）和 `zh-Hant` 匹配繁体中文；显式 `zh-Hans` 匹配简体中文。

文案按语言存放于 `src/locales/`，每种语言需完整满足英文资源导出的 `Copy` 类型，不使用英语覆盖缺失文案。动态参数、占位符和用量格式函数同样需要翻译。释义、解释、总结和问答的模型指令共用 `ACTION_PROMPTS`；翻译和随想的可编辑默认要求按界面语言提供。

新增语言时同步维护语言表、完整文案、`DAILY_PROMPT` 及 Chrome 的 `_locales/<locale>/messages.json`。运行 `node tests/locales.mjs` 和 `node tests/browser.cjs --locales-only`，验证系统匹配、保存、后台输出指令、弹窗及网页面板。

### 模型与协议

四种生成协议独立编码请求及读取流式事件，不因错误自动猜测或切换协议。模型列表来自所选服务，推理能力由本仓库 `src/model-spec.ts` 管理；已知型号使用明确 ID/别名和能力，未知型号使用服务默认，不按系列名称推断。UI 选项、保存校验、请求编码与缓存身份必须保持一致。维护时核对该文件记录的官方来源，并更新 `tests/reasoning.mjs` 和对应浏览器回归。

服务端前缀缓存与本地结果缓存是两个不同机制。协议适配将稳定指令与变化正文分离；推理参数、协议和模型参与本地缓存身份。服务端是否命中以及用量字段是否完整取决于服务响应；不要把缺失值当成零，或把缓存细分 token 重复计入总量。

### 网页处理与取消

页内逐段翻译使用可见区域加上下各 600px 预加载，滚动和 DOM 变化增量调度；原文被编辑时丢弃旧版本结果。插件自己的结果节点不参与重复提取。整页结果面板、总结和提炼要点仍处理全文。

选文处理将完整选文作为一个输入，保留原始换行；后台按选文来源使用整体处理，不随处理方式的整页分段设置拆块或分批。复用整体处理的缓存身份与单次输入上限，超限明确报错，不静默拆分；不修改已保存的处理方式。

原文节点和事件保留，恢复原文会移除结果及插件的布局调整。相同任务可共享请求，同一连接共用并发额度；只有所有订阅者都取消才中止共享上游请求。完整有效的结果才进入缓存，手动重新生成绕过缓存；不引入静默重试。

内容脚本处理扩展重载后的失效上下文，后台与页面消息客户端应共用既有错误处理。不要把消息通道断开误报成服务商返回错误。

### 数据与渲染

本机 API Key 和含密钥的同步副本统一封装在 `chrome.storage.local.protectedConfiguration`，使用 AES-256-GCM 加密；随机设备密钥以不可导出的 `CryptoKey` 保存在独立 `aside-credentials` IndexedDB 中，不进入 Chrome Sync。存储层负责解密与写回，未变化的敏感内容复用密文，避免触发无意义的同步循环。初始化时先写入加密副本，再移除已发布版本的明文 `credentials` 和 `configurationRecords`；读操作不执行迁移。密钥丢失或密文认证失败时明确报错，不生成替代密钥覆盖数据。此机制降低明文暴露，不提供系统钥匙串或完整浏览器数据被盗时的防护。内容脚本只获得不含密钥的配置快照。模型返回的 Markdown 经 Marked 和 DOMPurify 处理；网页内容和模型输出都是数据，不是可执行指令。提取排除表单、编辑区域、隐藏内容和整块代码。

模型错误先替换已配置的 API Key，再限制提示长度。结果流在协议层暂存可能属于密钥的末尾前缀，跨分片匹配后再发往界面与记录器；异常结束不释放该前缀。调用记录的输入、指令、输出与显示元数据在写入前脱敏，缓存写入与命中返回也按已配置密钥处理。只匹配已知密钥（含 JSON 转义形式），不按外观猜测密钥，不改写已有历史记录或清理备份。

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

当前 `manifest.json` 已包含固定公钥 `key`，源码构建与 Release 包使用相同的扩展 ID。后续更新保留公钥，通过重新加载现有扩展更新文件，不要先卸载。公钥可以公开，私钥不得放进仓库或安装包。

添加固定公钥之前安装的版本可能使用另一个扩展 ID。Chrome 将不同 ID 视为不同扩展，旧的配置、密钥、收藏及缓存不会自动出现在新实例中。项目目前没有数据导入/导出功能。

切换前保留旧扩展及其目录，记下连接和自定义处理方式，妥善保存需要的收藏。加载新目录后重新配置，并在 `chrome://extensions/shortcuts` 检查快捷键；确认新实例正常后再处理旧实例。验证新实例时先禁用旧实例，避免两个扩展同时向网页注入界面。不要通过卸载旧扩展来尝试迁移数据，卸载会删除其本地数据。

调用记录概要和输入输出详情统一保存在 `aside-usage` IndexedDB 数据库中。概要和详情在同一事务中写入、清空。列表通过时间及模型索引每次读取 50 条，用 `(startedAt, id)` 游标处理同时间记录；汇总和每日图表单独扫描筛选范围的概要并累加，不读取详情或把所有记录传入界面。数据库变更通过扩展同源 BroadcastChannel 通知用量页刷新。

页面渲染只负责生成和挂载界面，数据查询由页面进入、筛选、翻页或刷新事件触发。用量页刷新保留已展开的记录范围；调用记录写入失败单独记录诊断，不覆盖模型调用的原始结果或错误。连接列表的滚动恢复由连接页更新函数负责。

## 隐私政策与 GitHub Pages

英文隐私政策源文件为 `docs/privacy.html` 和 `docs/privacy.css`，无构建步骤、脚本或远程字体。GitHub Pages 使用 `main` 分支的 `/docs` 目录发布，`docs/.nojekyll` 禁用 Jekyll 处理。公开地址为 <https://worldtheater.github.io/aside/privacy.html>，供 Chrome Web Store 的 Privacy Policy 字段使用。

数据处理、接收方、自动调用或保留规则发生变化时，同步更新政策及日期，再推送至 `main`。README 与插件「关于」均链接到同一地址；商店隐私披露也需与实际行为保持一致。

## 产品介绍页

GitHub Pages 从 `main` 分支的 `docs/` 提供静态页面。首页使用 `website/template.html` 共用模板，文案在 `website/locales/`，语言名称与路由在 `website/languages.json`。运行 `npm run build:site` 生成十五种语言的静态页面；`npm run check:site` 检查文案完整性和生成结果是否最新。不要直接修改生成的首页 HTML。页面共享 `docs/home.css` 和 `docs/home.js`，图片位于 `docs/assets/`。英文首页仍位于根目录，简体中文仍位于 `zh/`；隐私政策仍位于 `privacy.html`，其他语言的链接会标明其为英文。

搜索标题和摘要分别使用各语言文案的 `seoTitle`、`seoDescription`，与可见主标题分开维护。模板保留 Google Search Console 的 `google-site-verification` 验证标记，验证成功后也不要删除。构建同时生成产品 `SoftwareApplication` JSON-LD 和 `docs/sitemap.xml`；结构化数据中的版本与最低 Chrome 版本来自项目配置，网站地图包含全部语言首页与隐私政策，不填写虚构的更新时间、评分或评论。

部署后，在 Search Console 使用 URL 前缀 `https://worldtheater.github.io/aside/` 验证所有权，再提交 <https://worldtheater.github.io/aside/sitemap.xml>。`robots.txt` 只在域名根目录生效；本仓库的 `/aside/` 是项目子路径，无需在此放置无效的 robots 文件。网站验证和结构化数据不保证收录、排名或 AI 引用。

首页下载入口指向 GitHub Release 的 `aside-<version>.zip`，版本号取自 `package.json`。更新版本后重新生成首页；推送匹配的版本标签后，自动发布工作流会生成并上传对应安装包到草稿，验收并公开发布后下载链接才生效，见[自动发布](#自动发布)。

使用 `node scripts/store-assets.mjs --website` 重新生成首页截图。它复用商店素材的隔离浏览器与本地模拟服务，以 2 倍像素密度直接截取真实插件界面，并为首屏提供移动端版本，为首屏、选文问答和收藏提供亮暗色版本。无参数运行仍只生成商店素材。截图内容、显示比例与预览交互遵循设计规范。

首页主题选择保存在本站的本地存储中；主题交互和截图呈现遵循设计规范。修改 `docs/home.css` 或 `docs/home.js` 后也要运行 `npm run build:site`，生成页面中的资源版本随内容更新，避免旧缓存影响预览和发布。
