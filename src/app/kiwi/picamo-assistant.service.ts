import { Injectable, signal } from '@angular/core';

/** Shared entry point for Picamo invitations outside the floating launcher. */
@Injectable({ providedIn: 'root' })
export class PicamoAssistantService {
  readonly openRequests = signal(0);

  open(): void { this.openRequests.update(request => request + 1); }
}
