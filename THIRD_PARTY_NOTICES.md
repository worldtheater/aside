# Third-party notices

Aside's own code is licensed under the [MIT License](LICENSE). Bundled third-party code retains its original copyright and license notices.

| Component | Locked version | License and notices | Source |
| --- | --- | --- | --- |
| Dark Reader | 4.9.133 | [MIT](licenses/darkreader.txt) | [darkreader/darkreader](https://github.com/darkreader/darkreader) |
| Marked | 18.1.1 | [MIT and included original Markdown notices](licenses/marked.txt) | [markedjs/marked](https://github.com/markedjs/marked) |
| DOMPurify | 3.4.17 | [Apache-2.0](licenses/dompurify-apache-2.0.txt) or [MPL-2.0](licenses/dompurify-mpl-2.0.txt) | [cure53/DOMPurify](https://github.com/cure53/DOMPurify) |

`scripts/build.mjs` adapts the pinned Dark Reader source at build time: it isolates the website API compatibility shim, emits a local CSSOM proxy, adjusts expected resource-error logging, and registers SVG presentation-attribute variables in the existing matching queue. These adaptations are shipped with the extension. Review them before upgrading Dark Reader.

Provider SVGs in `icons/providers/` are bundled local assets. Provider names and logos identify their respective services; this project's MIT license does not grant rights to third-party trademarks or imply endorsement.

Development-only dependencies and their license metadata are recorded in `package-lock.json`; they are not included in the extension archive. The archive includes this notice, the project license, and the files in `licenses/`.
