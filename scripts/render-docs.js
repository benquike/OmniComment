#!/usr/bin/env node
/**
 * OmniComment Documentation Site Generator
 * 
 * Compiles project Markdown files (HOME.md, TUTORIAL.md, API_REFERENCE.md, etc.)
 * into a standalone, modern, responsive HTML documentation website with:
 * - Left categorized sidebar navigation
 * - Right floating Table of Contents with active scrollspy
 * - Dark / Light theme toggle with local storage persistence
 * - Syntax highlighting for code blocks
 * - Native Mermaid diagram rendering
 * - GitHub-style Alert Callouts ([!NOTE], [!TIP], etc.)
 * - Embedded interactive <omni-comment> demo widget
 * - Optional zero-dependency local preview web server (--serve)
 * 
 * Usage:
 *   node scripts/render-docs.js                # Builds static site to dist/site/
 *   node scripts/render-docs.js --out=./site   # Custom output directory
 *   node scripts/render-docs.js --serve        # Builds and launches preview server at http://localhost:3000
 *   node scripts/render-docs.js <file.md>      # Renders a single markdown file to HTML
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

let marked;
try {
  const markedModule = require('marked');
  marked = markedModule.marked || markedModule;
} catch (e) {
  console.warn('Warning: marked module not found, falling back to basic markdown parser.');
}

// Project directory roots
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_OUT_DIR = path.join(ROOT_DIR, 'dist', 'site');

// Manifest of documentation pages to render
const PAGES = [
  {
    id: 'home',
    title: 'Project Overview',
    shortTitle: 'Home',
    category: 'Getting Started',
    source: 'docs/HOME.md',
    dest: 'index.html',
    isIndex: true,
    description: 'Universal in-context commenting and annotation system for humans and AI.'
  },
  {
    id: 'tutorial',
    title: 'Hands-on Tutorial',
    shortTitle: 'Tutorial (From Zero to Hero)',
    category: 'Getting Started',
    source: 'docs/TUTORIAL.md',
    dest: 'tutorial.html',
    description: 'Step-by-step guide to using OmniComment across VS Code, web, browser, and AI workflows.'
  },
  {
    id: 'api-reference',
    title: 'API Reference',
    shortTitle: 'API Reference',
    category: 'Reference',
    source: 'docs/API_REFERENCE.md',
    dest: 'api-reference.html',
    description: 'Full formal API specification for data structures, commands, core classes, and web elements.'
  },
  {
    id: 'agent-api',
    title: 'AI Agent API Guide',
    shortTitle: 'AI Agent API & MCP',
    category: 'AI & Automation',
    source: 'docs/AGENT_API.md',
    dest: 'agent-api.html',
    description: 'Programmatic APIs, MCP tool declarations, and autonomous review loop patterns.'
  },
  {
    id: 'integration',
    title: 'Integration Guide',
    shortTitle: 'Web & Extension Integration',
    category: 'Ecosystem',
    source: 'docs/INTEGRATION_GUIDE.md',
    dest: 'integration.html',
    description: 'Embed OmniComment in Docusaurus, VitePress, Hugo, Chrome extensions, and TUI.'
  },
  {
    id: 'webapp-guide',
    title: 'Web Application Integration',
    shortTitle: 'Web Applications Guide',
    category: 'Surfaces & Ecosystem',
    source: 'docs/WEBAPP_GUIDE.md',
    dest: 'webapp-guide.html',
    description: 'Integrate in React, Next.js, Vue 3, Nuxt, Svelte 5, SvelteKit, WebSockets, and Supabase.'
  },
  {
    id: 'chrome-extension-guide',
    title: 'Chrome Extension Guide',
    shortTitle: 'Chrome Extension Guide',
    category: 'Surfaces & Ecosystem',
    source: 'docs/CHROME_EXTENSION_GUIDE.md',
    dest: 'chrome-extension-guide.html',
    description: 'Manifest V3 extension for live web annotations, W3C TextQuoteSelector, and Shadow DOM.'
  },
  {
    id: 'tui-apps-guide',
    title: 'Terminal & TUI Integration',
    shortTitle: 'Terminal & TUI Guide',
    category: 'Surfaces & Ecosystem',
    source: 'docs/TUI_APPS_GUIDE.md',
    dest: 'tui-apps-guide.html',
    description: 'Headless CLI, Neovim virt_lines extmarks, Python Textual, Go Bubbletea, and Git hooks.'
  },
  {
    id: 'vscode-modes-guide',
    title: 'VS Code Editor Modes Guide',
    shortTitle: 'VS Code Editor Modes',
    category: 'Surfaces & Ecosystem',
    source: 'docs/VSCODE_MODES_GUIDE.md',
    dest: 'vscode-modes-guide.html',
    description: 'Standard TextEditor, Vditor WYSIWYG, Jupyter Notebooks (.ipynb), and Git diff reviews.'
  },
  {
    id: 'presets',
    title: 'Configuration Presets',
    shortTitle: 'Configuration & Presets',
    category: 'Configuration',
    source: 'docs/CONFIGURATION_PRESETS.md',
    dest: 'presets.html',
    description: 'Explore the 5 built-in presets and UI customization tokens.'
  },
  {
    id: 'architecture',
    title: 'Architecture & Design',
    shortTitle: 'Architecture Specification',
    category: 'Deep Dive',
    source: 'docs/ARCHITECTURE.md',
    dest: 'architecture.html',
    description: 'Monorepo layout, 3-tier fuzzy anchoring, and lossless storage architecture.'
  },
  {
    id: 'readme',
    title: 'Repository Readme',
    shortTitle: 'Extension Readme',
    category: 'Overview',
    source: 'README.md',
    dest: 'readme.html',
    description: 'The VS Code Marketplace and GitHub readme overview.'
  }
];

/**
 * Basic markdown parser fallback if marked is not available.
 */
function basicMarkdownParse(md) {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/`([^`]+)`/gim, '<code>$1</code>')
    .replace(/\n\n/gim, '</p><p>');
  return `<p>${html}</p>`;
}

/**
 * Preprocess custom markdown extensions (GitHub Alerts, Carousels, Links, Mermaid).
 */
function preprocessMarkdown(content, currentDest) {
  let md = content;

  // 1. Rewrite internal documentation file links
  // Handles file:///usr/local/.../docs/XYZ.md, docs/XYZ.md, and XYZ.md
  for (const page of PAGES) {
    const srcBase = path.basename(page.source);
    // Replace full file:/// URLs
    const fileUriRegex = new RegExp(`file:///[^\\s)]*/(?:docs/)?${srcBase.replace('.', '\\.')}(#[^)\\s]*)?`, 'g');
    md = md.replace(fileUriRegex, (match, hash) => `${page.dest}${hash || ''}`);

    // Replace markdown links like [Text](docs/XYZ.md) or [Text](XYZ.md)
    const relLinkRegex = new RegExp(`\\]\\((?:docs/)?${srcBase.replace('.', '\\.')}(#[^)]*)?\\)`, 'g');
    md = md.replace(relLinkRegex, (match, hash) => `](${page.dest}${hash || ''})`);
  }

  // 2. Rewrite image sources (e.g. media/xxx.png or ../media/xxx.png -> media/xxx.png)
  md = md.replace(/\]\(\.\.\/media\/([^)]+)\)/g, '](media/$1)');
  md = md.replace(/src="\.\.\/media\/([^"]+)"/g, 'src="media/$1"');

  // 3. GitHub Callout Alerts: > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]
  const alertTypes = {
    NOTE: { title: 'Note', icon: 'ℹ️', class: 'alert-note' },
    TIP: { title: 'Tip', icon: '💡', class: 'alert-tip' },
    IMPORTANT: { title: 'Important', icon: '📌', class: 'alert-important' },
    WARNING: { title: 'Warning', icon: '⚠️', class: 'alert-warning' },
    CAUTION: { title: 'Caution', icon: '🛑', class: 'alert-caution' }
  };

  for (const [key, alertInfo] of Object.entries(alertTypes)) {
    const alertPattern = new RegExp(
      `^> \\[!${key}\\]\\s*\\n((?:^>.*\\n?)*)`,
      'gm'
    );
    md = md.replace(alertPattern, (match, body) => {
      const cleanedBody = body.replace(/^>\s?/gm, '').trim();
      return `\n<div class="omni-alert ${alertInfo.class}">
<div class="omni-alert-header"><span class="omni-alert-icon">${alertInfo.icon}</span> <strong>${alertInfo.title}</strong></div>
<div class="omni-alert-content">

${cleanedBody}

</div>
</div>\n`;
    });
  }

  // 4. Carousels (````carousel ... ````)
  md = md.replace(/````carousel\s*([\s\S]*?)````/g, (match, slidesBlock) => {
    const slides = slidesBlock.split('<!-- slide -->');
    const slideItems = slides.map((s, idx) => {
      return `<div class="omni-carousel-slide ${idx === 0 ? 'is-active' : ''}" data-slide="${idx}">\n\n${s.trim()}\n\n</div>`;
    }).join('\n');

    const tabs = slides.map((_, idx) => {
      return `<button type="button" class="omni-carousel-tab ${idx === 0 ? 'is-active' : ''}" data-tab="${idx}">Profile ${idx + 1}</button>`;
    }).join('');

    return `\n<div class="omni-carousel">
<div class="omni-carousel-nav">${tabs}</div>
<div class="omni-carousel-stage">
${slideItems}
</div>
</div>\n`;
  });

  return md;
}

/**
 * Extracts Table of Contents (h2, h3) from HTML and injects anchor ids.
 */
function extractTocAndInjectIds(html) {
  const toc = [];
  let headerIndex = 0;

  const transformedHtml = html.replace(/<(h[2-3])([^>]*)>(.*?)<\/\1>/gi, (match, tag, attrs, text) => {
    headerIndex++;
    // Extract plain text content without inner HTML tags
    const plainText = text.replace(/<[^>]+>/g, '').trim();
    
    // Check if an id already exists in attributes
    let idMatch = attrs.match(/id="([^"]+)"/i);
    let id = idMatch ? idMatch[1] : '';

    if (!id) {
      id = plainText
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/^-+|-+$/g, '') || `section-${headerIndex}`;
    }

    toc.push({
      level: parseInt(tag.charAt(1), 10),
      id,
      text: plainText
    });

    return `<${tag} id="${id}" class="omni-heading"${attrs}><a href="#${id}" class="omni-heading-anchor" aria-hidden="true">#</a>${text}</${tag}>`;
  });

  return { html: transformedHtml, toc };
}

/**
 * Generates the full HTML document for a documentation page.
 */
function renderPageTemplate(page, bodyHtml, toc, allPages) {
  // Group all pages by category for the sidebar
  const categories = {};
  for (const p of allPages) {
    if (!categories[p.category]) {
      categories[p.category] = [];
    }
    categories[p.category].push(p);
  }

  // Build sidebar HTML
  const sidebarHtml = Object.entries(categories).map(([catName, pageList]) => {
    const links = pageList.map(p => {
      const isActive = p.id === page.id;
      return `<li class="sidebar-item ${isActive ? 'is-active' : ''}">
        <a href="${p.dest}" class="sidebar-link ${isActive ? 'is-active' : ''}">
          <span class="link-label">${p.shortTitle}</span>
        </a>
      </li>`;
    }).join('\n');

    return `<div class="sidebar-group">
      <div class="sidebar-group-title">${catName}</div>
      <ul class="sidebar-group-list">
        ${links}
      </ul>
    </div>`;
  }).join('\n');

  // Build Table of Contents HTML
  const tocHtml = toc.length > 0
    ? `<ul class="toc-list">
        ${toc.map(item => `
          <li class="toc-item toc-level-${item.level}">
            <a href="#${item.id}" class="toc-link" data-toc-target="${item.id}">${item.text}</a>
          </li>
        `).join('\n')}
      </ul>`
    : '<p class="toc-empty">No subheadings on this page.</p>';

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${page.title} · OmniComment</title>
  <meta name="description" content="${page.description}">
  <link rel="icon" type="image/svg+xml" href="media/omnicomment.svg">
  <link rel="alternate icon" type="image/png" href="media/omnicomment.png">

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">

  <!-- Code Highlighting (Prism) -->
  <link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet" id="prism-theme" />
  
  <style>
    :root {
      --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', Consolas, Monaco, monospace;

      /* Dark Theme (Default) */
      --bg-canvas: #090D16;
      --bg-surface: #0F172A;
      --bg-subtle: #1E293B;
      --bg-card: #141E33;
      --border-color: rgba(255, 255, 255, 0.1);
      --border-hover: rgba(255, 255, 255, 0.2);
      --text-main: #F1F5F9;
      --text-muted: #94A3B8;
      --text-subtle: #64748B;
      
      --omni-cyan: #38BDF8;
      --omni-indigo: #6366F1;
      --omni-purple: #A855F7;
      --omni-pink: #EC4899;
      --omni-amber: #F59E0B;
      --omni-emerald: #10B981;

      --sidebar-width: 280px;
      --toc-width: 250px;
      --header-height: 64px;
    }

    [data-theme="light"] {
      --bg-canvas: #F8FAFC;
      --bg-surface: #FFFFFF;
      --bg-subtle: #F1F5F9;
      --bg-card: #FFFFFF;
      --border-color: rgba(0, 0, 0, 0.08);
      --border-hover: rgba(0, 0, 0, 0.16);
      --text-main: #0F172A;
      --text-muted: #475569;
      --text-subtle: #94A3B8;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--font-sans);
      background-color: var(--bg-canvas);
      color: var(--text-main);
      line-height: 1.65;
      font-size: 15px;
      overflow-x: hidden;
      transition: background-color 0.25s ease, color 0.25s ease;
    }

    /* Top Navigation Bar */
    .top-nav {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: var(--header-height);
      background-color: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border-color);
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1.5rem;
    }

    [data-theme="light"] .top-nav {
      background-color: rgba(255, 255, 255, 0.85);
    }

    .brand-group {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      text-decoration: none;
      color: var(--text-main);
    }

    .brand-logo {
      width: 32px;
      height: 32px;
      border-radius: 8px;
    }

    .brand-name {
      font-weight: 700;
      font-size: 1.15rem;
      letter-spacing: -0.02em;
      background: linear-gradient(135deg, #38BDF8 0%, #818CF8 50%, #C084FC 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .version-tag {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 9999px;
      background: rgba(56, 189, 248, 0.15);
      color: var(--omni-cyan);
      border: 1px solid rgba(56, 189, 248, 0.3);
    }

    .nav-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .btn-nav {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      padding: 0.45rem 0.85rem;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 500;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .btn-nav:hover {
      background: var(--bg-subtle);
      color: var(--text-main);
      border-color: var(--border-hover);
    }

    .theme-toggle-btn {
      width: 36px;
      height: 36px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.1rem;
    }

    /* Layout Structure */
    .app-container {
      display: flex;
      margin-top: var(--header-height);
      min-height: calc(100vh - var(--header-height));
    }

    /* Left Sidebar */
    .sidebar {
      width: var(--sidebar-width);
      position: fixed;
      top: var(--header-height);
      bottom: 0;
      left: 0;
      background-color: var(--bg-surface);
      border-right: 1px solid var(--border-color);
      overflow-y: auto;
      padding: 1.5rem 1rem 3rem 1rem;
      z-index: 50;
    }

    .sidebar-group {
      margin-bottom: 1.5rem;
    }

    .sidebar-group-title {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-subtle);
      margin-bottom: 0.5rem;
      padding-left: 0.6rem;
    }

    .sidebar-group-list {
      list-style: none;
    }

    .sidebar-item {
      margin-bottom: 2px;
    }

    .sidebar-link {
      display: flex;
      align-items: center;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 500;
      transition: all 0.15s ease;
    }

    .sidebar-link:hover {
      color: var(--text-main);
      background-color: var(--bg-subtle);
    }

    .sidebar-link.is-active {
      color: var(--omni-cyan);
      background: rgba(56, 189, 248, 0.1);
      font-weight: 600;
    }

    /* Main Content Area */
    .content-area {
      flex: 1;
      margin-left: var(--sidebar-width);
      margin-right: var(--toc-width);
      padding: 2.5rem 3rem 5rem 3rem;
      max-width: 900px;
    }

    /* Typography & Document Styles */
    h1, h2, h3, h4, h5, h6 {
      color: var(--text-main);
      font-weight: 700;
      line-height: 1.3;
      letter-spacing: -0.02em;
    }

    h1 {
      font-size: 2.4rem;
      margin-bottom: 1.25rem;
      font-weight: 800;
      letter-spacing: -0.03em;
    }

    h2 {
      font-size: 1.55rem;
      margin-top: 2.25rem;
      margin-bottom: 0.85rem;
      padding-bottom: 0.4rem;
      border-bottom: 1px solid var(--border-color);
      position: relative;
    }

    h3 {
      font-size: 1.2rem;
      margin-top: 1.75rem;
      margin-bottom: 0.65rem;
    }

    p {
      margin-bottom: 1.15rem;
      color: var(--text-main);
    }

    a {
      color: var(--omni-cyan);
      text-decoration: none;
      font-weight: 500;
    }

    a:hover {
      text-decoration: underline;
    }

    .omni-heading {
      scroll-margin-top: calc(var(--header-height) + 1.5rem);
    }

    .omni-heading-anchor {
      opacity: 0;
      margin-right: 0.4rem;
      color: var(--text-subtle);
      transition: opacity 0.2s ease;
      text-decoration: none !important;
    }

    .omni-heading:hover .omni-heading-anchor {
      opacity: 1;
    }

    /* Lists */
    ul, ol {
      margin-bottom: 1.25rem;
      padding-left: 1.5rem;
    }

    li {
      margin-bottom: 0.4rem;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.5rem 0;
      font-size: 0.9rem;
      background: var(--bg-card);
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border-color);
    }

    th, td {
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }

    th {
      background-color: var(--bg-subtle);
      font-weight: 600;
      color: var(--text-main);
    }

    tr:last-child td {
      border-bottom: none;
    }

    /* Code & Pre */
    code {
      font-family: var(--font-mono);
      font-size: 0.85em;
      padding: 0.2em 0.4em;
      border-radius: 4px;
      background: var(--bg-subtle);
      color: #F43F5E;
      border: 1px solid var(--border-color);
    }

    pre code {
      padding: 0;
      background: transparent;
      border: none;
      color: inherit;
    }

    pre {
      background: #0B0F19 !important;
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 1.2rem 1.4rem;
      margin: 1.25rem 0 1.75rem 0;
      overflow-x: auto;
      font-size: 0.88rem;
    }

    /* Blockquotes */
    blockquote {
      border-left: 4px solid var(--omni-cyan);
      background: var(--bg-subtle);
      padding: 0.85rem 1.25rem;
      margin: 1.25rem 0;
      border-radius: 0 8px 8px 0;
      color: var(--text-muted);
    }

    /* GitHub Alert Callouts */
    .omni-alert {
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin: 1.5rem 0;
      border-left: 4px solid;
      background: var(--bg-subtle);
    }

    .omni-alert-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.4rem;
      font-size: 0.95rem;
    }

    .omni-alert-content p:last-child {
      margin-bottom: 0;
    }

    .alert-note { border-color: #38BDF8; background: rgba(56, 189, 248, 0.08); }
    .alert-tip { border-color: #10B981; background: rgba(16, 185, 129, 0.08); }
    .alert-important { border-color: #8B5CF6; background: rgba(139, 92, 246, 0.08); }
    .alert-warning { border-color: #F59E0B; background: rgba(245, 158, 11, 0.08); }
    .alert-caution { border-color: #EF4444; background: rgba(239, 68, 68, 0.08); }

    /* Carousel */
    .omni-carousel {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      overflow: hidden;
      margin: 1.5rem 0;
    }

    .omni-carousel-nav {
      display: flex;
      background: var(--bg-subtle);
      border-bottom: 1px solid var(--border-color);
      overflow-x: auto;
    }

    .omni-carousel-tab {
      padding: 0.6rem 1rem;
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      white-space: nowrap;
      transition: all 0.2s;
    }

    .omni-carousel-tab:hover {
      color: var(--text-main);
    }

    .omni-carousel-tab.is-active {
      color: var(--omni-cyan);
      border-bottom-color: var(--omni-cyan);
      background: rgba(56, 189, 248, 0.05);
    }

    .omni-carousel-slide {
      display: none;
      padding: 1.25rem;
    }

    .omni-carousel-slide.is-active {
      display: block;
    }

    .omni-carousel-slide pre {
      margin: 0;
    }

    /* Right Table of Contents */
    .toc-container {
      width: var(--toc-width);
      position: fixed;
      top: var(--header-height);
      bottom: 0;
      right: 0;
      padding: 2rem 1.25rem;
      overflow-y: auto;
      border-left: 1px solid var(--border-color);
      font-size: 0.85rem;
    }

    .toc-title {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-subtle);
      margin-bottom: 0.85rem;
    }

    .toc-list {
      list-style: none;
      padding: 0;
    }

    .toc-item {
      margin-bottom: 0.45rem;
    }

    .toc-level-3 {
      padding-left: 0.85rem;
    }

    .toc-link {
      color: var(--text-muted);
      text-decoration: none;
      display: block;
      line-height: 1.4;
      transition: color 0.15s ease;
    }

    .toc-link:hover, .toc-link.is-active {
      color: var(--omni-cyan);
      font-weight: 500;
    }

    /* Page Navigation Footer */
    .page-footer-nav {
      display: flex;
      justify-content: space-between;
      margin-top: 4rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border-color);
    }

    .page-footer {
      margin-top: 3rem;
      text-align: center;
      color: var(--text-subtle);
      font-size: 0.85rem;
      padding-bottom: 2rem;
    }

    /* Responsive */
    @media (max-width: 1100px) {
      .toc-container { display: none; }
      .content-area { margin-right: 0; }
    }

    @media (max-width: 768px) {
      .sidebar {
        transform: translateX(-100%);
        transition: transform 0.25s ease;
      }
      .sidebar.is-open {
        transform: translateX(0);
      }
      .content-area {
        margin-left: 0;
        padding: 1.5rem;
      }
    }
  </style>
</head>
<body>
  <!-- Top Navigation Header -->
  <header class="top-nav">
    <div style="display: flex; align-items: center; gap: 1rem;">
      <a href="index.html" class="brand-group">
        <img src="media/omnicomment.svg" alt="OmniComment Logo" class="brand-logo" />
        <span class="brand-name">OmniComment</span>
      </a>
      <span class="version-tag">v0.1.0</span>
    </div>

    <div class="nav-actions">
      <a href="tutorial.html" class="btn-nav">Tutorial</a>
      <a href="api-reference.html" class="btn-nav">API</a>
      <a href="https://github.com/benquike/OmniComment" target="_blank" rel="noopener noreferrer" class="btn-nav">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
        GitHub
      </a>
      <button type="button" class="btn-nav theme-toggle-btn" id="theme-toggle" title="Toggle Light/Dark Theme">🌙</button>
    </div>
  </header>

  <div class="app-container">
    <!-- Left Categorized Sidebar -->
    <nav class="sidebar" id="sidebar">
      ${sidebarHtml}
    </nav>

    <!-- Main Content Area -->
    <main class="content-area" id="article-body">
      ${bodyHtml}

      <!-- Interactive Embedded OmniComment Web Component Demo -->
      <div style="margin-top: 3.5rem; padding-top: 1.5rem; border-top: 1px dashed var(--border-color);">
        <h3 style="margin-bottom: 0.75rem;">💬 Discussion on this page</h3>
        <p style="color: var(--text-muted); font-size: 0.9rem;">
          Leave a note or question on this documentation page. Powered by the <code>&lt;omni-comment&gt;</code> web component.
        </p>
        <omni-comment target="#article-body" preset="documentation-site" storage="local"></omni-comment>
      </div>

      <footer class="page-footer">
        <p>© 2026 OmniComment Contributors · Licensed under MIT</p>
      </footer>
    </main>

    <!-- Right Floating Table of Contents -->
    <aside class="toc-container">
      <div class="toc-title">On this page</div>
      ${tocHtml}
    </aside>
  </div>

  <!-- Client-side Interactive Scripts -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-typescript.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-json.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-bash.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-markdown.min.js"></script>
  
  <!-- Mermaid.js -->
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    mermaid.initialize({
      startOnLoad: true,
      theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose'
    });
  </script>

  <script>
    // Theme toggle handler
    const themeBtn = document.getElementById('theme-toggle');
    const htmlEl = document.documentElement;

    const savedTheme = localStorage.getItem('omnicomment-theme') || 'dark';
    htmlEl.setAttribute('data-theme', savedTheme);
    themeBtn.textContent = savedTheme === 'dark' ? '🌙' : '☀️';

    themeBtn.addEventListener('click', () => {
      const current = htmlEl.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      htmlEl.setAttribute('data-theme', next);
      localStorage.setItem('omnicomment-theme', next);
      themeBtn.textContent = next === 'dark' ? '🌙' : '☀️';
    });

    // Carousel Tab Switcher
    document.querySelectorAll('.omni-carousel').forEach(carousel => {
      const tabs = carousel.querySelectorAll('.omni-carousel-tab');
      const slides = carousel.querySelectorAll('.omni-carousel-slide');

      tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('is-active'));
          slides.forEach(s => s.classList.remove('is-active'));
          tab.classList.add('is-active');
          if (slides[index]) {
            slides[index].classList.add('is-active');
          }
        });
      });
    });

    // Scrollspy for Table of Contents
    const tocLinks = document.querySelectorAll('.toc-link');
    const headings = document.querySelectorAll('.omni-heading');

    function updateActiveToc() {
      const scrollPos = window.scrollY + 100;
      let activeId = null;

      for (let i = headings.length - 1; i >= 0; i--) {
        if (headings[i].offsetTop <= scrollPos) {
          activeId = headings[i].id;
          break;
        }
      }

      tocLinks.forEach(link => {
        if (link.getAttribute('data-toc-target') === activeId) {
          link.classList.add('is-active');
        } else {
          link.classList.remove('is-active');
        }
      });
    }

    window.addEventListener('scroll', updateActiveToc, { passive: true });
    updateActiveToc();
  </script>
</body>
</html>`;
}

/**
 * Builds all documentation files into the target output directory.
 */
function buildDocumentation(outDir = DEFAULT_OUT_DIR) {
  console.log(`\n📦 OmniComment Documentation Generator`);
  console.log(`-----------------------------------------`);
  console.log(`Source Root : ${ROOT_DIR}`);
  console.log(`Output Dir  : ${outDir}\n`);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Copy media directory to destination
  const mediaSrc = path.join(ROOT_DIR, 'media');
  const mediaDest = path.join(outDir, 'media');
  if (fs.existsSync(mediaSrc)) {
    fs.mkdirSync(mediaDest, { recursive: true });
    const mediaFiles = fs.readdirSync(mediaSrc);
    for (const f of mediaFiles) {
      const s = path.join(mediaSrc, f);
      const d = path.join(mediaDest, f);
      if (fs.statSync(s).isFile()) {
        fs.copyFileSync(s, d);
      }
    }
    console.log(`  ✓ Copied ${mediaFiles.length} media assets to ${path.relative(ROOT_DIR, mediaDest)}`);
  }

  let successCount = 0;

  for (const page of PAGES) {
    const srcPath = path.join(ROOT_DIR, page.source);
    if (!fs.existsSync(srcPath)) {
      console.warn(`  ⚠️  Source file not found: ${page.source}`);
      continue;
    }

    const rawMd = fs.readFileSync(srcPath, 'utf-8');
    const preprocessedMd = preprocessMarkdown(rawMd, page.dest);

    let rawHtml = '';
    if (marked) {
      // Configure marked with custom renderer for code blocks
      const renderer = new marked.Renderer();
      const defaultCode = renderer.code ? renderer.code.bind(renderer) : null;
      renderer.code = function(tokenOrCode, infostring) {
        let code = typeof tokenOrCode === 'object' ? tokenOrCode.text : tokenOrCode;
        let lang = (typeof tokenOrCode === 'object' ? tokenOrCode.lang : infostring) || '';
        
        if (lang === 'mermaid') {
          return `<div class="mermaid">\n${code}\n</div>`;
        }
        return `<pre><code class="language-${lang}">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
      };

      rawHtml = marked.parse(preprocessedMd, { renderer, gfm: true, breaks: false });
    } else {
      rawHtml = basicMarkdownParse(preprocessedMd);
    }

    const { html: transformedBody, toc } = extractTocAndInjectIds(rawHtml);
    const fullHtml = renderPageTemplate(page, transformedBody, toc, PAGES);

    const destPath = path.join(outDir, page.dest);
    fs.writeFileSync(destPath, fullHtml, 'utf-8');
    console.log(`  ✓ Rendered [${page.shortTitle}] -> ${path.relative(ROOT_DIR, destPath)} (${(fullHtml.length / 1024).toFixed(1)} KB)`);
    successCount++;
  }

  console.log(`\n🎉 Successfully built ${successCount} documentation pages in:`);
  console.log(`   file://${outDir}/index.html\n`);
  return { successCount, outDir };
}

/**
 * Local preview HTTP server.
 */
function serveDocumentation(outDir = DEFAULT_OUT_DIR, port = 3000) {
  buildDocumentation(outDir);

  const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.json': 'application/json',
    '.ico': 'image/x-icon'
  };

  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || reqPath === '') {
      reqPath = '/index.html';
    }

    const filePath = path.join(outDir, reqPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>404 Not Found</h1><p>The file <code>${reqPath}</code> was not found.</p><p><a href="/index.html">Back to Home</a></p>`);
    }
  });

  server.listen(port, () => {
    console.log(`🚀 OmniComment Documentation Server running at:`);
    console.log(`   http://localhost:${port}/`);
    console.log(`   Press Ctrl+C to stop.`);
  });
}

// CLI Execution Entry Point
if (require.main === module) {
  const args = process.argv.slice(2);
  let outDir = DEFAULT_OUT_DIR;
  let isServe = false;
  let port = 3000;

  for (const arg of args) {
    if (arg === '--serve') {
      isServe = true;
    } else if (arg.startsWith('--port=')) {
      port = parseInt(arg.split('=')[1], 10) || 3000;
    } else if (arg.startsWith('--out=')) {
      outDir = path.resolve(process.cwd(), arg.split('=')[1]);
    } else if (!arg.startsWith('--') && fs.existsSync(arg)) {
      // Single file rendering mode
      const singleOut = path.join(process.cwd(), path.basename(arg, path.extname(arg)) + '.html');
      const raw = fs.readFileSync(arg, 'utf-8');
      const parsed = marked ? marked.parse(raw) : basicMarkdownParse(raw);
      fs.writeFileSync(singleOut, parsed, 'utf-8');
      console.log(`Rendered ${arg} -> ${singleOut}`);
      process.exit(0);
    }
  }

  if (isServe) {
    serveDocumentation(outDir, port);
  } else {
    buildDocumentation(outDir);
  }
}

module.exports = {
  PAGES,
  preprocessMarkdown,
  extractTocAndInjectIds,
  buildDocumentation,
  renderPageTemplate
};
