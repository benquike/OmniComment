/**
 * OmniComment Angular Component
 *
 * Standalone Angular component (Angular 17 / 18 / 19 compatible) providing
 * seamless integration with @omnicomment/web-plugin and the Angular SSR backend.
 *
 * Usage in template:
 * ```html
 * <omni-comment
 *   [target]="'#article-content'"
 *   [documentId]="'doc-release-notes'"
 *   [author]="'Ada Lovelace'"
 *   [apiEndpoint]="'/api/documents/doc-release-notes/comments'"
 *   (commentAdded)="onCommentCreated($event)"
 *   (commentResolved)="onCommentResolved($event)"
 * />
 * ```
 */

import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  ElementRef
} from '@angular/core';

@Component({
  selector: 'omni-comment',
  standalone: true,
  template: `
    <div class="omnicomment-angular-portal" #portalMount>
      <!-- The web component or web plugin attaches to this DOM node -->
    </div>
  `,
  styles: [`
    :host {
      display: block;
      position: relative;
    }
    .omnicomment-angular-portal {
      width: 100%;
    }
  `]
})
export class OmniCommentComponent implements OnInit, OnDestroy {
  @Input({ required: true }) target!: string;
  @Input({ required: true }) documentId!: string;
  @Input() author: string = 'Anonymous';
  @Input() apiEndpoint?: string;
  @Input() preset: string = 'documentation-site';

  @Output() commentAdded = new EventEmitter<any>();
  @Output() commentResolved = new EventEmitter<string>();

  private omniInstance: any = null;

  constructor(private elementRef: ElementRef) {}

  ngOnInit(): void {
    // Check if running in browser (safe for Angular SSR)
    if (typeof window === 'undefined') {
      return;
    }

    const endpoint = this.apiEndpoint || `/api/documents/${encodeURIComponent(this.documentId)}/comments`;

    // Dynamic import to prevent SSR server evaluation
    import('@omnicomment/web-plugin')
      .then(({ initOmniComment }) => {
        this.omniInstance = initOmniComment({
          target: this.target,
          documentId: this.documentId,
          author: this.author,
          preset: this.preset as any,
          storage: {
            type: 'rest',
            endpoint: endpoint
          },
          onCommentAdded: (c: any) => this.commentAdded.emit(c),
          onCommentResolved: (id: string) => this.commentResolved.emit(id)
        });
      })
      .catch((err) => {
        console.error('Failed to initialize OmniComment in Angular component:', err);
      });
  }

  ngOnDestroy(): void {
    if (this.omniInstance && typeof this.omniInstance.destroy === 'function') {
      this.omniInstance.destroy();
      this.omniInstance = null;
    }
  }
}
