import { describe, expect, it } from 'vitest'

import {
  normalizeFileyOpenString,
  pathFromFileyDeepLink,
  pathFromOpenDeepLink,
  resolveFileyOpenPath
} from './filey-open-target'

describe('normalizeFileyOpenString', () => {
  it('accepts hash-router paths and strips a leading hash', () => {
    expect(normalizeFileyOpenString('/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeFileyOpenString('#/index-network/intent/1')).toBe('/index-network/intent/1')
  })

  it('maps plugin-scoped filey:// deep links to the same path', () => {
    expect(normalizeFileyOpenString('filey://index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeFileyOpenString('filey://index-network/intent/1?focus=true')).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('maps filey://open/… deep links by stripping the open host', () => {
    expect(normalizeFileyOpenString('filey://open/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeFileyOpenString('filey://open/settings/plugins')).toBe('/settings/plugins')
  })

  it('rejects reserved filey kinds and unsafe paths', () => {
    expect(normalizeFileyOpenString('filey://blueprint/morning-brief')).toBeNull()
    expect(normalizeFileyOpenString('filey://plugin/install')).toBeNull()
    expect(normalizeFileyOpenString('https://example.com/x')).toBeNull()
    expect(normalizeFileyOpenString('/../etc/passwd')).toBeNull()
    expect(normalizeFileyOpenString('index-network')).toBeNull()
  })
})

describe('resolveFileyOpenPath', () => {
  it('merges structured path + params', () => {
    expect(resolveFileyOpenPath({ path: '/index-network/intent/1', params: { focus: 'true' } })).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('resolves href the same as a bare string', () => {
    expect(resolveFileyOpenPath({ href: 'filey://index-network/intent/1' })).toBe('/index-network/intent/1')
  })
})

describe('pathFromFileyDeepLink', () => {
  it('builds the navigate path from a plugin-scoped deep-link payload', () => {
    expect(pathFromFileyDeepLink('index-network', 'intent/1')).toBe('/index-network/intent/1')
  })

  it('builds the navigate path from filey://open/… payloads', () => {
    expect(pathFromOpenDeepLink('index-network/intent/1')).toBe('/index-network/intent/1')
    expect(pathFromFileyDeepLink('open', 'agent/42')).toBe('/agent/42')
  })

  it('ignores reserved kinds', () => {
    expect(pathFromFileyDeepLink('blueprint', 'morning-brief')).toBeNull()
    expect(pathFromFileyDeepLink('plugin', 'install')).toBeNull()
  })
})
