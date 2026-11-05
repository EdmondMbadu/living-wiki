type ExportRecord = Record<string, any>;
/** Focused exchange export: explicitly omit persona, configuration, private sources and reviewer identities. */
export function qaAnswersExport(run: ExportRecord, results: ExportRecord[]) {
  const lookup = new Map(results.map(result => [result.id, result]));
  return { format: 'livingwiki.avatar-qa.results', schemaVersion: 1,
    run: { id: run.id, avatarName: run.avatarName || '', createdAt: run.createdAt, finishedAt: run.finishedAt || '',
      status: run.status, source: run.source || 'generated', suiteName: run.suiteName || '', generatedBy: run.generatedBy || '',
      protocol: run.protocol, assessmentVersion: run.assessmentVersion || null, fingerprint: run.fingerprint,
      total: run.total, completed: run.completed, passed: run.passed, failed: run.failed, errors: run.errors || 0, cancelled: run.cancelled || 0 },
    limitation: run.protocol === 'avatar-stress-v1'
      ? 'English text responses only. Automated assessments are advisory; no guarantee about future answers or voice behavior.'
      : 'Historical exact-wording checks only. No clinical correctness, audio behavior or regulatory approval is established.',
    questions: (run.references || []).map((question: ExportRecord) => {
      const result = lookup.get(question.id);
      return { id: question.id, category: question.category, question: question.question,
        expectedBehavior: question.expectedBehavior || '',
        ...(typeof question.expectedAnswer === 'string' ? { expectedAnswer: question.expectedAnswer } : {}), status: result?.status || 'unavailable', error: result?.error || '',
        turns: (result?.turns || []).map((turn: ExportRecord) => ({ question: turn.question, actualAnswer: turn.actualAnswer || '',
          answerMode: turn.answerMode || 'unknown', status: turn.status, critical: turn.critical === true,
          severity: turn.severity || '', title: turn.title || '', reason: turn.reason || '' })) };
    }) };
}
