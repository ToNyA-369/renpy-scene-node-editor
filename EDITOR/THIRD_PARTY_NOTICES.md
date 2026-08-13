# Third-party notices

The bundled Content code editor contains the following open-source software. It is built into `static/vendor/` so installed projects do not need Node.js or network access.

| Component | Version | License |
|---|---:|---|
| [Monaco Editor](https://github.com/microsoft/monaco-editor) | 0.56.0 | MIT; Copyright (c) 2016-present Microsoft Corporation |
| [Shiki](https://github.com/shikijs/shiki) and `@shikijs/monaco` | 4.4.3 | MIT; Copyright (c) 2021 Pine Wu and Copyright (c) 2023 Anthony Fu |
| [`@shikijs/vscode-textmate`](https://github.com/shikijs/textmate) | 10.0.2 | MIT; Copyright (c) Microsoft Corporation |
| [oniguruma-to-es and related regex packages](https://github.com/slevithan/oniguruma-to-es) | bundled dependency versions | MIT; Copyright (c) 2024-2026 Steven Levithan |
| [Marked](https://github.com/markedjs/marked) | 14.0.0 | MIT; Copyright (c) 2018+ MarkedJS and Copyright (c) 2011-2018 Christopher Jeffrey |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.13 dependency; Monaco also contains its vendored copy | Apache-2.0 or MPL-2.0; Copyright (c) Cure53 and other contributors |
| [Ren'Py Language (Official)](https://github.com/renpy/vscode-language-renpy) grammar and snippets | 805.1.0 | MIT and the notices below |

Generated JavaScript retains upstream license comments. Build inputs and their provenance are recorded under `tools/editor_assets/renpy-language/` in the source repository.

## MIT license

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The applicable copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Ren'Py Language notices

Original work Copyright (c) 2018 Daniel Luque. Modified work Copyright (c) 2024 Tom Rothamel.

The extension was derived from `renpy/language-renpy`: original work Copyright (c) 2014 GitHub Inc.; modified work Copyright (c) 2016-2018 William Tumeo and Copyright (c) 2018 Tom Rothamel. These works are provided under the MIT license above.

The embedded Python grammar was derived from `textmate/python.tmbundle`. Permission to copy, use, modify, sell and distribute that software is granted. The software is provided “as is” without express or implied warranty, and with no claim as to its suitability for any purpose.

DOMPurify's [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) and [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/) are available from their respective licensors.
