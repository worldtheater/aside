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
| 支持 / 反馈地址 | https://github.com/worldtheater/aside/issues |
| 隐私政策 | https://worldtheater.github.io/aside/privacy.html |
| 图标 | [assets/store-icon-128.png](assets/store-icon-128.png) |
| 小型宣传图 | [assets/promo-small-440x280.png](assets/promo-small-440x280.png) |
| 大型宣传图 | [assets/promo-marquee-1400x560.png](assets/promo-marquee-1400x560.png) |
| 审核说明模板 | [reviewer-notes.md](reviewer-notes.md) |
| 权限与数据声明 | [privacy-declarations.md](privacy-declarations.md) |

目前提供中英文商店文案，插件界面支持 15 种语言。商店详情填写方式见[官方说明](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)。

## 展示素材

已保存的截图由真实插件界面生成；发布前检查是否仍与目标版本一致，必要时重新生成。英文截图可用于其他语言的列表，完整本地化截图需另行制作。

| 顺序 | 文件 | 展示内容 |
| --- | --- | --- |
| 1 | [01-inline-translation.png](assets/01-inline-translation.png) | 法语原文与英文行内译文 |
| 2 | [02-quick-qa.png](assets/02-quick-qa.png) | 选文快问快答结果 |
| 3 | [03-collection.png](assets/03-collection.png) | 收藏片段与今日随想 |
| 4 | [04-reusable-actions.png](assets/04-reusable-actions.png) | 处理方式编辑与试运行 |
| 5 | [05-dark-reading.png](assets/05-dark-reading.png) | Dark Reader 暗色网页和悬浮菜单 |

截图中的文章、收藏和回复是自编示例，使用隔离的临时 Chrome 资料与本地模拟服务生成，不含实际账号、密钥或个人浏览记录。安装包不包含示例数据或模拟服务。

截图尺寸为 **1280 × 800 PNG**；图标为 **128 × 128**，宣传图为 **440 × 280** 与 **1400 × 560**。提交时核对[官方素材规格](https://developer.chrome.com/docs/webstore/images)。

### 重新生成截图

需要 Node.js 22+ 和本机 Chrome，也可通过 `CHROME_PATH` 指定浏览器。在仓库根目录运行：

```sh
npm ci
npm run build:icons
npm run build
node scripts/store-assets.mjs
```

截图脚本使用临时 Chrome 资料与本地示例服务，完成后删除临时资料目录。运行期间不要重新构建插件。安装包由独立的打包流程生成，见[开发文档](../docs/DEVELOPMENT.md#自动发布)。

## 更新商店版本

1. 在现有商店条目上传已验收的新版本 ZIP，核对控制台解析出的版本和权限；不要上传源码或整个材料目录。
2. 按本次功能变化更新详细描述、截图和权限声明，使其与安装包行为一致。
3. 将审核说明填入控制台的 **Test instructions** 私有字段。审核专用服务地址、模型与凭据只在该私有字段填写，不写入本目录或公开文案；提交前验证该配置能实际生成回复。
4. 核对产品主页、支持与隐私政策链接后，再提交审核。

审核流程说明见[官方测试指引](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)。
