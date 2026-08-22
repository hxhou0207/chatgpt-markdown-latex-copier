# ChatGPT Markdown & LaTeX Copier

A Tampermonkey userscript that copies GPT web responses as clean Markdown while preserving inline `$...$` and display `$$...$$` LaTeX.


## Features

- Select text and press `Ctrl+C` or `Cmd+C`.
- Use the native response Copy button.
- Preserve inline and display LaTeX.
- Convert common headings, lists, links, tables, images, and code blocks.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open [`chatgpt-markdown-latex-copier.user.js`](./chatgpt-markdown-latex-copier.user.js) on GitHub and click **Raw**.
3. Confirm the userscript installation and allow clipboard access.
4. Reload the GPT web page.


## Usage

Select a response and copy it normally, or click the response's native Copy button. For example:

```markdown
Inline: $x_t$

$$
E = mc^2
$$
```

Set `settings.compactMode` to `false` in the script if you want standard paragraph spacing.

## Scope

This release is intended for GPT web pages, including ChatGPT at `chatgpt.com` and `chat.openai.com`. Other sites are not part of the tested release scope.

## Privacy

The script processes the rendered page locally and writes to the clipboard. It does not send response content to a server.

## Attribution

This project is derived in part from [AI Markdown & LaTeX Copier](https://github.com/Wavesflow/GPT-AI-Markdown-LaTeX-Copier) by Johan Song, Copyright (c) 2026 Johan Song. The upstream project is licensed under the MIT License. This repository retains the upstream notice in `LICENSE`; the current release adds GPT-web-only matching, improved `$`/`$$` handling, direct keyboard interception, and native response-button support.

## License

MIT. See [`LICENSE`](./LICENSE).

## Friendly Links

- [Linux.do](https://linux.do)
