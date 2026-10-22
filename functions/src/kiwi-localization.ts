// Picamo's fixed server replies are outside Angular's compile-time catalogs.
// Keep source text as the lookup key so call sites retain their existing replies.
const replies: Record<string, readonly [german: string, chinese: string]> = {
  'Tell Picamo what you would like to do.': ['Sagen Sie Picamo, was Sie tun möchten.', '请告诉 Picamo 您想做什么。'],
  'What kind of board would you like? Describe it in a sentence, or choose a Real Estate listing or Walking Tour.': ['Welche Art von Board möchten Sie erstellen? Beschreiben Sie es in einem Satz oder wählen Sie ein Immobilienangebot oder einen Stadtrundgang.', '您想创建什么类型的看板？请用一句话描述，或选择房产介绍或步行导览。'],
  'Picamo could not prepare a response. Please try again.': ['Picamo konnte keine Antwort vorbereiten. Bitte versuchen Sie es erneut.', 'Picamo 暂时无法准备回复，请重试。'],
  'Tell me a little more about what you would like to make.': ['Erzählen Sie mir etwas mehr darüber, was Sie erstellen möchten.', '请再介绍一下您想创建的内容。'],
  'I could not prepare a valid board draft yet. Please try again or tell me the board type and visibility.': ['Ich konnte noch keinen gültigen Board-Entwurf vorbereiten. Versuchen Sie es erneut oder nennen Sie mir die Art des Boards und seine Sichtbarkeit.', '暂时无法准备有效的看板草稿。请重试，或告诉我看板类型和可见范围。'],
  'I’ll use Describe it to research and prepare this board.': ['Ich verwende die Beschreibungsfunktion, um dieses Board zu recherchieren und vorzubereiten.', '我将使用描述功能进行研究并准备此看板。'],
  'What should this board be about? Describe it in a sentence and I’ll make cards with images.': ['Worum soll es auf diesem Board gehen? Beschreiben Sie es in einem Satz, und ich erstelle Karten mit Bildern.', '此看板的主题是什么？请用一句话描述，我会创建带图片的卡片。'],
  'Private boards require an eligible plan. I can make this Public or Unlisted if you choose one of those.': ['Private Boards erfordern einen geeigneten Tarif. Sie können stattdessen ein öffentliches oder nicht gelistetes Board wählen.', '私密看板需要符合条件的订阅方案。您也可以选择创建公开或不公开列出的看板。'],
  'I can only copy another person’s public personal board. Open that board first.': ['Ich kann nur öffentliche persönliche Boards anderer Personen kopieren. Öffnen Sie zuerst das gewünschte Board.', '我只能复制他人的公开个人看板。请先打开该看板。'],
  'I can email only a board in your personal workspace. Open one of your boards first.': ['Ich kann nur Boards aus Ihrem persönlichen Arbeitsbereich per E-Mail senden. Öffnen Sie zuerst eines Ihrer Boards.', '我只能通过电子邮件发送您个人工作区中的看板。请先打开您的一个看板。'],
  'Private boards cannot be emailed. You can share this board after making it Public or Unlisted in board settings.': ['Private Boards können nicht per E-Mail versendet werden. Ändern Sie die Sichtbarkeit in den Board-Einstellungen auf öffentlich oder nicht gelistet, um das Board zu teilen.', '私密看板无法通过电子邮件发送。请先在看板设置中将其改为公开或不公开列出，再进行分享。'],
  'Verify your email address before asking me to send a board.': ['Bestätigen Sie Ihre E-Mail-Adresse, bevor Sie mich bitten, ein Board zu senden.', '请先验证您的电子邮件地址，再让我发送看板。'],
  'Open the board you want to change, then ask me again.': ['Öffnen Sie das Board, das Sie ändern möchten, und bitten Sie mich dann erneut darum.', '请打开您想修改的看板，然后再次提出请求。'],
  'This board belongs to someone else. I can make a copy in your account; then you can ask me to edit that copy.': ['Dieses Board gehört einer anderen Person. Ich kann eine Kopie in Ihrem Konto erstellen, die Sie anschließend bearbeiten lassen können.', '此看板属于他人。我可以在您的账户中创建副本，然后您可以让我修改该副本。'],
  'This board is read-only for your account.': ['Sie haben für dieses Board nur Leserechte.', '您的账户只能查看此看板。'],
  'This team listing is archived. Ask a team admin to restore it before editing.': ['Dieses Immobilienangebot des Teams ist archiviert. Bitten Sie einen Teamadministrator, es vor der Bearbeitung wiederherzustellen.', '此团队房产介绍已归档。请先让团队管理员恢复，然后再进行编辑。'],
  'This board can hold up to 200 cards. Remove a card before adding more.': ['Dieses Board kann bis zu 200 Karten enthalten. Entfernen Sie eine Karte, bevor Sie weitere hinzufügen.', '此看板最多可容纳 200 张卡片。请先移除一张卡片，再添加更多内容。'],
  'I could not find that card on the open board. Please choose a card.': ['Ich konnte diese Karte auf dem geöffneten Board nicht finden. Bitte wählen Sie eine Karte aus.', '在当前打开的看板中找不到该卡片。请选择一张卡片。'],
};

export function kiwiLocalizedReply(locale: string, english: string): string {
  if (locale === 'de') return replies[english]?.[0] ?? english;
  if (locale === 'zh-Hans') return replies[english]?.[1] ?? english;
  return english;
}
