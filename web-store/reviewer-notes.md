# Reviewer test instructions

Paste the sections below into the private **Test instructions** field after supplying reviewer-only model access. Do not paste credentials into the public listing, support issues, or this repository.

## Publisher: fill these private fields before submitting

- Protocol: [one of the four protocols below]
- Service URL: [reviewer-accessible HTTPS endpoint]
- API key: [dedicated, limited-use review credential, if required]
- Model to select: [exact model ID returned by the endpoint]
- Access limits or expiry: [enough time and quota to complete the review]

The access information above has not been provided in this repository. Test the exact endpoint, key and model before submitting. A local localhost endpoint on the publisher's machine cannot be reached by the reviewer. The screenshot fixture server is not a review service and is not included in the upload package.

## Setup

Aside is a Manifest V3 reading extension. There is no Aside login or companion application. Its AI features use a model service chosen by the user, and do not include an AI subscription or bundled credits.

1. Install Aside. Open its toolbar popup and click the Settings icon in the upper-right corner. This opens Connections.
2. Create a connection using the protocol, service URL and review credential supplied above. Aside supports OpenAI Responses, OpenAI-compatible Chat Completions, Anthropic Messages and Gemini Interactions.
3. Approve access to the supplied service origin. Click Test connection, select the supplied model from the returned list, and save. The first saved model connection becomes the default.
4. Use an ordinary HTTP/HTTPS article for testing. Chrome does not allow the page tools on browser-internal pages or the Chrome Web Store.

## Reading and questions

1. Select a paragraph. Aside's selection toolbar appears. Click Translate to produce a result without leaving the page. The output language initially follows the interface language; choose a different output language if the source already uses that language.
2. Open the floating menu at the right edge of the page to translate the page. Original text remains visible; further passages may be processed as you scroll.
3. Select text and press Alt+Q (Option+Q on macOS), or choose Quick Q&A from the reading tools. Enter a question and submit it. The selected text is quoted; without a selection, the page supplies the quote. The quote can be cleared before sending.
4. Click the bookmark icon beside a completed result. Open Settings → Collection to see the saved text and source.

## Customization and local history

1. Open Actions in the settings sidebar. Edit an action, change instructions or output language, and use Try it with sample text before saving.
2. Open Result styles to change result appearance. Open Usage to inspect reported token counts and request details via the row's info control. Service responses may not include all token counts.
3. In Collection, Today's thought can generate automatically on the first visit each local day once a model is configured. Its settings allow optional saved-passage references. Manual refresh sends another request; hiding the reflection area stops its automatic generation.
4. From the webpage floating menu, open website dark-mode controls. The bundled Dark Reader engine runs locally. Enabling it may ask for additional host access to fetch page stylesheets or images.
5. Visit two tabs in one window, then use Alt+W (Option+W on macOS) to switch between them. If a shortcut is unassigned or conflicts, open the Keyboard shortcuts page and use Set shortcuts to configure Chrome's bindings.

## Privacy and network behavior

Requests go directly to the configured model service. Aside has no developer-operated relay, analytics service or cloud sync. Settings, API keys, collections, result cache, and request input/output history are stored locally. Content is sent to the chosen service when a model feature runs, including the daily-reflection behavior described above. The service's own charges, terms and privacy policy apply.

All executable code is included in the extension package. Website dark mode uses bundled Dark Reader; model output is rendered as sanitized content rather than executed.

Privacy policy: https://worldtheater.github.io/aside/privacy.html
Source and support: https://github.com/worldtheater/aside
