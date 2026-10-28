# OmniComment Documentation

Welcome to the **OmniComment** documentation. OmniComment is a universal inline annotation, threaded discussion, and code commenting platform designed for multiple surfaces: VS Code editors, embeddable web pages, browser extensions, and autonomous AI agents.

---

## Documentation Index

| Guide | Description | Target Audience |
| :--- | :--- | :--- |
| **[AI Agent API Guide](file:///usr/local/google/home/phui/src/tools/editor/Markco/docs/AGENT_API.md)** | Programmatic APIs for AI agents, MCP tool schemas, automated review loops, and LLM context serialization | AI Engineers, Agent Developers, Automation Tooling |
| **[Integration Guide](file:///usr/local/google/home/phui/src/tools/editor/Markco/docs/INTEGRATION_GUIDE.md)** | Embedding OmniComment into any website, blogs, documentation sites, Chrome extensions, and VS Code | Frontend Devs, Site Authors, Extension Authors |
| **[Configuration & Presets](file:///usr/local/google/home/phui/src/tools/editor/Markco/docs/CONFIGURATION_PRESETS.md)** | The 5 built-in presets (`documentation-site`, `git-file-review`, etc.), UI styling tokens, and storage drivers | End Users, System Integrators |
| **[Architecture & Data Model](file:///usr/local/google/home/phui/src/tools/editor/Markco/docs/ARCHITECTURE.md)** | Core monorepo packages, W3C Web Annotation schema, 3-tier fuzzy anchoring, and design principles | Core Contributors, Architects |

---

## Quick Navigation

### 1. For AI Agents & Automation
OmniComment provides first-class commands and headless APIs:
- `omnicomment.agent.getComments`
- `omnicomment.agent.postComment`
- `omnicomment.agent.replyComment`
- `omnicomment.agent.resolveComment`
- `omnicomment.agent.deleteComment`

See the **[AI Agent API Guide](file:///usr/local/google/home/phui/src/tools/editor/Markco/docs/AGENT_API.md)** for complete request/response schemas, TypeScript definitions, and MCP tool declarations.

### 2. For Web Developers
Embed OmniComment into any HTML page or documentation framework with one script tag:
```html
<script type="module" src="https://unpkg.com/@omnicomment/web-plugin/dist/index.js"></script>
<omni-comment preset="documentation-site" target="#content"></omni-comment>
```
See the **[Integration Guide](file:///usr/local/google/home/phui/src/tools/editor/Markco/docs/INTEGRATION_GUIDE.md)** for Docusaurus, VitePress, Hugo, React, and Vue integrations.

### 3. For Extension Users & Teams
Switch between built-in configuration presets with zero boilerplate:
- Run `OmniComment: Apply Preset Configuration...` in the VS Code Command Palette.
- Select from: `documentation-site`, `git-file-review`, `browser-annotator`, `team-collaboration`, or `ai-agent-reviewer`.
See the **[Configuration & Presets Guide](file:///usr/local/google/home/phui/src/tools/editor/Markco/docs/CONFIGURATION_PRESETS.md)**.
