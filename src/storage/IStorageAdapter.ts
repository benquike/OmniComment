import { Comment } from '../core/types';

export interface IStorageAdapter {
  readonly name: string;
  loadComments(uri: string, rawContent?: string): Promise<Comment[]>;
  saveComments(uri: string, comments: Comment[], rawContent?: string): Promise<{ success: boolean; updatedContent?: string }>;
  deleteComments?(uri: string): Promise<boolean>;
}
