import { Injectable, signal, untracked } from '@angular/core';

export interface PicamoCityChatContext {
  name: string;
  avatarUrl: string;
  focus: () => void;
}

/** The app-shell launcher uses the city's existing conversation while a city page is mounted. */
@Injectable({ providedIn: 'root' })
export class PicamoCityChatService {
  readonly context = signal<PicamoCityChatContext | null>(null);

  connect(context: PicamoCityChatContext): () => void {
    this.context.set(context);
    return () => {
      if (untracked(this.context) === context) this.context.set(null);
    };
  }
}
