import assert from 'node:assert/strict'

import { test } from 'vitest'

import { hasWindowsPathPrefix, isExternalVenvHolder, isFileyOwnedVenvDaemon } from './venv-holder-select'

const SCRIPTS = 'C:\\Filey\\venv\\Scripts'

test('matches the hindsight daemon shim (exe under venv Scripts + hindsight cmdline)', () => {
  assert.equal(
    isFileyOwnedVenvDaemon(
      'C:\\Filey\\venv\\Scripts\\pythonw.exe',
      'C:\\Filey\\venv\\Scripts\\pythonw.exe -m hindsight_api.main --daemon --idle-timeout 300 --port 9177',
      SCRIPTS
    ),
    true
  )
})

test('Windows path prefix match is ordinal case-insensitive', () => {
  assert.equal(
    isFileyOwnedVenvDaemon(
      'c:\\filey\\venv\\scripts\\python.exe',
      'python.exe -m hindsight_api.main --daemon',
      'C:\\Filey\\venv\\Scripts'
    ),
    true
  )
})

test('excludes external venv holders that are not the hindsight daemon', () => {
  // a user terminal running the filey CLI from the venv — must NOT be killed
  assert.equal(isFileyOwnedVenvDaemon('C:\\Filey\\venv\\Scripts\\filey.exe', 'filey chat -q "hi"', SCRIPTS), false)
  // an unrelated python script using the venv interpreter
  assert.equal(
    isFileyOwnedVenvDaemon('C:\\Filey\\venv\\Scripts\\python.exe', 'python C:\\tools\\import.py', SCRIPTS),
    false
  )
})

test('excludes exes outside the venv even when the cmdline mentions hindsight', () => {
  assert.equal(
    isFileyOwnedVenvDaemon('C:\\Other\\pythonw.exe', 'pythonw -m hindsight_api.main --daemon', SCRIPTS),
    false
  )
})

test('prefix boundary: sibling dirs (ScriptsX) do not match', () => {
  assert.equal(hasWindowsPathPrefix('C:\\Filey\\venv\\ScriptsX\\python.exe', SCRIPTS), false)
  assert.equal(hasWindowsPathPrefix('C:\\Filey\\venv\\Scripts\\python.exe', SCRIPTS), true)
})

test('null/undefined fields never match', () => {
  assert.equal(isFileyOwnedVenvDaemon(null, 'x', SCRIPTS), false)
  assert.equal(isFileyOwnedVenvDaemon('C:\\Filey\\venv\\Scripts\\pythonw.exe', null, SCRIPTS), false)
  assert.equal(isFileyOwnedVenvDaemon(undefined, undefined, SCRIPTS), false)
})

// --- isExternalVenvHolder (#62311) ------------------------------------------

test('matches the autostart gateway shim (filey.exe under venv Scripts)', () => {
  assert.equal(
    isExternalVenvHolder(
      'C:\\Filey\\venv\\Scripts\\filey.exe',
      '"C:\\Filey\\venv\\Scripts\\filey.exe" gateway run --external-supervisor',
      SCRIPTS
    ),
    true
  )
})

test('matches the dashboard scheduled task (python -m filey_cli / -m filey)', () => {
  assert.equal(
    isExternalVenvHolder(
      'C:\\Filey\\venv\\Scripts\\python.exe',
      '"C:\\Filey\\venv\\Scripts\\python.exe" -m filey_cli.main dashboard',
      SCRIPTS
    ),
    true
  )
  assert.equal(
    isExternalVenvHolder('C:\\Filey\\venv\\Scripts\\pythonw.exe', 'pythonw.exe -m filey serve', SCRIPTS),
    true
  )
})

test('never matches an unrelated process that merely borrows the venv interpreter', () => {
  // a user's own script running on the venv python — NOT Filey, must NOT be killed
  assert.equal(
    isExternalVenvHolder('C:\\Filey\\venv\\Scripts\\python.exe', 'python C:\\tools\\import.py', SCRIPTS),
    false
  )
  // hindsight daemon is selected by isFileyOwnedVenvDaemon, not here
  assert.equal(
    isExternalVenvHolder('C:\\Filey\\venv\\Scripts\\pythonw.exe', 'pythonw -m hindsight_api.main --daemon', SCRIPTS),
    false
  )
})

test('never matches a process outside the venv, even with filey in the cmdline', () => {
  // an editor / shell whose command line mentions the install root (#62445 regression guard)
  assert.equal(
    isExternalVenvHolder('C:\\Windows\\System32\\cmd.exe', 'cmd /c cd C:\\Filey\\venv\\Scripts && dir', SCRIPTS),
    false
  )
  assert.equal(isExternalVenvHolder('C:\\Other\\filey.exe', 'filey gateway run', SCRIPTS), false)
})

test('sibling-dir and boundary safety for the external selector', () => {
  assert.equal(isExternalVenvHolder('C:\\Filey\\venv\\ScriptsX\\filey.exe', 'filey gateway run', SCRIPTS), false)
  assert.equal(isExternalVenvHolder(null, 'filey gateway run', SCRIPTS), false)
  assert.equal(isExternalVenvHolder('C:\\Filey\\venv\\Scripts\\filey.exe', null, SCRIPTS), false)
})
