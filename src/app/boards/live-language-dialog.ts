import { AfterViewInit, Component, ElementRef, input, output, signal, ViewChild, OnDestroy } from '@angular/core';
import { BOARD_TRANSLATION_LANGUAGES, type BoardTranslationLanguage } from './board-translation';

@Component({
  selector: 'app-live-language-dialog',
  templateUrl: './live-language-dialog.html',
  styles: [`
    :host { position: relative; z-index: 11000; }
    dialog { position:fixed; inset:0; margin:auto; height:fit-content; width:min(440px,calc(100% - 32px)); max-height:calc(100dvh - 32px); padding:24px; overflow:hidden; border:1px solid #ffffff38; border-radius:24px; background:#f7faf8; color:#163c30; box-shadow:0 24px 90px #0008; }
    dialog::backdrop { background:#071b18aa; backdrop-filter:blur(5px); }
    form { display:flex; flex-direction:column; gap:12px; max-height:calc(100dvh - 82px); min-height:0; }
    form > :not(fieldset) { flex-shrink:0; }
    header { display:flex; align-items:center; justify-content:space-between; }
    header button { width:44px; height:44px; border:0; border-radius:50%; background:transparent; font-size:28px; color:inherit; cursor:pointer; }
    h2 { margin:0; font-size:28px; line-height:1.15; }
    p { margin:0; line-height:1.5; color:#446458; }
    fieldset { max-height:50dvh; overflow:auto; min-height:0; overscroll-behavior:contain; padding:3px; border:0; margin:4px 0; display:grid; gap:6px; }
    label { display:flex; align-items:center; gap:14px; padding:11px 14px; min-height:48px; border:1px solid #b9cbc3; border-radius:14px; cursor:pointer; background:#fff; }
    label.selected { background:#e2f3e9; border-color:#128357; }
    label strong { flex:1; unicode-bidi:isolate; font-size:16px; }
    label > span { font-size:24px; }
    input { width:20px; height:20px; accent-color:#128357; }
    .remember { font-size:12px; }
    .continue { min-height:48px; border:0; border-radius:24px; background:#146b49; color:white; font-size:16px; font-weight:700; cursor:pointer; }
    dialog:not(.live-language-dialog--first) { inset:70px max(16px,calc((100vw - 480px)/2)) auto auto; margin:0; width:360px; max-height:calc(100dvh - 90px); background:#102b23f5; color:white; color-scheme:dark; }
    dialog:not(.live-language-dialog--first) form { max-height:calc(100dvh - 140px); }
    dialog:not(.live-language-dialog--first) p { color:#d3e4da; }
    dialog:not(.live-language-dialog--first) fieldset { max-height:50dvh; overflow:auto; padding:3px; gap:4px; }
    dialog:not(.live-language-dialog--first) label { min-height:44px; padding:7px 12px; background:#ffffff08; border-color:#ffffff40; }
    dialog:not(.live-language-dialog--first) label > span { line-height:1; }
    dialog:not(.live-language-dialog--first) label.selected { background:#ffffff20; border-color:#86cfa9; }
    button:focus-visible, label:focus-within { outline:3px solid #159a6c; outline-offset:3px; }
    @media(max-width:600px) {
      dialog, dialog:not(.live-language-dialog--first) { inset:auto 0 0; margin:0; width:100%; max-width:none; max-height:95dvh; border-radius:24px 24px 0 0; padding:20px 20px max(20px,env(safe-area-inset-bottom)); }
      dialog.live-language-dialog--first { inset:0; height:100dvh; max-height:100dvh; border-radius:0; }
      form, dialog:not(.live-language-dialog--first) form { width:100%; max-height:calc(95dvh - 42px - env(safe-area-inset-bottom)); }
      .live-language-dialog--first form { max-height:calc(100dvh - 42px - env(safe-area-inset-bottom)); } h2 { font-size:26px; }
    }
  `],
})
export class LiveLanguageDialogComponent implements AfterViewInit, OnDestroy {
  readonly firstVisit = input(false);
  readonly initialLanguage = input<BoardTranslationLanguage>('en');
  readonly selected = output<BoardTranslationLanguage>();
  readonly dismissed = output<void>();
  readonly choice = signal<BoardTranslationLanguage>('en');
  readonly languages = BOARD_TRANSLATION_LANGUAGES;

  @ViewChild('dialog') dialog!: ElementRef<HTMLDialogElement>;
  ngAfterViewInit() { this.choice.set(this.initialLanguage()); this.dialog.nativeElement.showModal(); }
  ngOnDestroy() { this.dialog.nativeElement.close(); }
  dismissBackdrop(event: MouseEvent) { if (event.target === this.dialog.nativeElement) this.dismissed.emit(); }
}
