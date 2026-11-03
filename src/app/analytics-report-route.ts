/** Report access tokens must not enter analytics, assistant context or external referrers. */
export function isAnalyticsReportPath(path: string): boolean {
  return /^(?:\/(?:fr|ja|pt|es|de|zh|it|ko|ar|hi|ru))?\/reports\/boards(?:\/|$)/.test(path);
}
