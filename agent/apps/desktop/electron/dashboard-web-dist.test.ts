import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { resolveDashboardWebDist } from './dashboard-web-dist'

function touchIndex(dir) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>')
}

function withTempRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filey-dashboard-web-dist-'))

  try {
    return fn(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('desktop-spawned dashboard resolves filey_cli/web_dist, not Desktop renderer dist', () => {
  withTempRoot(root => {
    const activeFileyRoot = path.join(root, 'filey-agent')

    const desktopDist = path.join(
      activeFileyRoot,
      'apps',
      'desktop',
      'release',
      'win-unpacked',
      'resources',
      'app.asar.unpacked',
      'dist'
    )

    const dashboardDist = path.join(activeFileyRoot, 'filey_cli', 'web_dist')
    touchIndex(desktopDist)
    touchIndex(dashboardDist)
    assert.equal(
      resolveDashboardWebDist({
        activeFileyRoot,
        appRoot: path.join(activeFileyRoot, 'apps', 'desktop'),
        env: {}
      }),
      dashboardDist
    )
  })
})

test('explicit dashboard dist override wins when it exists', () => {
  withTempRoot(root => {
    const override = path.join(root, 'custom-dashboard-dist')
    touchIndex(override)
    assert.equal(
      resolveDashboardWebDist({
        activeFileyRoot: path.join(root, 'filey-agent'),
        env: { FILEY_DESKTOP_DASHBOARD_WEB_DIST: override }
      }),
      override
    )
  })
})

test('missing dashboard bundle falls back to canonical path for a clear child error', () => {
  withTempRoot(root => {
    const activeFileyRoot = path.join(root, 'filey-agent')
    assert.equal(
      resolveDashboardWebDist({ activeFileyRoot, env: {} }),
      path.join(activeFileyRoot, 'filey_cli', 'web_dist')
    )
  })
})

test('appRoot candidate is used when it has a dashboard bundle and activeFileyRoot does not', () => {
  withTempRoot(root => {
    const activeFileyRoot = path.join(root, 'active-install')
    const sourceRoot = path.join(root, 'source-checkout')
    const appRoot = path.join(sourceRoot, 'apps', 'desktop')
    const appRootDashboard = path.resolve(appRoot, '..', '..', 'filey_cli', 'web_dist')
    fs.mkdirSync(activeFileyRoot, { recursive: true })
    touchIndex(appRootDashboard)
    assert.equal(
      resolveDashboardWebDist({
        activeFileyRoot,
        appRoot,
        env: {}
      }),
      appRootDashboard
    )
  })
})
