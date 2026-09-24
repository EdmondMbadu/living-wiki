import { offGridCopy } from './off-grid-copy';
import {
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  inject,
  input,
  output,
  effect,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MediaUpload, OffGridService } from './off-grid.service';
@Component({
  selector: 'app-pin-talk-recorder',
  imports: [FormsModule],
  templateUrl: './pin-talk-recorder.html',
  styleUrl: './off-grids.css',
})
export class PinTalkRecorderComponent {
  readonly copy = offGridCopy;
  readonly spotId = input.required<string>();
  readonly completed = output<void>();
  readonly busyChange = output<boolean>();
  private service = inject(OffGridService);
  private destroy = inject(DestroyRef);
  readonly camera = signal(false);
  readonly recording = signal(false);
  readonly reviewUrl = signal('');
  readonly error = signal('');
  readonly seconds = signal(0);
  readonly duration = signal(0);
  readonly uploading = signal(false);
  readonly processing = signal(false);
  readonly progress = signal(0);
  readonly muted = signal(false);
  caption = $localize``;
  trimStart = 0;
  trimEnd = 0;
  private file: File | Blob | null = null;
  private recorded = false;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private facing: 'user' | 'environment' = 'environment';
  private upload: MediaUpload | null = null;
  private disposed = false;
  private chunks: Blob[] = [];
  private startedAt = 0;
  @ViewChild('preview') preview?: ElementRef<HTMLVideoElement>;
  constructor() {
    effect(() => this.busyChange.emit(this.uploading() || this.recording()));
    const background = () => {
      if (document.hidden && this.recording()) this.stop();
    };
    document.addEventListener('visibilitychange', background);
    this.destroy.onDestroy(() => document.removeEventListener('visibilitychange', background));
    this.destroy.onDestroy(() => {
      this.disposed = true;
      this.upload?.cancel();
      this.shutdown();
      if (this.reviewUrl()) URL.revokeObjectURL(this.reviewUrl());
    });
  }
  supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }
  async openCamera(): Promise<void> {
    this.error.set('');
    if (!this.supported()) {
      this.error.set(
        $localize`This browser cannot record here. Use your phone camera or upload a video below.`,
      );
      return;
    }
    try {
      this.shutdown();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: { ideal: this.facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (this.disposed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.camera.set(true);
      this.muted.set(false);
      setTimeout(() => {
        if (this.preview) {
          this.preview.nativeElement.srcObject = stream;
          void this.preview.nativeElement.play().catch(() => undefined);
        }
      }, 0);
    } catch (error) {
      this.camera.set(false);
      this.error.set(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? $localize`Camera or microphone permission was denied. Allow access in your browser, or upload an existing video.`
          : $localize`Could not open the camera. Try uploading a video instead.`,
      );
    }
  }
  async flipCamera(): Promise<void> {
    if (this.recording()) return;
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    await this.openCamera();
  }
  toggleMic(): void {
    this.muted.update((v) => !v);
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !this.muted()));
  }
  start(): void {
    if (!this.stream) return;
    this.chunks = [];
    this.error.set('');
    const mime = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/webm;codecs=vp8,opus',
      'video/mp4',
      'video/webm',
    ].find((m) => MediaRecorder.isTypeSupported(m));
    try {
      this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      this.recorder.ondataavailable = (e) => {
        if (e.data.size) this.chunks.push(e.data);
      };
      this.recorder.onerror = () => {
        this.error.set($localize`Recording was interrupted. Please retry.`);
        this.stop();
      };
      this.recorder.onstop = () => {
        const type = this.recorder?.mimeType || this.chunks[0]?.type || 'video/webm',
          blob = new Blob(this.chunks, { type });
        if (!this.disposed && blob.size) {
          this.recorded = true;
          this.duration.set(Math.min(90, (Date.now() - this.startedAt) / 1000));
          this.setFile(blob);
          this.trimEnd = this.duration();
        }
        this.shutdown();
      };
      this.startedAt = Date.now();
      this.seconds.set(0);
      this.recorder.start(1000);
      this.recording.set(true);
      this.timer = setInterval(() => {
        this.seconds.set(Math.floor((Date.now() - this.startedAt) / 1000));
        if (this.seconds() >= 90) this.stop();
      }, 250);
    } catch {
      this.error.set($localize`Recording is unavailable in this browser. Upload a video instead.`);
      this.shutdown();
    }
  }
  stop(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.recording.set(false);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  closeCamera(): void {
    this.shutdown();
  }
  private shutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.camera.set(false);
    this.recording.set(false);
  }
  selected(event: Event): void {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set('');
    if (file.size <= 0 || file.size > 100 * 1024 * 1024) {
      this.error.set($localize`Choose a video under 100 MB.`);
      return;
    }
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v)$/i.test(file.name)) {
      this.error.set($localize`Choose an MP4, MOV or WebM video.`);
      return;
    }
    this.shutdown();
    this.recorded = false;
    this.duration.set(0);
    this.setFile(file);
  }
  private setFile(file: File | Blob): void {
    if (this.reviewUrl()) URL.revokeObjectURL(this.reviewUrl());
    this.file = file;
    this.reviewUrl.set(URL.createObjectURL(file));
    this.trimStart = 0;
    this.trimEnd = this.duration();
  }
  metadata(event: Event): void {
    const d = (event.target as HTMLVideoElement).duration;
    if (Number.isFinite(d) && d > 0) {
      this.duration.set(d);
      this.trimEnd = d;
      if (d > 180.5)
        this.error.set($localize`This video is longer than 3 minutes. Choose a shorter video.`);
    }
  }
  remove(): void {
    if (this.uploading()) return;
    if (this.reviewUrl()) URL.revokeObjectURL(this.reviewUrl());
    this.reviewUrl.set('');
    this.file = null;
    this.error.set('');
    this.caption = '';
    this.duration.set(0);
  }
  async submit(): Promise<void> {
    if (!this.file || this.uploading()) return;
    this.error.set('');
    if (
      this.duration() > 180.5 ||
      this.trimStart < 0 ||
      (this.trimEnd > 0 && this.trimEnd <= this.trimStart)
    ) {
      this.error.set($localize`Choose a valid video trim.`);
      return;
    }
    this.uploading.set(true);
    this.processing.set(false);
    this.progress.set(0);
    this.upload = this.service.upload(
      this.spotId(),
      this.file,
      'video',
      {
        recorded: this.recorded,
        caption: this.caption,
        trimStart: Number(this.trimStart),
        trimEnd: this.trimEnd > 0 ? Number(this.trimEnd) : null,
      },
      (p, processing) => {
        this.progress.set(p);
        this.processing.set(processing);
      },
    );
    try {
      await this.upload.promise;
      this.uploading.set(false);
      this.remove();
      this.completed.emit();
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : $localize`Could not add the PinTalk. Please retry.`,
      );
    } finally {
      this.uploading.set(false);
      this.processing.set(false);
      this.upload = null;
    }
  }
  cancelUpload(): void {
    this.upload?.cancel();
  }
}
