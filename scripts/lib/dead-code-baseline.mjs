// Candidate identities deliberately omit source positions: moving code is not
// new debt. This ledger records pending review, never permission to delete code.
export function deadCodeCandidateIds(report) {
  if (report.schemaVersion !== 1) throw new Error('Unsupported dead-code report');
  const ids = [];
  for (const issue of report.tools.knip.issues) {
    for (const [kind, candidates] of Object.entries(issue)) {
      if (kind === 'file') continue;
      if (!Array.isArray(candidates)) throw new Error(`Invalid knip issue: ${kind}`);
      for (const candidate of candidates) {
        const names = (Array.isArray(candidate) ? candidate : [candidate]).map(
          (item) => {
            if (typeof item === 'string') return item;
            if (typeof item?.name !== 'string') throw new Error('Invalid knip candidate');
            return item.name;
          },
        ).sort();
        ids.push(JSON.stringify(['knip', issue.file, kind, ...names]));
      }
    }
  }
  for (const candidate of report.tools.tsPrune.candidates) {
    const match = /^(.+):\d+ - (.+?)(?: \(used in module\))?$/u.exec(candidate);
    if (!match) throw new Error(`Invalid ts-prune candidate: ${candidate}`);
    ids.push(JSON.stringify(['ts-prune', match[1], match[2]]));
  }
  for (const cycle of report.tools.madge.circular) {
    if (!Array.isArray(cycle) || cycle.length === 0 || cycle.some((file) => typeof file !== 'string')) {
      throw new Error('Invalid madge cycle');
    }
    // Rotations describe the same directed cycle; reversed edges do not.
    const rotations = cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)]);
    rotations.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
    ids.push(JSON.stringify(['madge', ...rotations[0]]));
  }
  return [...new Set(ids)].sort();
}

export function compareDeadCodeBaseline(report, baseline, platform = process.platform) {
  if (baseline?.schemaVersion !== 1 || !Array.isArray(baseline.candidates) ||
      baseline.candidates.some((id) => typeof id !== 'string') ||
      new Set(baseline.candidates).size !== baseline.candidates.length) {
    throw new Error('Invalid dead-code baseline');
  }
  // Scanner results differ across macOS/Linux even for a clean checkout.
  // Exact recorded omissions remain strict: reappearing names are NEW findings.
  const omissionsByPlatform = baseline.platformOmissions ?? {};
  if (!omissionsByPlatform || typeof omissionsByPlatform !== 'object' || Array.isArray(omissionsByPlatform)) {
    throw new Error('Invalid dead-code platform baseline');
  }
  for (const omissions of Object.values(omissionsByPlatform)) {
    if (!Array.isArray(omissions) || new Set(omissions).size !== omissions.length ||
        omissions.some((id) => typeof id !== 'string' || !baseline.candidates.includes(id))) {
      throw new Error('Invalid dead-code platform baseline');
    }
  }
  const omitted = new Set(omissionsByPlatform[platform] ?? []);
  const current = new Set(deadCodeCandidateIds(report));
  const previous = new Set(baseline.candidates.filter((id) => !omitted.has(id)));
  return {
    added: [...current].filter((id) => !previous.has(id)).sort(),
    resolved: [...previous].filter((id) => !current.has(id)).sort(),
  };
}
