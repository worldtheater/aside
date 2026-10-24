# Chrome Web Store 提交材料

对应版本：**0.1.0**。完整材料合集为 `../artifacts/aside-web-store-0.1.0.zip`，其中附带安装包与 SHA-256 校验清单。这些是待填写到 Developer Dashboard 的发布材料；不表示已经上传或提交审核。材料与代码一起维护，安装包不包含本目录。

## 商店详情

| 字段 | 建议填写 / 文件 |
| --- | --- |
| 名称 | Aside（来自 manifest 与英文消息资源；简体中文为「旁白」） |
| 简短描述 | Translate, explain and rewrite web pages and selected text with your own language model.（来自 manifest 的英文消息资源） |
| 详细描述，默认英文 | [listing-en.txt](listing-en.txt)，整份复制 |
| 简体中文详细描述 | [listing-zh-CN.txt](listing-zh-CN.txt)，添加 zh-CN 本地化后整份复制 |
| 默认语言 | English |
| 建议分类 | Education |
| 项目主页 | https://github.com/worldtheater/aside |
| 支持 / 反馈地址 | https://github.com/worldtheater/aside/issues |
| 隐私政策 | https://worldtheater.github.io/aside/privacy.html |
| 图标 | [assets/store-icon-128.png](assets/store-icon-128.png) |
| 小型宣传图，可选 | [assets/promo-small-440x280.png](assets/promo-small-440x280.png) |
| 大型宣传图，可选 | [assets/promo-marquee-1400x560.png](assets/promo-marquee-1400x560.png) |
| 上传安装包 | `../artifacts/aside-0.1.0.zip` |
| 审核说明 | [reviewer-notes.md](reviewer-notes.md)，先补充审核专用的模型访问方式 |
| 权限与数据声明草稿 | [privacy-declarations.md](privacy-declarations.md) |

Education 包含语言学习、笔记等用途。最终以提交时控制台可选项为准。[官方分类说明](https://developer.chrome.com/docs/webstore/best-practices)

名称与简短描述由扩展包元数据提供，详细描述在商店页面填写；额外本地化是可选项。这里只准备英文和简体中文商店文案，插件界面仍支持 15 种语言。[官方详情页说明](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)

## 截图顺序

所有截图均为 **1280 × 800 PNG**，使用当前插件实际渲染的界面，无外加边框或截图内营销标题。英文截图可先作为其他语言列表的回退素材；完整本地化截图需另行生成。

| 顺序 | 文件 | 展示内容 |
| --- | --- | --- |
| 1 | [01-inline-translation.png](assets/01-inline-translation.png) | 法语原文与英文行内译文 |
| 2 | [02-quick-qa.png](assets/02-quick-qa.png) | 选文快问快答结果 |
| 3 | [03-collection.png](assets/03-collection.png) | 收藏片段与今日随想 |
| 4 | [04-reusable-actions.png](assets/04-reusable-actions.png) | 处理方式编辑与试运行 |
| 5 | [05-dark-reading.png](assets/05-dark-reading.png) | Dark Reader 暗色网页和悬浮菜单 |

截图里的文章、收藏和模型回复是项目自编的示例内容，使用隔离的临时 Chrome 资料目录与本地模拟服务生成。没有实际账号、API Key、个人浏览记录或模型计费。界面、请求路径、结果呈现均来自插件本身；这些示例不代表某个模型的质量保证。安装包不包含示例数据或模拟服务。

商店需要 128px 图标和至少 1 张截图，最多 5 张；推荐截图尺寸 1280 × 800。128px 图标采用 96px 图形加四周 16px 透明边距。两张宣传图分别为 440 × 280、1400 × 560。素材规格来源：[Chrome Web Store images](https://developer.chrome.com/docs/webstore/images)。

## 重新生成

需要 Node.js 22+、Python 3 和本机 Chrome；也可通过 `CHROME_PATH` 指定浏览器。以下命令在仓库根目录运行：

```sh
npm ci
npm run build:icons
npm run build
node scripts/store-assets.mjs
python3 build.py
```

截图脚本只操作临时 Chrome 资料与本地示例服务，完成后删除临时资料目录。不要在脚本运行期间重新构建插件。

## 提交前由发布者完成

1. 确认 Chrome Web Store 开发者账号、联系邮箱及控制台要求的验证已完成。
2. 上传 `aside-0.1.0.zip`，检查控制台解析的版本、名称、权限；不要上传整个源码仓库或材料合集。
3. 填写英文主列表，可选添加简体中文描述，上传图标与五张截图；宣传图按控制台需要上传。
4. 按 `privacy-declarations.md` 填写单一用途、权限理由、远程代码与数据使用声明。最终声明必须与发布版本实际行为一致。
5. 在 **Test instructions** 私有字段提供审核可用的专用模型服务配置和凭据，验证能列出模型并实际生成回复。不要填写日常主 API Key，不要把凭据写进仓库或公开商店文案。撤销时间应在审核完成之后。
6. 选择分发范围、可见性及控制台要求的其他发布信息，复查隐私政策地址、商店预览与审核说明后再提交。

AI 核心流程需要模型访问；仅提交「用户自备 Key」而不给审核人员可运行的路径，可能使审核无法完整测试。[官方测试说明](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)
