const SEED_SPECIFIER = /(?:^|\/)seed(?:\.tsx?)?$/

const STATEMENT_PATTERNS: readonly RegExp[] = [
  /\b(?:import|export)\s+(type\s+)?[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*()['"]([^'"]+)['"]/g,
  /\b(?:import|require)\s*\(\s*()['"]([^'"]+)['"]/g,
]

function isTypeOnlyStatement(typeKeyword: string | undefined): boolean {
  return typeKeyword !== undefined && typeKeyword !== ''
}

export function findRuntimeSeedImports(source: string): string[] {
  return STATEMENT_PATTERNS.flatMap((pattern) =>
    [...source.matchAll(pattern)]
      .filter(([, typeKeyword, specifier]) => !isTypeOnlyStatement(typeKeyword) && SEED_SPECIFIER.test(specifier ?? ''))
      .map((match) => ({ index: match.index, specifier: match[2] as string })),
  )
    .toSorted((first, second) => first.index - second.index)
    .map(({ specifier }) => specifier)
}
