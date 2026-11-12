export type CardParticipant = { name?: string; email?: string; recapEmail?: string };

export function participantName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
}

export function participantEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim() : '';
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : '';
}

type ParticipantRecord = {
  expires_at?: { toMillis(): number };
  participant?: CardParticipant;
  recap_email?: string;
};

export function readCardParticipant(record?: ParticipantRecord, job?: ParticipantRecord): CardParticipant | undefined {
  const current = (value?: ParticipantRecord) =>
    value?.expires_at && value.expires_at.toMillis() >= Date.now() ? value : undefined;
  const row = current(record);
  const voice = current(job);
  const name = participantName(row?.participant?.name) || participantName(voice?.participant?.name);
  const email = participantEmail(row?.participant?.email) || participantEmail(voice?.participant?.email);
  const recapEmail = !email && (participantEmail(row?.recap_email) || participantEmail(voice?.recap_email));
  return name || email || recapEmail ? {
    ...(name ? { name } : {}), ...(email ? { email } : {}), ...(recapEmail ? { recapEmail } : {}),
  } : undefined;
}
