# Chrome Web Store 发布材料

本目录维护商店文案、展示素材、权限声明和审核说明模板，不包含在扩展安装包中。文字材料随源代码维护；准备提交时，从目标版本的标签核对材料与安装包，不将仓库最新内容视为商店已上线内容。

安装包使用已验收的 `aside-<version>.zip`，其中 `<version>` 与包内 `manifest.json` 的版本一致。GitHub 自动打包与草稿验收流程见[开发文档](../docs/DEVELOPMENT.md#自动发布)。本目录不维护材料合集 ZIP 或审核凭据。

## 商店信息与文件

| 字段 | 来源 / 文件 |
| --- | --- |
| 名称与简短描述 | 来自 manifest 和 `_locales/` 消息资源 |
| 详细描述，默认英文 | [listing-en.txt](listing-en.txt) |
| 简体中文详细描述 | [listing-zh-CN.txt](listing-zh-CN.txt) |
| 默认语言 | English |
| 分类 | Education，以控制台当前选项为准 |
| 产品主页 | https://worldtheater.github.io/aside/ |
| 商店页面 | https://chromewebstore.google.com/detail/aside/fpepddfodhahbemmlphncnaifledggcf |
| 支持 / 反馈地址 | 英文 https://tally.so/r/Eq5ZGL；中文 https://tally.so/r/jebJOJ（免登录；联系方式和截图选填） |
| 隐私政策 | https://worldtheater.github.io/aside/privacy.html |
| 图标 | [assets/store-icon-128.png](assets/store-icon-128.png) |
| 小型宣传图 | [assets/promo-small-440x280.png](assets/promo-small-440x280.png) |
| 大型宣传图 | [assets/promo-marquee-1400x560.png](assets/promo-marquee-1400x560.png) |
| 审核说明模板 | [reviewer-notes.md](reviewer-notes.md) |
| 权限与数据声明 | [privacy-declarations.md](privacy-declarations.md) |

目前提供中英文商店文案，插件界面支持 15 种语言。商店详情填写方式见[官方说明](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)。

## 展示素材

英文和简体中文各有一套展示图，分别上传到控制台对应的语言项。每张图用短标题介绍一个功能，主体为真实界面中与操作直接相关的区域。发布前核对截图与目标版本是否一致。

| 顺序 | 展示内容 | English | 简体中文 |
| --- | --- | --- | --- |
| 1 | 法语原文与行内译文 | [01-inline-translation.png](assets/01-inline-translation.png) | [01-inline-translation.png](assets/zh-CN/01-inline-translation.png) |
| 2 | 选中的原文和问答结果 | [02-quick-qa.png](assets/02-quick-qa.png) | [02-quick-qa.png](assets/zh-CN/02-quick-qa.png) |
| 3 | 收藏片段、解读与来源 | [03-collection.png](assets/03-collection.png) | [03-collection.png](assets/zh-CN/03-collection.png) |
| 4 | 自定义处理要求与试运行结果 | [04-reusable-actions.png](assets/04-reusable-actions.png) | [04-reusable-actions.png](assets/zh-CN/04-reusable-actions.png) |
| 5 | Dark Reader 暗色网页和悬浮菜单 | [05-dark-reading.png](assets/05-dark-reading.png) | [05-dark-reading.png](assets/zh-CN/05-dark-reading.png) |

问答图使用《庄子·外物》节选，在画面内标明出处、英文译本及演示解读。其余文章、收藏和模型回复为演示内容。截图使用隔离的临时 Chrome 资料与本地模拟服务生成，不含实际账号、密钥或个人浏览记录。安装包不包含示例数据或模拟服务。

截图尺寸为 **1280 × 800 PNG**；图标为 **128 × 128**，宣传图为 **440 × 280** 与 **1400 × 560**。提交时核对[官方素材规格](https://developer.chrome.com/docs/webstore/images)。

### 重新生成截图

需要 Node.js 22+ 和本机 Chrome，也可通过 `CHROME_PATH` 指定浏览器。在仓库根目录运行：

```sh
npm ci
npm run build:icons
npm run build
node scripts/store-assets.mjs
node scripts/store-assets.mjs --locale=zh-CN
```

截图脚本使用临时 Chrome 资料与本地示例服务，完成后删除临时资料目录。运行期间不要重新构建插件。安装包由独立的打包流程生成，见[开发文档](../docs/DEVELOPMENT.md#自动发布)。

## 更新商店版本

1. 在现有商店条目上传已验收的新版本 ZIP，核对控制台解析出的版本和权限；不要上传源码或整个材料目录。
2. 按本次功能变化更新详细描述、截图和权限声明，使其与安装包行为一致。
3. 将审核说明填入控制台的 **Test instructions** 私有字段。审核专用服务地址、模型与凭据只在该私有字段填写，不写入本目录或公开文案；提交前验证该配置能实际生成回复。
4. 核对产品主页、支持与隐私政策链接后，再提交审核。

审核流程说明见[官方测试指引](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)。
