import { Component, input, output } from '@angular/core';
import type { ListingContactCardDetails } from './listing-contact-card';

@Component({
  selector: 'app-listing-live-closing',
  templateUrl: './listing-live-closing.html',
  styleUrl: './listing-live-closing.css',
})
export class ListingLiveClosingComponent {
  readonly contact = input.required<ListingContactCardDetails>();
  readonly imageUrl = input('');
  readonly propertyTitle = input('');
  readonly replay = output<void>();
  readonly returnToBoard = output<void>();
  readonly agentLabel = $localize`the listing agent`;
  readonly callLabel = $localize`Call`;
  readonly emailLabel = $localize`Email`;
}
