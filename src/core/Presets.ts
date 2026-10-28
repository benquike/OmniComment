import { OmniCommentPresetConfig, OmniCommentPresetId } from './types';

export const OMNI_COMMENT_PRESETS: Record<OmniCommentPresetId, OmniCommentPresetConfig> = {
  'default': {
    id: 'default',
    name: 'Default',
    description: 'Standard in-file Markdown storage with balanced inline cards and sidebar navigation',
    uiDensity: 'balanced',
    defaultStorage: 'markdown',
    allowReactions: true,
    enableAgentHooks: true,
    zeroDomCollapsing: true,
    highlightColor: 'rgba(255, 212, 0, 0.3)',
    highlightBorderColor: 'rgba(255, 212, 0, 0.8)'
  },
  'documentation-site': {
    id: 'documentation-site',
    name: 'Documentation Site',
    description: 'Minimalist inline chips and reading-focused UI for public documentation and blogs',
    uiDensity: 'compact',
    defaultStorage: 'local',
    allowReactions: false,
    enableAgentHooks: false,
    zeroDomCollapsing: true,
    highlightColor: 'rgba(59, 130, 246, 0.25)',
    highlightBorderColor: 'rgba(59, 130, 246, 0.7)'
  },
  'git-file-review': {
    id: 'git-file-review',
    name: 'Git File Review',
    description: 'Strict line-level anchoring and side-by-side diff focus for code reviews',
    uiDensity: 'compact',
    defaultStorage: 'markdown',
    allowReactions: true,
    enableAgentHooks: true,
    zeroDomCollapsing: true,
    highlightColor: 'rgba(245, 158, 11, 0.3)',
    highlightBorderColor: 'rgba(245, 158, 11, 0.85)'
  },
  'browser-annotator': {
    id: 'browser-annotator',
    name: 'Browser Annotator',
    description: 'High-contrast highlights and floating overlay cards for web page annotations',
    uiDensity: 'compact',
    defaultStorage: 'sync',
    allowReactions: true,
    enableAgentHooks: false,
    zeroDomCollapsing: true,
    highlightColor: 'rgba(16, 185, 129, 0.3)',
    highlightBorderColor: 'rgba(16, 185, 129, 0.85)'
  },
  'team-collaboration': {
    id: 'team-collaboration',
    name: 'Team Collaboration',
    description: 'Full avatar threading, reaction tracking, and resolution workflows for engineering teams',
    uiDensity: 'full',
    defaultStorage: 'markdown',
    allowReactions: true,
    enableAgentHooks: true,
    zeroDomCollapsing: true,
    highlightColor: 'rgba(139, 92, 246, 0.3)',
    highlightBorderColor: 'rgba(139, 92, 246, 0.85)'
  },
  'ai-agent-reviewer': {
    id: 'ai-agent-reviewer',
    name: 'AI Agent Reviewer',
    description: 'Agent badges, structured JSON output, and automated check hooks for autonomous agents',
    uiDensity: 'balanced',
    defaultStorage: 'markdown',
    allowReactions: true,
    enableAgentHooks: true,
    zeroDomCollapsing: true,
    highlightColor: 'rgba(99, 102, 241, 0.35)',
    highlightBorderColor: 'rgba(99, 102, 241, 0.9)'
  }
};

export function getPresetConfig(id: string | undefined): OmniCommentPresetConfig {
  if (id && id in OMNI_COMMENT_PRESETS) {
    return OMNI_COMMENT_PRESETS[id as OmniCommentPresetId];
  }
  return OMNI_COMMENT_PRESETS['default'];
}

export function getAllPresets(): OmniCommentPresetConfig[] {
  return Object.values(OMNI_COMMENT_PRESETS);
}
