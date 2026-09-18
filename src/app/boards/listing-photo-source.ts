import { Component, input, model, output } from '@angular/core';

export type ListingPhotoSource = 'url' | 'upload';
export type ListingPhotoPreview = { id: string; name: string; imageUrl: string };
export type PersistedListingPhoto = ListingPhotoPreview & { storagePath: string };

@Component({
  selector: 'app-listing-photo-source',
  templateUrl: './listing-photo-source.html',
  styleUrl: './listing-photo-source.css',
})
export class ListingPhotoSourceComponent {
  readonly source = model<ListingPhotoSource>('url');
  readonly photos = input<readonly ListingPhotoPreview[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly selected = output<Event>();
  readonly removed = output<string>();
  readonly coverChanged = output<string>();
}
