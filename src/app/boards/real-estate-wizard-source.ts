import { Component, computed, input, model } from '@angular/core';
import {
  BOARD_NARRATION_STYLES,
  boardNarrationStyleById,
  defaultNarratorVoiceNameForStyle,
  normalizeBoardNarrationStyleId,
  type BoardNarrationStyleId,
} from './board-narration-style';
import {
  BOARD_NARRATION_LENGTH_PRESETS,
  DEFAULT_REAL_ESTATE_NARRATION_SECONDS_PER_CARD,
  boardNarrationDurationLabel,
  boardNarrationEstimatedTotalSeconds,
  boardNarrationTargetWords,
  normalizeBoardNarrationSeconds,
} from './board-narration-length';

/** Sale-listing configuration; ordinary and rental boards keep their existing form. */
@Component({
  selector: 'app-real-estate-wizard-source',
  templateUrl: './real-estate-wizard-source.html',
  styleUrl: './real-estate-wizard-source.css',
})
export class RealEstateWizardSourceComponent {
  readonly listingUrl = model('');
  readonly narrationStyle = model<BoardNarrationStyleId>('storyteller');
  readonly narrationSeconds = model(DEFAULT_REAL_ESTATE_NARRATION_SECONDS_PER_CARD);
  readonly cardCount = input(12);
  readonly styles = BOARD_NARRATION_STYLES;
  readonly presets = BOARD_NARRATION_LENGTH_PRESETS;
  readonly selectedStyle = computed(() => boardNarrationStyleById(this.narrationStyle())!);
  readonly voiceName = computed(() => defaultNarratorVoiceNameForStyle(this.narrationStyle()));
  readonly wordsPerCard = computed(() => boardNarrationTargetWords(this.narrationSeconds()));
  readonly totalSeconds = computed(() =>
    boardNarrationEstimatedTotalSeconds(this.cardCount(), this.narrationSeconds()),
  );
  readonly totalDuration = computed(() => boardNarrationDurationLabel(this.totalSeconds()));
  readonly customDuration = computed(
    () => !this.presets.some((preset) => preset.seconds === this.narrationSeconds()),
  );
  setStyle(value: string): void {
    this.narrationStyle.set(normalizeBoardNarrationStyleId(value));
  }
  setSeconds(value: unknown): void {
    this.narrationSeconds.set(normalizeBoardNarrationSeconds(value));
  }
  durationLabel(seconds: number): string {
    if (seconds < 60) return `${seconds} sec`;
    const remainder = seconds % 60;
    return `${Math.floor(seconds / 60)} min${remainder ? ` ${remainder} sec` : ''}`;
  }
}
