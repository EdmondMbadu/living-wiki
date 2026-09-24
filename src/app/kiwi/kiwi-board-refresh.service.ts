import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class KiwiBoardRefreshService {
  private revision = 0;
  readonly request = signal<{ boardId: string; revision: number } | null>(null);

  notify(boardId: string): void {
    this.request.set({ boardId, revision: ++this.revision });
  }
}
