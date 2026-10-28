import { Comment } from '../core/types';
import { IStorageAdapter } from './IStorageAdapter';

export class MemoryStorageAdapter implements IStorageAdapter {
  public readonly name = 'in-memory';
  private storage: Map<string, Comment[]> = new Map();

  public async loadComments(uri: string): Promise<Comment[]> {
    return this.storage.get(uri) || [];
  }

  public async saveComments(
    uri: string,
    comments: Comment[]
  ): Promise<{ success: boolean; updatedContent?: string }> {
    this.storage.set(uri, [...comments]);
    return { success: true };
  }

  public async deleteComments(uri: string): Promise<boolean> {
    return this.storage.delete(uri);
  }

  public clear(): void {
    this.storage.clear();
  }
}
