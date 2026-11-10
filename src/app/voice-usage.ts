import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TeamsService } from './teams/teams.service';
import { formatVoiceSeconds, VoiceCreditsService, type VoiceCreditWallet } from './voice-credits.service';

@Component({
  selector: 'app-voice-limits-admin',
  imports: [FormsModule, DatePipe],
  styleUrl: './voice-limits-admin.css',
  template: `
    @if (loading()) {
      <p role="status">Loading voice limits…</p>
    } @else if (loadFailed()) {
      <p role="alert">Voice limits could not be loaded.</p>
      <button class="limits-save" type="button" (click)="loadPolicy()">Retry voice limits</button>
    } @else if (service.status(); as status) {
      @if (status.admin && status.policy; as policy) {
        <section class="limits-panel" aria-labelledby="voice-limits-title">
          <header class="limits-header">
            <span class="limits-icon material-symbols-outlined" aria-hidden="true">graphic_eq</span>
            <div class="limits-heading">
              <h2 id="voice-limits-title">Voice limits</h2>
              <p>{{ status.enabled ? 'Sponsored minutes and paid voice credits are active.' : 'Visitors can talk without voice credit limits.' }}</p>
            </div>
            <div class="limits-switch" role="group" aria-label="Voice limits On or Off"
              [attr.aria-describedby]="!status.relayConfigured || !status.checkoutConfigured ? 'voice-limits-setup' : null">
              <button type="button" [attr.aria-pressed]="status.enabled" [disabled]="busy() || status.enabled || !status.relayConfigured || !status.checkoutConfigured"
                (click)="save(true)">On</button>
              <button type="button" [attr.aria-pressed]="!status.enabled" [disabled]="busy() || !status.enabled"
                (click)="save(false)">Off</button>
            </div>
          </header>
          @if (!status.relayConfigured || !status.checkoutConfigured) {
            <div class="limits-setup" id="voice-limits-setup">
              <span class="material-symbols-outlined" aria-hidden="true">info</span>
              <div><strong>Setup required</strong><p>Connect the voice relay and set a Stripe credit pack price to turn limits on.</p></div>
            </div>
          }
          <form class="limits-defaults" (ngSubmit)="save(status.enabled)">
            <h3>Monthly defaults</h3>
            <div class="limits-fields">
              <label for="voice-limits-monthly">
                <strong>Minutes per creator</strong>
                <span>Shared across all their boards</span>
                <span class="limits-input">
                  <input id="voice-limits-monthly" type="number" min="0" max="100000" step="1" name="monthly" required [(ngModel)]="monthly">
                  <span aria-hidden="true">min</span>
                </span>
              </label>
              <label for="voice-limits-per-board">
                <strong>Sponsored minutes per board</strong>
                <span>Default cap for a single board</span>
                <span class="limits-input">
                  <input id="voice-limits-per-board" type="number" min="0" max="100000" step="1" name="perBoard" required [(ngModel)]="perBoard">
                  <span aria-hidden="true">min</span>
                </span>
              </label>
              <button class="limits-save" type="submit" [disabled]="busy()">Save defaults</button>
            </div>
          </form>
          <p class="limits-feedback" role="status">{{ busy() ? 'Updating voice limits…' : message() }}</p>
          @if (policy.changedAt) {
            <small class="limits-history">Last changed {{ policy.changedAt | date:'medium' }} by {{ policy.changedBy }}</small>
          }
        </section>
      } @else {
        <p>Voice limits can be managed by super admins.</p>
      }
    }
  `,
})
export class VoiceLimitsAdminComponent implements OnInit {
  readonly service = inject(VoiceCreditsService);
  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  readonly busy = signal(false);
  readonly message = signal('');
  monthly = 60;
  perBoard = 20;

  ngOnInit() {
    void this.loadPolicy();
  }

  async loadPolicy() {
    this.loading.set(true);
    this.loadFailed.set(false);
    try {
      const status = await this.service.refresh();
      if (status.policy) {
        this.monthly = status.policy.monthlyMinutes;
        this.perBoard = status.policy.boardMinutes;
      }
    } catch {
      this.loadFailed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async save(enabled: boolean) {
    const status = this.service.status();
    if (this.busy() || !status?.admin || !status.policy) return;
    if (enabled && !status.enabled
      && !window.confirm('Turn on sponsored voice limits and credit purchases for public talking avatars?')) return;
    const switchingOff = status.enabled && !enabled;
    this.busy.set(true);
    this.message.set('');
    try {
      await this.service.setPolicy(enabled, switchingOff ? status.policy.monthlyMinutes : this.monthly,
        switchingOff ? status.policy.boardMinutes : this.perBoard, status.policy.changedAt);
      this.message.set(enabled ? 'Voice limits are on.' : 'Voice limits are off.');
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Voice limits could not be saved.');
    } finally { this.busy.set(false); }
  }
}

@Component({
  selector: 'app-voice-usage',
  imports: [DatePipe, FormsModule, RouterLink],
  styleUrl: './voice-usage.css',
  template: `
    <main class="voice-usage-page">
      <a routerLink="/home">Back to Home</a>
      <h1>Voice Usage</h1>
      @if (notice()) { <p role="status">{{ notice() }}</p> }
      @if (paymentPending()) {
        <button type="button" [disabled]="busy()" (click)="checkPayment()">Check payment status</button>
      }
      @if (error()) { <p role="alert">{{ error() }}</p> }
      @if (teamChoices().length && service.status()?.enabled) {
        <label>Credit account
          <select [ngModel]="teamId()" (ngModelChange)="changeTeam($event)">
            <option value="">Personal</option>
            @for (team of teamChoices(); track team.teamId) { <option [value]="team.teamId">{{ team.name }}</option> }
          </select>
        </label>
      }
      @if (busy()) { <p role="status">Loading voice credits…</p> }
      @if (service.status()?.enabled === false) {
        <p>Voice credits are currently off.</p>
      } @else if (balance(); as account) {
        <section class="voice-credits-panel">
          <h2>{{ teamId() ? 'Team voice credits' : 'My voice credits' }}</h2>
          <p><strong>{{ time(account.seconds) }}</strong> purchased voice time available</p>
          <p>One credit equals one minute. Purchased credits carry over.</p>
          <button type="button" [disabled]="purchasing()" (click)="buy()">{{ purchasing() ? 'Opening checkout…' : 'Buy ' + account.packMinutes + ' voice credits' }}</button>
        </section>
        <section class="voice-credits-panel">
          <h2>Credits for my boards</h2>
          <p><strong>{{ time(account.includedRemaining) }}</strong> of included time left. Resets {{ account.resetAt | date:'mediumDate':'UTC' }} UTC.</p>
          <p>{{ time(account.hostedSeconds) }} sponsored time used across all boards this month.</p>
          @for (board of account.boards; track board.id) {
            <form class="voice-credits-actions voice-credits-board" (ngSubmit)="saveBoard(board.id)">
              <div><strong>{{ board.title }}</strong><br><small>{{ time(board.used) }} used this month</small></div>
              <label>Sponsored minutes per month
                <input type="number" min="0" max="100000" step="1" required [name]="board.id"
                  [ngModel]="caps[board.id]" (ngModelChange)="caps[board.id] = $event">
              </label>
              <button type="submit" [disabled]="savingBoard() !== ''">Save cap</button>
            </form>
          } @empty {
            <p>Public and unlisted boards will appear here.</p>
          }
        </section>
      }
    </main>
  `,
})
export class VoiceUsageComponent implements OnInit {
  readonly service = inject(VoiceCreditsService);
  private readonly teams = inject(TeamsService);
  private readonly route = inject(ActivatedRoute);
  readonly teamChoices = computed(() => this.teams.activeMemberships().filter((team) => team.role === 'admin'));
  readonly balance = signal<VoiceCreditWallet | null>(null);
  readonly teamId = signal('');
  readonly busy = signal(false);
  readonly purchasing = signal(false);
  readonly savingBoard = signal('');
  readonly notice = signal('');
  readonly error = signal('');
  readonly paymentPending = signal(false);
  readonly time = formatVoiceSeconds;
  caps: Record<string, number> = {};

  async ngOnInit() {
    this.teamId.set(this.route.snapshot.queryParamMap.get('team') || '');
    if (typeof location !== 'undefined' && new URL(location.href).searchParams.has('voiceCheckout')) {
      await this.checkPayment();
    } else await this.load();
  }

  async checkPayment() {
    this.busy.set(true);
    this.error.set('');
    try { this.notice.set(await this.service.confirmCheckout()); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Could not confirm payment.'); }
    this.paymentPending.set(new URL(location.href).searchParams.has('voiceSession'));
    await this.load();
  }

  async changeTeam(teamId: string) {
    this.teamId.set(teamId);
    await this.load();
  }

  private async load() {
    const teamId = this.teamId();
    this.balance.set(null);
    this.busy.set(true);
    try {
      if (!(await this.service.refresh()).enabled) return;
      const account = await this.service.wallet(teamId);
      if (this.teamId() !== teamId) return;
      this.caps = Object.fromEntries(account.boards.map((board) => [board.id, board.minutes]));
      this.balance.set(account);
    } catch (error) {
      if (this.teamId() === teamId) this.error.set(error instanceof Error ? error.message : 'Could not load voice credits.');
    } finally { if (this.teamId() === teamId) this.busy.set(false); }
  }

  async buy() {
    if (this.purchasing()) return;
    this.purchasing.set(true);
    this.error.set('');
    const team = this.teamId();
    try { await this.service.checkout(team ? `/voice-usage?team=${encodeURIComponent(team)}` : '/voice-usage', team); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Checkout could not start.'); }
    finally { this.purchasing.set(false); }
  }

  async saveBoard(id: string) {
    this.savingBoard.set(id);
    this.error.set('');
    try {
      await this.service.setBoardCap(id, this.caps[id], this.teamId());
      this.notice.set('Board cap saved.');
      await this.load();
    } catch (error) { this.error.set(error instanceof Error ? error.message : 'The board cap could not be saved.'); }
    finally { this.savingBoard.set(''); }
  }
}
