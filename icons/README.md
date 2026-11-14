# Icon assets

All assets are packaged locally. Rendering these interfaces makes no CDN requests and adds no runtime dependencies.

## Relay mark

The Relay mark was generated with ImageGen and exported as transparent PNGs. Chrome uses the 16, 32, 48, and 128 px variants. The launcher and READMEs use `relay-256.png`.

## Service marks

`services/*.svg` come from [Lobe Icons](https://github.com/lobehub/lobe-icons), commit `a177c1e817204f8ddc0c8993610ca674fc6d9767`, under its MIT license, reproduced in `services/LICENSE`.

| Local file | Upstream static SVG |
| --- | --- |
| `google.svg` | `google-color.svg` |
| `chatgpt.svg` | `openai.svg` |
| `claude.svg` | `claude-color.svg` |
| `gemini.svg` | `gemini-color.svg` |
| `grok.svg` | `grok.svg` |
| `deepseek.svg` | `deepseek-color.svg` |
| `doubao.svg` | `doubao-color.svg` |

Upstream paths are `packages/static-svg/icons/`. The marks identify their respective providers and do not imply affiliation. Monochrome ChatGPT and Grok marks are inverted in system dark mode for visibility.

## UI icons

`ui/paperclip.svg` and `ui/check.svg` are regular icons from `assets/regular/` in [Phosphor Icons](https://github.com/phosphor-icons/core). See [the MIT license](./ui/LICENSE).
