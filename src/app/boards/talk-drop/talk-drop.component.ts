import { Component, OnDestroy, inject, input, output, signal } from '@angular/core';
import { TalkDropVideo, talkDropFileError } from './talk-drop';
import { TalkDropUploadService, TalkDropUpload } from './talk-drop-upload.service';

@Component({
  selector: 'app-talk-drop',
  templateUrl: './talk-drop.html',
  styleUrl: './talk-drop.css',
})
export class TalkDropComponent implements OnDestroy {
  readonly video = input<TalkDropVideo | null>(null);
  readonly poster = input('');
  readonly editable = input(false);
  readonly videoChange = output<TalkDropVideo | null>();
  readonly uploadingChange = output<boolean>();
  readonly progress = signal<number | null>(null);
  readonly error = signal('');
  readonly playRequested = output<MouseEvent>();
  private readonly uploader = inject(TalkDropUploadService);
  private upload: TalkDropUpload | null = null;
  private run = 0;

  async selectVideo(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const error = talkDropFileError(file);
    if (error) { this.error.set(error); return; }
    this.cancelUpload();
    const run = this.run;
    this.error.set('');
    this.progress.set(0);
    this.uploadingChange.emit(true);
    try {
      this.upload = this.uploader.upload(file, percent => {
        if (run === this.run) this.progress.set(percent);
      });
      const video = await this.upload.result;
      if (run === this.run) this.videoChange.emit(video);
    } catch (error) {
      if (run === this.run) this.error.set(error instanceof Error ? error.message : 'Video upload failed. Try again.');
    } finally {
      if (run === this.run) {
        this.upload = null;
        this.progress.set(null);
        this.uploadingChange.emit(false);
      }
    }
  }

  cancelUpload(): void {
    this.run++;
    this.upload?.cancel();
    this.upload = null;
    this.progress.set(null);
    this.uploadingChange.emit(false);
  }

  removeVideo(): void {
    this.cancelUpload();
    this.error.set('');
    this.videoChange.emit(null);
  }

  ngOnDestroy(): void { this.cancelUpload(); }
}
