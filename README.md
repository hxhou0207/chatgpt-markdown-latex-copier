# ChatGPT Markdown & LaTeX Copier

A Tampermonkey userscript for copying ChatGPT web responses with equations as well-formatted Markdown.


## Features

Copy ChatGPT responses in either of the following ways:
- Select the response text and press `Ctrl+C`.
- Click ChatGPT’s native **Copy** button.

The copied content will be converted to well-formatted Markdown.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open [`chatgpt-markdown-latex-copier.user.js`](https://chatgpt.com/c/chatgpt-markdown-latex-copier.user.js) on GitHub and click **Raw**.
3. Tampermonkey should automatically open the userscript installation page. Click **Install**.
4. If it does not, create a new userscript in Tampermonkey, paste the script contents into the editor, and save it.
5. Reload the ChatGPT web page.

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
