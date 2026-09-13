import { Injectable, inject } from '@angular/core';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { AuthService } from '../../auth.service';
import { getFirebaseStorage } from '../../firebase.client';
import { TalkDropVideo, talkDropFileError, talkDropFileType } from './talk-drop';

export interface TalkDropUpload {
  result: Promise<TalkDropVideo>;
  cancel(): void;
}

@Injectable({ providedIn: 'root' })
export class TalkDropUploadService {
  private readonly auth = inject(AuthService);

  upload(file: File, onProgress: (percent: number) => void): TalkDropUpload {
    const uid = this.auth.uid();
    if (!uid) throw new Error('Sign in before adding a Talk Drop.');
    const error = talkDropFileError(file);
    if (error) throw new Error(error);
    const mimeType = talkDropFileType(file);
    const extension = mimeType === 'video/quicktime' ? 'mov' : mimeType === 'video/webm' ? 'webm' : 'mp4';
    const task = uploadBytesResumable(
      ref(getFirebaseStorage(), `users/${uid}/boards/talk-drops/${crypto.randomUUID()}.${extension}`),
      file,
      { contentType: mimeType, cacheControl: 'public,max-age=31536000,immutable' },
    );
    const result = new Promise<TalkDropVideo>((resolve, reject) => {
      task.on('state_changed',
        snapshot => onProgress(Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100)),
        reject,
        () => { getDownloadURL(task.snapshot.ref).then(url => resolve({
          url, mimeType, fileName: file.name.slice(0, 180),
        }), reject); },
      );
    });
    return { result, cancel: () => { task.cancel(); } };
  }
}
