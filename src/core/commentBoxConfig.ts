/**
 * Configuration options for the OmniComment in-editor and sidebar comment boxes.
 */
export type CommentBoxWidthMode = 'compact' | 'standard' | 'wide' | 'custom';

export interface CommentBoxConfig {
  widthMode: CommentBoxWidthMode;
  minWidth: number;
  maxWidth: number;
  fontSize: number;
  enableMarkdown: boolean;
  showAvatars: boolean;
  showThreadGuide: boolean;
  defaultAuthor?: string;
}

export const DEFAULT_COMMENT_BOX_CONFIG: CommentBoxConfig = {
  widthMode: 'standard',
  minWidth: 320,
  maxWidth: 460,
  fontSize: 12,
  enableMarkdown: true,
  showAvatars: true,
  showThreadGuide: true,
  defaultAuthor: ''
};

// Invariant: Resolves effective pixel dimensions and font size based on width density preset.
// Why: Provides predictable, ergonomic footprints across compact, standard, wide, and custom user setups.
// Example: resolveCommentBoxDimensions({ widthMode: 'compact' }) -> { minWidth: 280, maxWidth: 360, fontSize: 11 }
export function resolveCommentBoxDimensions(config?: Partial<CommentBoxConfig>): {
  minWidth: number;
  maxWidth: number;
  fontSize: number;
} {
  const mode = config?.widthMode || 'standard';
  const customMinWidth = config?.minWidth ?? 320;
  const customMaxWidth = config?.maxWidth ?? 460;
  const customFontSize = config?.fontSize ?? 12;

  if (mode === 'compact') {
    return {
      minWidth: 280,
      maxWidth: 360,
      fontSize: config?.fontSize ?? 11
    };
  }

  if (mode === 'wide') {
    return {
      minWidth: 420,
      maxWidth: 640,
      fontSize: config?.fontSize ?? 13
    };
  }

  if (mode === 'custom') {
    return {
      minWidth: Math.max(160, customMinWidth),
      maxWidth: Math.max(customMinWidth, customMaxWidth),
      fontSize: customFontSize
    };
  }

  return {
    minWidth: 320,
    maxWidth: 460,
    fontSize: customFontSize
  };
}
