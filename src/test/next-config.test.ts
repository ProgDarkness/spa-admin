import { describe, expect, it } from 'vitest'
import nextConfig from '../../next.config'

describe('next.config', () => {
  it('desactiva agentRules', () => {
    expect((nextConfig as { agentRules?: unknown }).agentRules).toBe(false)
  })

  it('mantiene la exportación estática', () => {
    expect(nextConfig.output).toBe('export')
  })
})
