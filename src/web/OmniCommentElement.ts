/**
 * Standalone Web Component for OmniComment
 * Embeddable into any HTML page, Docusaurus, VitePress, or blog.
 */

import { Comment } from '../core/types';
import { AnchorEngine } from '../core/AnchorEngine';
import { MemoryStorageAdapter } from '../storage/MemoryStorageAdapter';

export class OmniCommentElement extends HTMLElement {
  private container: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private storage = new MemoryStorageAdapter();

  static get observedAttributes() {
    return ['preset', 'target', 'storage'];
  }

  connectedCallback() {
    if (typeof document === 'undefined') return;

    if (!this.shadowRoot && 'attachShadow' in this) {
      this.shadow = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        :host {
          display: block;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .omni-badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 6px;
          border-radius: 4px;
          background: #3b82f6;
          color: white;
          font-size: 11px;
          font-weight: 500;
        }
      `;
      this.container = document.createElement('div');
      this.container.className = 'omni-comment-root';
      this.shadow.appendChild(style);
      this.shadow.appendChild(this.container);
    }
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (oldValue !== newValue) {
      this.render();
    }
  }

  public render() {
    if (!this.container) return;
    const preset = (this as any).getAttribute?.('preset') || 'documentation-site';
    this.container.innerHTML = `
      <div class="omni-status">
        <span class="omni-badge">OmniComment (${preset})</span>
      </div>
    `;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('omni-comment')) {
  customElements.define('omni-comment', OmniCommentElement as any);
}
