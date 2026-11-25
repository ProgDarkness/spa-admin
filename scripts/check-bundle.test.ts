import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findForbiddenMarkers, MAX_BUNDLE_FILE_BYTES } from './check-bundle'

const FORBIDDEN_MARKERS = ['mockIPC', 'createCatalogIpcBackend', 'installDevBrowserIpc', '__spaInvoke']

let bundleDirectory: string

beforeEach(() => {
  bundleDirectory = mkdtempSync(join(tmpdir(), 'bundle-'))
  mkdirSync(join(bundleDirectory, '_next', 'static', 'chunks'), { recursive: true })
})

afterEach(() => rmSync(bundleDirectory, { recursive: true, force: true }))

function writeChunk(relativePath: string, content: string): void {
  writeFileSync(join(bundleDirectory, relativePath), content)
}

describe('findForbiddenMarkers', () => {
  it('no reporta nada en un bundle limpio', () => {
    writeChunk('index.html', '<html>app</html>')
    writeChunk('_next/static/chunks/app.js', 'export const x = 1')

    expect(findForbiddenMarkers(bundleDirectory)).toEqual([])
  })

  it.each(FORBIDDEN_MARKERS)('detecta %s en un chunk anidado', (marker) => {
    writeChunk('_next/static/chunks/app.js', `const a = 1;${marker}();`)

    expect(findForbiddenMarkers(bundleDirectory)).toEqual([
      { file: join('_next', 'static', 'chunks', 'app.js'), marker },
    ])
  })

  it('reporta cada marcador de cada archivo', () => {
    writeChunk('index.html', 'mockIPC')
    writeChunk('_next/static/chunks/app.js', 'installDevBrowserIpc __spaInvoke')

    const found = findForbiddenMarkers(bundleDirectory)

    expect(found.map((entry) => entry.marker).sort()).toEqual(['__spaInvoke', 'installDevBrowserIpc', 'mockIPC'])
  })

  it('falla si el directorio no existe', () => {
    expect(() => findForbiddenMarkers(join(bundleDirectory, 'ausente'))).toThrow()
  })

  it('recorre subdirectorios profundos y no solo el primer nivel', () => {
    mkdirSync(join(bundleDirectory, 'a', 'b', 'c'), { recursive: true })
    writeChunk('a/b/c/deep.js', 'mockIPC')

    expect(findForbiddenMarkers(bundleDirectory)).toEqual([{ file: join('a', 'b', 'c', 'deep.js'), marker: 'mockIPC' }])
  })

  describe('enlaces simbólicos', () => {
    let outsideDirectory: string

    beforeEach(() => {
      outsideDirectory = mkdtempSync(join(tmpdir(), 'bundle-outside-'))
    })

    afterEach(() => rmSync(outsideDirectory, { recursive: true, force: true }))

    it('falla cerrado si apunta a un archivo fuera del directorio', () => {
      writeFileSync(join(outsideDirectory, 'secret.js'), 'x')
      symlinkSync(join(outsideDirectory, 'secret.js'), join(bundleDirectory, 'escape.js'))

      expect(() => findForbiddenMarkers(bundleDirectory)).toThrow('fuera del directorio')
    })

    it('falla cerrado si apunta a un hermano que comparte prefijo con el directorio', () => {
      const sibling = `${bundleDirectory}-vecino`
      mkdirSync(sibling)
      writeFileSync(join(sibling, 'x.js'), 'x')
      symlinkSync(join(sibling, 'x.js'), join(bundleDirectory, 'vecino.js'))

      try {
        expect(() => findForbiddenMarkers(bundleDirectory)).toThrow('fuera del directorio')
      } finally {
        rmSync(sibling, { recursive: true, force: true })
      }
    })

    it('falla cerrado si el enlace está roto', () => {
      symlinkSync(join(outsideDirectory, 'ausente.js'), join(bundleDirectory, 'dangling.js'))

      expect(() => findForbiddenMarkers(bundleDirectory)).toThrow('roto')
    })

    it('acepta un enlace que apunta dentro del directorio', () => {
      writeChunk('_next/static/chunks/app.js', 'limpio')
      symlinkSync(join(bundleDirectory, '_next', 'static', 'chunks', 'app.js'), join(bundleDirectory, 'alias.js'))

      expect(findForbiddenMarkers(bundleDirectory)).toEqual([])
    })
  })

  describe('tope de tamaño por archivo', () => {
    it('falla cerrado si un archivo supera el tope', () => {
      writeChunk('_next/static/chunks/big.js', 'x'.repeat(11))

      expect(() => findForbiddenMarkers(bundleDirectory, { maxFileBytes: 10 })).toThrow('big.js')
    })

    it('acepta un archivo que mide exactamente el tope', () => {
      writeChunk('_next/static/chunks/exact.js', 'x'.repeat(10))

      expect(findForbiddenMarkers(bundleDirectory, { maxFileBytes: 10 })).toEqual([])
    })

    it('usa 50 MiB como tope por defecto', () => {
      expect(MAX_BUNDLE_FILE_BYTES).toBe(50 * 1024 * 1024)
    })
  })
})
