# Privacy practices — dashboard draft

对应 Aside 0.1.0。以下英文正文可分别粘贴到 Chrome Web Store 隐私权表单，每个字段均少于 1,000 字符；标题与字符数不用粘贴。内容对应实际扩展包，不是截图演示服务。

Privacy policy URL: https://worldtheater.github.io/aside/privacy.html

## 单一用途与权限字段

### 单一用途说明 / Single purpose

```text
Aside helps users understand and retain what they read on the web. It provides translation, explanations and questions about page content through a model service chosen by the user, and lets them save useful passages. Dark mode and recent-tab switching support this reading workflow.
```

283 / 1,000 characters.

### 需要 storage 的理由

```text
Stores user preferences, model connection settings and API keys, per-site options, saved passages, and reflection settings locally. Session storage keeps temporary tab activation order for the recent-tabs shortcut. Aside does not synchronize these stores to a developer-operated server.
```

286 / 1,000 characters.

### 需要 activeTab 的理由

```text
Provides temporary access to the active tab after the user invokes Aside from the extension button, a context-menu command or a keyboard shortcut. This allows Aside to identify the current page and initialize its reading tools when needed, then perform the requested action.
```

274 / 1,000 characters.

### 需要 scripting 的理由

```text
Injects bundled content scripts when reading tools need to be initialized on an eligible tab. It also runs the bundled Dark Reader CSSOM integration in the page's main world to support website dark mode. No downloaded scripts or model responses are executed as code.
```

266 / 1,000 characters.

### 需要 contextMenus 的理由

```text
Adds Aside reading actions to Chrome's context menu, allowing users to process selected text or the current web page without first opening the extension popup.
```

159 / 1,000 characters.

### 需要 favicon 的理由

```text
Displays source-site icons next to saved passages in Collection using Chrome's favicon API, so users can recognize and return to the original websites.
```

151 / 1,000 characters.

### 需要主机权限的理由

```text
Content scripts run on HTTP/HTTPS pages to show selection and floating reading controls, extract content for requested actions, insert results, and apply saved dark-mode settings, including in frames. Optional host access lets the extension call the model endpoint configured by the user; setup requests access to that origin. Dark Reader may request broader host access to retrieve stylesheets or images referenced by a page across different domains. These resources are used for styling, not executed as code. Page text is sent to the chosen model service when a model feature runs; opening a page alone does not upload its text to a model or the developer.
```

659 / 1,000 characters.

### 远程代码说明 / Remote code

选择 **“不，我未使用远程代码” / No, I am not using remote code**。如显示说明字段，可填写：

```text
All executable code, including Dark Reader, Marked and DOMPurify, is bundled with the extension. Remote model responses and model lists are treated as data, and rendered output is sanitized. Dark Reader may fetch webpage stylesheets and images as resources. Aside does not download or execute remote JavaScript or WebAssembly, or evaluate model output as code.
```

360 / 1,000 characters.

## Data-use categories

Recommended selections for this version:

| Category | Select | Reason |
| --- | --- | --- |
| Authentication information | Yes | User-supplied API keys are stored locally and sent to the configured model service for authentication. |
| Web history | Yes | Saved passages retain their source URLs and titles; per-site settings retain site identifiers. The recent-tabs feature stores tab/window identifiers and activation order only for the browser session. |
| User activity | Yes | Local request history records action, model, time, status, submitted input and output, and reported usage. This is user-facing history, not analytics sent to the developer. |
| Website content | Yes | Selected/extracted text, page context, questions, generated results and saved passages are processed. Required content is sent to the selected model service when a model feature runs. |

Aside does not specifically request identity profiles, financial/payment details, health information, precise location, or access to personal communications accounts. Do not treat that as a guarantee that selected text cannot contain such information: users can include personal or sensitive information in website content and questions. Reassess the remaining checkboxes if the release adds specific handling of these categories.

Data handling includes local storage, even though the developer receives none of it. Do not select a blanket “does not collect or handle user data” statement for this version. [Official user-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

## Limited-use certifications

The current implementation supports the certifications that data is not sold or transferred for unrelated purposes, is not used beyond the extension's reading features, and is not used to assess creditworthiness or for lending. Transfers necessary to run model features go to the endpoint selected by the user. Confirm the exact wording of all certifications in the dashboard before accepting them.

## Behavior reviewers should know

- Model requests include the content and instructions required by the action; page context may include titles, section titles and table headings.
- Inline processing can continue for newly visible passages as the user scrolls after starting a page action.
- With a model configured and the reflection area visible, the first Collection visit each local day can generate a reflection. Optional collection references include excerpts from up to five saved passages.
- API keys are kept out of content scripts and are not automatically added to request-detail logs. They are local credentials, not an encrypted vault.
- Usage records include request inputs and outputs; clearing history also removes its details. Clearing result cache is separate. Collections can be deleted, and uninstalling removes extension-local data.
- No developer relay, analytics, advertising, or cloud synchronization is included. Provider retention and use of requests depend on that provider's policy.

The required declaration fields and consistency requirements are documented in [Privacy practices](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).
