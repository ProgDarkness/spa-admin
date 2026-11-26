import { validateRelease } from './release-version'

function main(): number {
  const tag = process.argv[2]
  if (tag === undefined) {
    console.error('uso: release-version-cli.ts <tag vX.Y.Z>')
    return 1
  }
  try {
    const result = validateRelease(tag, process.cwd())
    if (!result.ok) {
      result.errors.forEach((error) => console.error(error))
      return 1
    }
    console.log(result.version)
    return 0
  } catch (caught: unknown) {
    console.error(caught instanceof Error ? caught.message : String(caught))
    return 1
  }
}

process.exit(main())
