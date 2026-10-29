# OmniComment

<div align="center">

<img src="../media/omnicomment.svg" alt="OmniComment Logo" width="160" height="160" />

### Universal In-Context Comments, Highlights, and Collaboration for Humans & AI

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg?style=flat-square)](https://github.com/benquike/OmniComment)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg?style=flat-square)](../LICENSE)
[![Tests: 83 Passing](https://img.shields.io/badge/tests-83%20passing-brightgreen.svg?style=flat-square)](../src/test/)
[![VS Code](https://img.shields.io/badge/VS%20Code-^1.85.0-007ACC.svg?style=flat-square&logo=visual-studio-code)](https://marketplace.visualstudio.com/)
[![Web Component](https://img.shields.io/badge/Web%20Component-%3Comni--comment%3E-orange.svg?style=flat-square)](INTEGRATION_GUIDE.md)
[![Agent Ready](https://img.shields.io/badge/AI%20Agent-First--Class%20API-purple.svg?style=flat-square)](AGENT_API.md)

[**Tutorial**](TUTORIAL.md) · [**API Reference**](API_REFERENCE.md) · [**Web Apps**](WEBAPP_GUIDE.md) · [**Chrome Extension**](CHROME_EXTENSION_GUIDE.md) · [**Terminal TUI**](TUI_APPS_GUIDE.md) · [**VS Code Modes**](VSCODE_MODES_GUIDE.md) · [**Presets**](CONFIGURATION_PRESETS.md) · [**Architecture**](ARCHITECTURE.md)

</div>

---

## What is OmniComment?

**OmniComment** is a universal annotation, threaded discussion, and collaborative review system that works everywhere you read and write:

1. **In Your Code Editor**: Rich inline comment bubbles, diff reviews, Vditor WYSIWYG, and Jupyter notebook support in **VS Code** (see [VS Code Editor Modes Guide](VSCODE_MODES_GUIDE.md)).
2. **On the Web**: Zero-dependency `<omni-comment>` custom web component for React, Next.js, Vue, Nuxt, Svelte, Docusaurus, and VitePress with real-time WebSocket sync (see [Web Applications Guide](WEBAPP_GUIDE.md) & [Integration Guide](INTEGRATION_GUIDE.md)).
3. **Across the Browser**: A Chrome Manifest V3 extension for capturing highlights, personal notes, and team feedback on any live website using W3C TextQuoteSelectors (see [Chrome Extension Guide](CHROME_EXTENSION_GUIDE.md)).
4. **Inside the Terminal**: An ANSI terminal renderer, Neovim `virt_lines` extmark plugin, Python Textual app, and Go Bubbletea UI for CLI workflows (see [Terminal & TUI Guide](TUI_APPS_GUIDE.md)).
5. **For Autonomous AI Agents**: Structured, programmatic API commands (`omnicomment.agent.*`) and MCP tools that let LLMs inspect context, post targeted reviews, and resolve threads (see [AI Agent API Guide](AGENT_API.md)).

> [!TIP]
> **Zero Vendor Lock-In**: Comments can be stored directly within your Markdown files using human-readable, Git-versioned comments (`<!-- omnicomment ... -->`), in local files, or synced to cloud endpoints.

---

## Why OmniComment?

Traditional commenting systems are fragmented. GitHub and GitLab PR comments are trapped in proprietary databases and vanish once a branch is merged. Google Docs comments don't live in your Git repository. Web highlight extensions don't sync with your local editor.

OmniComment bridges this divide:

```mermaid
flowchart TD
    subgraph Storage ["Portable Storage Layer"]
        DOC["Git Markdown File\n(&lt;!-- omnicomment ... --&gt;)"]
        REST["REST / Supabase API"]
        LOCAL["Local / IndexedDB"]
    end

    subgraph Core ["OmniComment Universal Core"]
        ANCHOR["AnchorEngine\n(Exact + Normalized + Fuzzy)"]
        STORAGE["StorageAdapter\n(Parser & Serializer)"]
        PRESETS["Configuration Presets\n(5 Built-in Profiles)"]
        AGENT["Agent API Dispatcher"]
    end

    subgraph Surfaces ["Multi-Surface Ecosystem"]
        VSCODE["VS Code Extension\n(TextEditor & Custom Editors)"]
        WEB["&lt;omni-comment&gt;\n(Web Component)"]
        BROWSER["Chrome MV3 Extension\n(Web Page Annotator)"]
        TUI["Terminal / Neovim\n(ANSI Box-Drawing TUI)"]
        AI["AI Agents & LLM Tools\n(MCP & JSON-RPC)"]
    end

    Storage <--> Core
    Core <--> Surfaces
```

### The 4 Pillars of OmniComment

| Pillar | How OmniComment Solves It |
| :--- | :--- |
| **1. Multi-Surface Ubiquity** | Run the exact same commenting logic across desktop editors (VS Code), static documentation sites, Chrome browser tabs, and headless CLI pipelines. |
| **2. Lossless Portability** | Store comments directly in the document body as a standard HTML comment block. Comments travel with your files, branch with Git, and endure across editor migrations. |
| **3. Self-Healing 3-Tier Anchoring** | When underlying text moves or edits occur, the `AnchorEngine` automatically recovers positions using (1) Exact Substring matching, (2) Normalized Markdown stripping, and (3) Trigram/Levenshtein fuzzy recovery. |
| **4. First-Class AI Collaboration** | Built from the ground up for human-agent symbiosis. Agents inspect comment contexts via JSON, post precise line annotations, and resolve issues autonomously. |

---

## Ecosystem Feature Matrix

| Feature | VS Code Extension | Web `<omni-comment>` | Chrome MV3 Extension | Terminal TUI | AI Agent API |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Inline Highlight Decoration** | ✅ | ✅ | ✅ | ✅ (ANSI color) | — |
| **Threaded Multi-turn Discussions** | ✅ | ✅ | ✅ | ✅ (Cards) | ✅ |
| **Emoji Reactions & Thumbs Up** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Resolution / Reopening Workflow** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Collapsible Zero-DOM Folding** | ✅ | ✅ | ✅ | — | — |
| **Preset Configuration Switching** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Direct Git Markdown In-File Storage** | ✅ | Optional | Optional | ✅ | ✅ |
| **Headless JSON Programmatic Access** | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 3-Minute Quickstart

### 1. In VS Code
1. Install `omnicomment-0.1.0.vsix` via Extensions view (`Extensions: Install from VSIX...`).
2. Open any `.md` or `.skill` file.
3. Highlight any phrase and press `Cmd+Shift+M` (macOS) or `Ctrl+Shift+M` (Windows/Linux).
4. Type your comment and press **Enter** (or `Ctrl+Enter`). An inline discussion bubble appears immediately!

### 2. On a Web Page or Documentation Site
Embed interactive commenting on any web page in two lines:

```html
<!-- Load the zero-dependency web component -->
<script type="module" src="https://unpkg.com/@omnicomment/web-plugin/dist/index.js"></script>

<!-- Attach comments to your documentation article -->
<omni-comment preset="documentation-site" target="#article-body"></omni-comment>
```

### 3. For AI Agents & Scripts
Programmatically query or post comments from an AI assistant or CI check:

```typescript
import * as vscode from 'vscode';

// 1. Post automated review feedback
await vscode.commands.executeCommand('omnicomment.agent.postComment', {
  anchorText: 'const total = calculateSum(items);',
  content: 'Warning: `items` can be empty, causing an unhandled NaN in sum.',
  author: 'GeminiReviewer'
});

// 2. Fetch all unresolved comments
const unresolved = await vscode.commands.executeCommand('omnicomment.agent.getComments', {
  includeResolved: false
});
```

---

## Built-In Configuration Presets

OmniComment provides 5 purpose-built presets to instantly tailor UI density, storage mode, and review behavior:

````carousel
```json
// Preset: "documentation-site"
{
  "preset": "documentation-site",
  "storageMode": "localStorage",
  "uiDensity": "minimal",
  "highlightColor": "rgba(59, 130, 246, 0.25)",
  "features": { "reactions": true, "authorAvatars": false }
}
```
<!-- slide -->
```json
// Preset: "git-file-review"
{
  "preset": "git-file-review",
  "storageMode": "in-file",
  "uiDensity": "compact",
  "highlightColor": "rgba(245, 158, 11, 0.3)",
  "features": { "diffLineAnchoring": true, "strictTracking": true }
}
```
<!-- slide -->
```json
// Preset: "ai-agent-reviewer"
{
  "preset": "ai-agent-reviewer",
  "storageMode": "in-file",
  "uiDensity": "compact",
  "highlightColor": "rgba(99, 102, 241, 0.35)",
  "features": { "agentBadges": true, "jsonRpcExport": true }
}
```
<!-- slide -->
```json
// Preset: "team-collaboration"
{
  "preset": "team-collaboration",
  "storageMode": "rest-api",
  "uiDensity": "comfortable",
  "highlightColor": "rgba(139, 92, 246, 0.3)",
  "features": { "authorAvatars": true, "emailAlerts": true }
}
```
````

Switch presets anytime in VS Code via `OmniComment: Apply Preset Configuration...` (`omnicomment.applyPreset`).

---

## Next Steps & Dedicated Guides

- **Follow the [Step-by-Step Tutorial](TUTORIAL.md)** for hands-on workflows across VS Code, presets, web embedding, and AI bots.
- **Consult the [Comprehensive API Reference](API_REFERENCE.md)** for data models, function signatures, and event hooks.
- **Learn how to embed on websites in the [Web Applications Guide](WEBAPP_GUIDE.md)** (React, Next.js, Vue, Nuxt, Svelte, Supabase, WebSockets).
- **Build browser annotation tools with the [Chrome Extension Guide](CHROME_EXTENSION_GUIDE.md)** (Manifest V3, W3C TextQuoteSelector, Shadow DOM).
- **Run in terminals with the [Terminal & TUI Guide](TUI_APPS_GUIDE.md)** (CLI, Neovim `virt_lines` extmarks, Python Textual, Go Bubbletea).
- **Master editor surfaces with the [VS Code Editor Modes Guide](VSCODE_MODES_GUIDE.md)** (TextEditor, Vditor WYSIWYG, Jupyter Notebooks, Git diffs).
- **Explore static site integrations in the [Integration Guide](INTEGRATION_GUIDE.md)** (Docusaurus, VitePress, Hugo).
- **Inspect the technical design in the [Architecture Specification](ARCHITECTURE.md)**.
