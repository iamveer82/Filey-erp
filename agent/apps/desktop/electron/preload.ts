import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'

import type { DesktopProfileRoute } from './desktop-profile'
import type { HudModifierApi, HudModifierStatus } from './hud-modifier-types'
import { customWindowControlsEnabled } from './window-controls'

// Which translucency the OS can back. Asked synchronously because the renderer
// needs it before its first paint, and answered by main because deciding it
// needs `os.release()` — a sandboxed preload may only require electron, events,
// timers and url, so importing node:os here throws before contextBridge runs
// and takes the ENTIRE bridge down with it (window.fileyDesktop undefined =>
// "Desktop IPC bridge is unavailable"). No reply means no glass, which degrades
// to an ordinary opaque window rather than a page thinned over nothing.
const translucencySupport = ipcRenderer.sendSync('filey:translucency:support')
const hudWindowing = ipcRenderer.sendSync('filey:hud:windowing')
const hudNativeDrag = hudWindowing?.nativeDrag === true

const launchFlags: { localModels?: boolean; guestOnboarding?: boolean } | undefined =
  ipcRenderer.sendSync('filey:feature-flags')

// Local, sanitized skin payload for the first renderer theme paint. This does
// not wait on `gateway.ready`, so an unreachable remote primary cannot force
// the built-in palette over the skin configured on this machine.
const localSkin = ipcRenderer.sendSync('filey:skin:local')

import { unwrapExpectedNotFound } from './api-expected-404'

contextBridge.exposeInMainWorld('fileyDesktop', {
  glassSupported: translucencySupport?.glass === true,
  translucencySupported: translucencySupport?.translucency === true,
  // Launch-flag fact: the app was started with --local, so the renderer may
  // show the local-models surfaces. Static for the window's lifetime.
  localModelsEnabled: launchFlags?.localModels === true,
  // Launch-flag fact: the Nous free tier is on for this launch
  // (FILEY_GUEST_ONBOARDING=1 or --guest-onboarding). Read-only; the same
  // decision is stamped onto every backend the app spawns.
  guestOnboardingEnabled: launchFlags?.guestOnboarding === true,
  localSkin: localSkin && typeof localSkin === 'object' ? localSkin : null,
  getConnection: (profile, opts) => ipcRenderer.invoke('filey:connection', profile, opts),
  // Loopback origin that hosts YouTube's player for the file:// renderer.
  getEmbedHostOrigin: () => ipcRenderer.invoke('filey:embed-host:origin'),
  // Registry-scoped backend resolution: { connectionId, profile } → descriptor.
  getConnectionFor: payload => ipcRenderer.invoke('filey:connection:for', payload),
  getProfileRoutes: profiles => ipcRenderer.invoke('filey:plugin-profile-routes', profiles),
  revalidateConnection: () => ipcRenderer.invoke('filey:connection:revalidate'),
  touchBackend: (profile, options) => ipcRenderer.invoke('filey:backend:touch', profile, options),
  getPoolLimits: () => ipcRenderer.invoke('filey:pool-limits:get'),
  setPoolLimits: limits => ipcRenderer.invoke('filey:pool-limits:set', limits),
  getGatewayWsUrl: profile => ipcRenderer.invoke('filey:gateway:ws-url', profile),
  // Registry-scoped fresh WS URL: { connectionId, profile } → result shape of
  // getGatewayWsUrl, minted against that connection's backend.
  getGatewayWsUrlFor: payload => ipcRenderer.invoke('filey:gateway:ws-url-for', payload),
  // Union agent roster across every registered connection.
  getAgentRoster: () => ipcRenderer.invoke('filey:agents:roster'),
  openSessionWindow: (sessionId, opts) => ipcRenderer.invoke('filey:window:openSession', sessionId, opts),
  openSessionInTerminal: (sessionId, opts) => ipcRenderer.invoke('filey:window:openInTerminal', sessionId, opts),
  openWindow: (options?: DesktopProfileRoute) => ipcRenderer.invoke('filey:window:openInstance', options),
  openBrowserWindow: tabId => ipcRenderer.invoke('filey:window:openBrowser', tabId),
  windowRelay: {
    send: payload => ipcRenderer.send('filey:window:relay', payload),
    onMessage: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('filey:window:relay', listener)

      return () => ipcRenderer.removeListener('filey:window:relay', listener)
    }
  },
  onBrowserPopoutClosed: callback => {
    const listener = (_event, tabId) => callback(tabId)
    ipcRenderer.on('filey:browser-popout:closed', listener)

    return () => ipcRenderer.removeListener('filey:browser-popout:closed', listener)
  },
  claimAmbientCue: key => ipcRenderer.invoke('filey:ambient:claim', key),
  windowControls: {
    custom: customWindowControlsEnabled(),
    minimize: () => ipcRenderer.send('filey:window-control', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('filey:window-control', 'toggle-maximize'),
    close: () => ipcRenderer.send('filey:window-control', 'close')
  },
  wakeIndicator: {
    getState: () => ipcRenderer.invoke('filey:wake-indicator:get'),
    setState: state => ipcRenderer.send('filey:wake-indicator:set', state),
    onState: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('filey:wake-indicator:state', listener)

      return () => ipcRenderer.removeListener('filey:wake-indicator:state', listener)
    }
  },
  chatOnboarding: {
    size: mode => ipcRenderer.send('filey:window:size', mode)
  },
  petOverlay: {
    // Main renderer → main process: window lifecycle + drag. `request` is
    // `{ bounds, screen }`; resolves with the screen bounds it actually used.
    open: request => ipcRenderer.invoke('filey:pet-overlay:open', request),
    close: () => ipcRenderer.invoke('filey:pet-overlay:close'),
    setBounds: bounds => ipcRenderer.send('filey:pet-overlay:set-bounds', bounds),
    setIgnoreMouse: ignore => ipcRenderer.send('filey:pet-overlay:ignore-mouse', ignore),
    // Flip the overlay focusable (and focus it) while the composer needs keys.
    setFocusable: focusable => ipcRenderer.send('filey:pet-overlay:set-focusable', focusable),
    // Main renderer → overlay (forwarded by main): push the latest pet state.
    pushState: payload => ipcRenderer.send('filey:pet-overlay:state', payload),
    // Overlay → main renderer (forwarded by main): pop back in / composer submit.
    control: payload => ipcRenderer.send('filey:pet-overlay:control', payload),
    // Overlay subscribes to state pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('filey:pet-overlay:state', listener)

      return () => ipcRenderer.removeListener('filey:pet-overlay:state', listener)
    },
    // Main renderer subscribes to overlay control messages.
    onControl: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('filey:pet-overlay:control', listener)

      return () => ipcRenderer.removeListener('filey:pet-overlay:control', listener)
    }
  },
  // HUD mode: the chrome-free floating chat. A full app renderer (own gateway)
  // sized as a floating bar, so it mounts the real composer. Main owns the
  // window; `onChanged` keeps every window's toggle truthful.
  hud: {
    nativeDrag: hudNativeDrag,
    windowing: {
      clientPlacement: hudWindowing?.clientPlacement !== false,
      controlDrag: hudWindowing?.controlDrag === true,
      nativeDrag: hudNativeDrag,
      solid: hudWindowing?.solid === true,
      workspaceTransfer: hudWindowing?.workspaceTransfer === true
    },
    open: request => ipcRenderer.invoke('filey:hud:open', request),
    close: () => ipcRenderer.invoke('filey:hud:close'),
    setIgnoreMouse: ignore => ipcRenderer.send('filey:hud:ignore-mouse', ignore),
    beginMove: () => ipcRenderer.send('filey:hud:begin-move'),
    endMove: () => ipcRenderer.send('filey:hud:end-move'),
    moveBy: delta => ipcRenderer.send('filey:hud:move-by', delta),
    setWorkspaceTransfer: transferring => ipcRenderer.send('filey:hud:workspace-transfer', transferring),
    setBounds: bounds => ipcRenderer.send('filey:hud:set-bounds', bounds),
    resetLayout: () => ipcRenderer.invoke('filey:hud:reset-layout'),
    // Whether the band covers the window below the bar. Main pairs it with the
    // user's translucency setting to decide the native frost (macOS vibrancy /
    // Windows 11 DWM backdrop) — see hudFrostFor.
    setFrost: showing => ipcRenderer.invoke('filey:hud:frost', showing),
    // The HUD tells main which session it is on; main hands that back to the
    // app window when the HUD closes, so the app can re-home onto it.
    setSession: sessionId => ipcRenderer.send('filey:hud:session', sessionId),
    onGoto: callback => {
      const listener = (_event, sessionId) => callback(sessionId)
      ipcRenderer.on('filey:hud:goto', listener)

      return () => ipcRenderer.removeListener('filey:hud:goto', listener)
    },
    onChanged: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('filey:hud:changed', listener)

      return () => ipcRenderer.removeListener('filey:hud:changed', listener)
    },
    // Linux only, and silent elsewhere: where the cursor is, in page
    // coordinates, or null when it has left the window. Stands in for the
    // mousemove that `setIgnoreMouseEvents(true, { forward: true })` delivers on
    // macOS and Windows but not here.
    onCursor: callback => {
      const listener = (_event, point) => callback(point)
      ipcRenderer.on('filey:hud:cursor', listener)

      return () => ipcRenderer.removeListener('filey:hud:cursor', listener)
    },
    // Main's game-overlay watch: whether a fullscreen app (a game) is under
    // the HUD, so the renderer can step back to the low-opacity overlay
    // treatment while one owns the screen.
    onGameOverlay: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('filey:hud:game-overlay', listener)

      return () => ipcRenderer.removeListener('filey:hud:game-overlay', listener)
    }
  },
  hudModifier: {
    getSettings: () => ipcRenderer.invoke('filey:hud-modifier:settings:get'),
    setEnabled: enabled => ipcRenderer.invoke('filey:hud-modifier:settings:set', enabled),
    openPermissionSettings: () => ipcRenderer.invoke('filey:hud-modifier:permission'),
    onStatus: callback => {
      const listener = (_event: Electron.IpcRendererEvent, status: HudModifierStatus) => callback(status)
      ipcRenderer.on('filey:hud-modifier:status', listener)

      return () => ipcRenderer.removeListener('filey:hud-modifier:status', listener)
    }
  } satisfies HudModifierApi,
  // macOS native screenshot gesture; captures require a main-issued request.
  screenshot:
    process.platform === 'darwin'
      ? {
          getSettings: () => ipcRenderer.invoke('filey:screenshot:settings:get'),
          setEnabled: enabled => ipcRenderer.invoke('filey:screenshot:settings:set', enabled),
          openPermissionSettings: kind => ipcRenderer.invoke('filey:screenshot:permission', kind),
          capture: requestId => ipcRenderer.invoke('filey:screenshot:capture', requestId),
          onStatus: callback => {
            const listener = (_event, status) => callback(status)
            ipcRenderer.on('filey:screenshot:status', listener)

            return () => ipcRenderer.removeListener('filey:screenshot:status', listener)
          },
          onRequest: callback => {
            const channel = 'filey:screenshot:request'
            const listener = (_event, requestId) => callback(requestId)

            if (ipcRenderer.listenerCount(channel) === 0) {
              ipcRenderer.send('filey:screenshot:subscribe', true)
            }

            ipcRenderer.on(channel, listener)

            return () => {
              ipcRenderer.removeListener(channel, listener)

              if (ipcRenderer.listenerCount(channel) === 0) {
                ipcRenderer.send('filey:screenshot:subscribe', false)
              }
            }
          }
        }
      : undefined,
  // Quick Entry: the global-hotkey mini composer window. Main owns the OS
  // shortcut + the persisted preference; the quick window only captures text
  // and hands it back, and the primary renderer submits it through the normal
  // prompt path.
  quickEntry: {
    getSettings: () => ipcRenderer.invoke('filey:quick-entry:settings:get'),
    setSettings: patch => ipcRenderer.invoke('filey:quick-entry:settings:set', patch),
    // Invoke returns the delivery result so the draft is not lost (#85590).
    submit: payload => ipcRenderer.invoke('filey:quick-entry:submit', payload),
    // Main cannot invoke the primary renderer, so it receives this ack (#85590).
    ackSubmit: (correlationId, result) => ipcRenderer.send('filey:quick-entry:ack', { correlationId, result }),
    dismiss: () => ipcRenderer.send('filey:quick-entry:dismiss'),
    // Primary renderer → main → quick window: gateway connection state + the
    // recent-session options the target picker offers. Main caches the latest
    // payload so a freshly spawned quick window starts from truth.
    pushState: payload => ipcRenderer.send('filey:quick-entry:state', payload),
    // Quick window subscribes to those pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('filey:quick-entry:state', listener)

      return () => ipcRenderer.removeListener('filey:quick-entry:state', listener)
    },
    // Main → primary renderer: a submit captured by the quick window.
    onSubmit: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('filey:quick-entry:submit', listener)

      return () => ipcRenderer.removeListener('filey:quick-entry:submit', listener)
    },
    // Main → quick window: you were just summoned (reset draft + refocus).
    onShown: callback => {
      const listener = () => callback()
      ipcRenderer.on('filey:quick-entry:shown', listener)

      return () => ipcRenderer.removeListener('filey:quick-entry:shown', listener)
    },
    // Main → quick window: the outcome of a submit whose relay already timed
    // out. Delivery is now KNOWN — reconcile the unknown state instead of
    // leaving the user to resend a prompt that may already be delivered.
    onLateResult: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('filey:quick-entry:late-result', listener)

      return () => ipcRenderer.removeListener('filey:quick-entry:late-result', listener)
    }
  },
  getBootProgress: () => ipcRenderer.invoke('filey:boot-progress:get'),
  getConnectionConfig: profile => ipcRenderer.invoke('filey:connection-config:get', profile),
  saveConnectionConfig: payload => ipcRenderer.invoke('filey:connection-config:save', payload),
  applyConnectionConfig: payload => ipcRenderer.invoke('filey:connection-config:apply', payload),
  testConnectionConfig: payload => ipcRenderer.invoke('filey:connection-config:test', payload),
  // Opt-in OS-keychain encryption for stored gateway secrets (default off —
  // see secret-storage-policy.ts). get never touches the OS keychain.
  getSecretStorageEncryption: () => ipcRenderer.invoke('filey:secret-storage:get'),
  setSecretStorageEncryption: (on: boolean) => ipcRenderer.invoke('filey:secret-storage:set', on),
  // v2 multi-connection registry: named agent sources (local / remote / cloud / ssh).
  connections: {
    list: () => ipcRenderer.invoke('filey:connections:list'),
    save: payload => ipcRenderer.invoke('filey:connections:save', payload),
    remove: id => ipcRenderer.invoke('filey:connections:remove', id),
    setPrimary: id => ipcRenderer.invoke('filey:connections:set-primary', id),
    setLaunchMode: mode => ipcRenderer.invoke('filey:connections:set-launch-mode', mode),
    setLastUsed: id => ipcRenderer.invoke('filey:connections:set-last-used', id),
    test: id => ipcRenderer.invoke('filey:connections:test', id),
    updateManaged: id => ipcRenderer.invoke('filey:connections:update-managed', id),
    // Fan out `filey update` to every eligible registered connection.
    // Optional excludeIds skips rows the caller updates through another path.
    updateAll: options => ipcRenderer.invoke('filey:connections:update-all', options),
    // Registry lifecycle push (main → renderer): a connection was removed or
    // materially edited, so secondaries scoped to it must be disposed (and,
    // for edits, re-dialed at the new target).
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('filey:connections:changed', listener)

      return () => ipcRenderer.removeListener('filey:connections:changed', listener)
    }
  },
  sshConfigHosts: () => ipcRenderer.invoke('filey:ssh-config:hosts'),
  sshResolveHost: host => ipcRenderer.invoke('filey:ssh-config:resolve', host),
  probeConnectionConfig: remoteUrl => ipcRenderer.invoke('filey:connection-config:probe', remoteUrl),
  // `options` lets a registry-editor draft sign in BEFORE it is saved: the
  // main process settles the draft's connection id up front so the login
  // window writes into the per-connection cookie jar the saved entry will
  // read (not the legacy shared jar an unsaved URL would fall back to).
  oauthLoginConnectionConfig: (remoteUrl, options) =>
    ipcRenderer.invoke('filey:connection-config:oauth-login', remoteUrl, options),
  oauthLogoutConnectionConfig: remoteUrl => ipcRenderer.invoke('filey:connection-config:oauth-logout', remoteUrl),
  // Filey Cloud: one portal login powers discovery + silent per-agent sign-in
  // (cloud-auto-discovery Phase 3).
  cloud: {
    status: () => ipcRenderer.invoke('filey:cloud:status'),
    login: () => ipcRenderer.invoke('filey:cloud:login'),
    logout: () => ipcRenderer.invoke('filey:cloud:logout'),
    discover: org => ipcRenderer.invoke('filey:cloud:discover', org),
    agentSignIn: dashboardUrl => ipcRenderer.invoke('filey:cloud:agent-sign-in', dashboardUrl)
  },
  profile: {
    getDefault: () => ipcRenderer.invoke('filey:profile:default:get'),
    setDefault: (route: DesktopProfileRoute) => ipcRenderer.invoke('filey:profile:default:set', route),
    onDefaultChanged: (callback: (route: DesktopProfileRoute | null) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, route: DesktopProfileRoute | null) => callback(route)
      ipcRenderer.on('filey:profile:default:changed', listener)

      return () => ipcRenderer.removeListener('filey:profile:default:changed', listener)
    },
    get: () => ipcRenderer.invoke('filey:profile:get'),
    remember: name => ipcRenderer.invoke('filey:profile:remember', name),
    set: name => ipcRenderer.invoke('filey:profile:set', name)
  },
  // The handler resolves an expected 404 with a sentinel instead of rejecting
  // (Electron logs a stack for every rejected invoke). Turn it back into the
  // rejection the renderer expects — see electron/api-expected-404.ts.
  api: request => ipcRenderer.invoke('filey:api', request).then(unwrapExpectedNotFound),
  notify: payload => ipcRenderer.invoke('filey:notify', payload),
  claimStartupLatency: () => ipcRenderer.invoke('filey:startup-latency:claim'),
  requestMicrophoneAccess: () => ipcRenderer.invoke('filey:requestMicrophoneAccess'),
  readWindowBelow: () => ipcRenderer.invoke('filey:window:readBelow'),
  readFileDataUrl: filePath => ipcRenderer.invoke('filey:readFileDataUrl', filePath),
  readFileDataUrlForAttach: filePath => ipcRenderer.invoke('filey:readFileDataUrlForAttach', filePath),
  dataUrlReadMax: {
    get: () => ipcRenderer.invoke('filey:data-url-read-max:get'),
    set: maxMb => ipcRenderer.invoke('filey:data-url-read-max:set', maxMb)
  },
  readFileText: filePath => ipcRenderer.invoke('filey:readFileText', filePath),
  readPluginSource: (filePath: string) => ipcRenderer.invoke('filey:readPluginSource', filePath),
  selectPaths: options => ipcRenderer.invoke('filey:selectPaths', options),
  selectSavePath: options => ipcRenderer.invoke('filey:selectSavePath', options),
  writeClipboard: text => ipcRenderer.invoke('filey:writeClipboard', text),
  readClipboard: () => ipcRenderer.invoke('filey:readClipboard'),
  saveGatewayFile: payload => ipcRenderer.invoke('filey:saveGatewayFile', payload),
  saveImageFromUrl: url => ipcRenderer.invoke('filey:saveImageFromUrl', url),
  contextMenuEdit: command => ipcRenderer.invoke('filey:context-menu:edit', command),
  contextMenuCopyImage: () => ipcRenderer.invoke('filey:context-menu:copy-image'),
  contextMenuSpellcheck: action => ipcRenderer.invoke('filey:context-menu:spellcheck', action),
  contextMenuGuestAddWord: payload => ipcRenderer.invoke('filey:context-menu:guest-add-word', payload),
  onContextMenuSpellcheck: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('filey:context-menu-spellcheck', listener)

    return () => ipcRenderer.removeListener('filey:context-menu-spellcheck', listener)
  },
  saveImageBuffer: (data, ext, name) => ipcRenderer.invoke('filey:saveImageBuffer', { data, ext, name }),
  capturePreview: payload => ipcRenderer.invoke('filey:capturePreview', payload),
  savePastedText: text => ipcRenderer.invoke('filey:savePastedText', { text }),
  saveClipboardImage: () => ipcRenderer.invoke('filey:saveClipboardImage'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('filey:normalizePreviewTarget', target, baseDir),
  watchPreviewFile: url => ipcRenderer.invoke('filey:watchPreviewFile', url),
  watchDirectory: dir => ipcRenderer.invoke('filey:watchDirectory', dir),
  stopPreviewFileWatch: id => ipcRenderer.invoke('filey:stopPreviewFileWatch', id),
  setActiveWork: payload => ipcRenderer.send('filey:active-work', payload),
  setTitleBarTheme: payload => ipcRenderer.send('filey:titlebar-theme', payload),
  setNativeTheme: mode => ipcRenderer.send('filey:native-theme', mode),
  setTranslucency: payload => ipcRenderer.send('filey:translucency', payload),
  setKeepAwake: mode => ipcRenderer.send('filey:keep-awake', mode),
  minimizeToTray: {
    get: () => ipcRenderer.invoke('filey:minimize-to-tray:get'),
    set: on => ipcRenderer.invoke('filey:minimize-to-tray:set', on),
    onChanged: callback => {
      const listener = (_event, status) => callback(status)
      ipcRenderer.on('filey:minimize-to-tray:changed', listener)

      return () => ipcRenderer.removeListener('filey:minimize-to-tray:changed', listener)
    }
  },
  setDisableF12: blocked => ipcRenderer.send('filey:devtools:disable-f12', blocked),
  setF12ShortcutActive: active => ipcRenderer.send('filey:f12ShortcutActive', Boolean(active)),
  onF12Shortcut: callback => {
    const listener = (_event, input) => callback(input)
    ipcRenderer.on('filey:f12-shortcut', listener)

    return () => ipcRenderer.removeListener('filey:f12-shortcut', listener)
  },
  setPreviewShortcutActive: active => ipcRenderer.send('filey:previewShortcutActive', Boolean(active)),
  setPreviewGuestHidden: (webContentsId, hidden) =>
    ipcRenderer.send('filey:preview-guest-hidden', { webContentsId, hidden: Boolean(hidden) }),
  openExternal: url => ipcRenderer.invoke('filey:openExternal', url),
  freeTierChallenge: {
    // Load the account service's challenge page in a hidden window (revealed
    // only if the page asks for the human). Resolves with how it ended.
    run: request => ipcRenderer.invoke('filey:freeTierChallenge:run', request)
  },
  mcpOauth: {
    // One-shot loopback listener for MCP OAuth against remote backends: bind
    // on this machine, hand redirectUri to mcp.servers.oauth.start, then wait
    // for the provider redirect and relay code/state via oauth.callback.
    listen: () => ipcRenderer.invoke('filey:mcp-oauth:listen'),
    wait: (id, timeoutMs) => ipcRenderer.invoke('filey:mcp-oauth:wait', id, timeoutMs),
    cancel: id => ipcRenderer.invoke('filey:mcp-oauth:cancel', id)
  },
  openPreviewInBrowser: url => ipcRenderer.invoke('filey:openPreviewInBrowser', url),
  reachPreviewUrl: url => ipcRenderer.invoke('filey:preview:reach', url),
  setActiveConnectionRoute: route => ipcRenderer.send('filey:connection:active-route', route),
  fetchLinkTitle: url => ipcRenderer.invoke('filey:fetchLinkTitle', url),
  resolveFavicon: url => ipcRenderer.invoke('filey:resolveFavicon', url),
  sanitizeWorkspaceCwd: cwd => ipcRenderer.invoke('filey:workspace:sanitize', cwd),
  settings: {
    getDefaultProjectDir: () => ipcRenderer.invoke('filey:setting:defaultProjectDir:get'),
    setDefaultProjectDir: dir => ipcRenderer.invoke('filey:setting:defaultProjectDir:set', dir),
    pickDefaultProjectDir: () => ipcRenderer.invoke('filey:setting:defaultProjectDir:pick')
  },
  zoom: {
    // Current zoom of this window, as { level, percent }.
    get: () => ipcRenderer.invoke('filey:zoom:get'),
    // Synchronous zoom factor (1 = 100%). Coordinate math needs it in the
    // same tick as the event it converts, so no IPC round-trip here.
    factor: () => webFrame.getZoomFactor(),
    setPercent: percent => ipcRenderer.send('filey:zoom:set-percent', percent),
    // Fires on every zoom change, including the Ctrl/Cmd +/-/0 shortcuts,
    // so the settings UI can stay in sync with the keyboard.
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('filey:zoom:changed', listener)

      return () => ipcRenderer.removeListener('filey:zoom:changed', listener)
    }
  },
  revealLogs: () => ipcRenderer.invoke('filey:logs:reveal'),
  getRecentLogs: () => ipcRenderer.invoke('filey:logs:recent'),
  // Fire-and-forget: persists a renderer error-boundary catch (with component
  // stack) to desktop.log so crashes survive the window (#79428).
  reportRendererError: report => ipcRenderer.send('filey:logs:renderer-error', report),
  logLine: (line: string): void => ipcRenderer.send('filey:logs:renderer-line', line),
  readDir: dirPath => ipcRenderer.invoke('filey:fs:readDir', dirPath),
  gitRoot: startPath => ipcRenderer.invoke('filey:fs:gitRoot', startPath),
  revealPath: targetPath => ipcRenderer.invoke('filey:fs:reveal', targetPath),
  openDir: dirPath => ipcRenderer.invoke('filey:fs:openDir', dirPath),
  desktopPluginsRoot: () => ipcRenderer.invoke('filey:fs:desktopPluginsRoot'),
  reconcileDesktopPlugins: () => ipcRenderer.invoke('filey:fs:reconcileDesktopPlugins'),
  logsRoot: (profile?: string) => ipcRenderer.invoke('filey:fs:logsRoot', profile),
  renamePath: (targetPath, newName) => ipcRenderer.invoke('filey:fs:rename', targetPath, newName),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('filey:fs:writeText', filePath, content),
  trashPath: targetPath => ipcRenderer.invoke('filey:fs:trash', targetPath),
  git: {
    worktreeList: repoPath => ipcRenderer.invoke('filey:git:worktreeList', repoPath),
    worktreeAdd: (repoPath, options) => ipcRenderer.invoke('filey:git:worktreeAdd', repoPath, options),
    worktreeRemove: (repoPath, worktreePath, options) =>
      ipcRenderer.invoke('filey:git:worktreeRemove', repoPath, worktreePath, options),
    branchSwitch: (repoPath, branch) => ipcRenderer.invoke('filey:git:branchSwitch', repoPath, branch),
    branchList: repoPath => ipcRenderer.invoke('filey:git:branchList', repoPath),
    baseBranchList: repoPath => ipcRenderer.invoke('filey:git:baseBranchList', repoPath),
    repoStatus: repoPath => ipcRenderer.invoke('filey:git:repoStatus', repoPath),
    fileDiff: (repoPath, filePath) => ipcRenderer.invoke('filey:git:fileDiff', repoPath, filePath),
    scanRepos: (roots, options) => ipcRenderer.invoke('filey:git:scanRepos', roots, options),
    review: {
      list: (repoPath, scope, baseRef) => ipcRenderer.invoke('filey:git:review:list', repoPath, scope, baseRef),
      diff: (repoPath, filePath, scope, baseRef, staged) =>
        ipcRenderer.invoke('filey:git:review:diff', repoPath, filePath, scope, baseRef, staged),
      stage: (repoPath, filePath) => ipcRenderer.invoke('filey:git:review:stage', repoPath, filePath),
      unstage: (repoPath, filePath) => ipcRenderer.invoke('filey:git:review:unstage', repoPath, filePath),
      revert: (repoPath, filePath) => ipcRenderer.invoke('filey:git:review:revert', repoPath, filePath),
      revParse: (repoPath, ref) => ipcRenderer.invoke('filey:git:review:revParse', repoPath, ref),
      commit: (repoPath, message, push) => ipcRenderer.invoke('filey:git:review:commit', repoPath, message, push),
      commitContext: repoPath => ipcRenderer.invoke('filey:git:review:commitContext', repoPath),
      push: repoPath => ipcRenderer.invoke('filey:git:review:push', repoPath),
      shipInfo: repoPath => ipcRenderer.invoke('filey:git:review:shipInfo', repoPath),
      prList: (repoPath, branches, numbers) =>
        ipcRenderer.invoke('filey:git:review:prList', repoPath, branches, numbers),
      createPr: repoPath => ipcRenderer.invoke('filey:git:review:createPr', repoPath)
    }
  },
  terminal: {
    attach: id => ipcRenderer.invoke('filey:terminal:attach', id),
    cwd: id => ipcRenderer.invoke('filey:terminal:cwd', id),
    dispose: id => ipcRenderer.invoke('filey:terminal:dispose', id),
    resize: (id, size) => ipcRenderer.invoke('filey:terminal:resize', id, size),
    start: options => ipcRenderer.invoke('filey:terminal:start', options),
    write: (id, data) => ipcRenderer.invoke('filey:terminal:write', id, data),
    onData: (id, callback) => {
      const channel = `filey:terminal:${id}:data`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id, callback) => {
      const channel = `filey:terminal:${id}:exit`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  onClosePreviewRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('filey:close-preview-requested', listener)

    return () => ipcRenderer.removeListener('filey:close-preview-requested', listener)
  },
  onPreviewNav: callback => {
    const listener = (_event, command) => callback(command)
    ipcRenderer.on('filey:preview-nav', listener)

    return () => ipcRenderer.removeListener('filey:preview-nav', listener)
  },
  onOpenFolderRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('filey:open-folder-requested', listener)

    return () => ipcRenderer.removeListener('filey:open-folder-requested', listener)
  },
  onOpenUpdatesRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('filey:open-updates', listener)

    return () => ipcRenderer.removeListener('filey:open-updates', listener)
  },
  onDeepLink: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('filey:deep-link', listener)

    return () => ipcRenderer.removeListener('filey:deep-link', listener)
  },
  signalDeepLinkReady: () => ipcRenderer.invoke('filey:deep-link-ready'),
  probePluginRepo: payload => ipcRenderer.invoke('filey:plugin:probe', payload),
  installDesktopPlugin: payload => ipcRenderer.invoke('filey:plugin:installDesktop', payload),
  removeDesktopPlugin: payload => ipcRenderer.invoke('filey:plugin:removeDesktop', payload),
  onWindowStateChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('filey:window-state-changed', listener)

    return () => ipcRenderer.removeListener('filey:window-state-changed', listener)
  },
  onFocusSession: callback => {
    const listener = (_event, sessionId) => callback(sessionId)
    ipcRenderer.on('filey:focus-session', listener)

    return () => ipcRenderer.removeListener('filey:focus-session', listener)
  },
  onNotificationAction: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('filey:notification-action', listener)

    return () => ipcRenderer.removeListener('filey:notification-action', listener)
  },
  onNotificationActivate: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('filey:notification-activate', listener)

    return () => ipcRenderer.removeListener('filey:notification-activate', listener)
  },
  onExternalOpenFailed: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('filey:external-open-failed', listener)

    return () => ipcRenderer.removeListener('filey:external-open-failed', listener)
  },
  onPreviewFileChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('filey:preview-file-changed', listener)

    return () => ipcRenderer.removeListener('filey:preview-file-changed', listener)
  },
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('filey:backend-exit', listener)

    return () => ipcRenderer.removeListener('filey:backend-exit', listener)
  },
  // Cooperative pool retirement (main → renderer): the pooled backend under
  // `poolKey` is being stopped for a foreground open. Park that scope; do not
  // redial into the slot it vacated.
  onPoolBackendRetiring: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('filey:pool:retiring', listener)

    return () => ipcRenderer.removeListener('filey:pool:retiring', listener)
  },
  // Soft gateway-mode apply finished tearing down the primary backend. Renderer
  // should wipe session lists + re-dial without a window reload.
  onConnectionApplied: callback => {
    const listener = () => callback()
    ipcRenderer.on('filey:connection:applied', listener)

    return () => ipcRenderer.removeListener('filey:connection:applied', listener)
  },
  onPowerResume: callback => {
    const listener = () => callback()
    ipcRenderer.on('filey:power-resume', listener)

    return () => ipcRenderer.removeListener('filey:power-resume', listener)
  },
  // AC ↔ battery transitions; renderers slow their backstop polls on battery.
  getOnBattery: () => ipcRenderer.invoke('filey:power-battery:get'),
  onBatteryChanged: callback => {
    const listener = (_event, onBattery) => callback(Boolean(onBattery))
    ipcRenderer.on('filey:power-battery', listener)

    return () => ipcRenderer.removeListener('filey:power-battery', listener)
  },
  onBootProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('filey:boot-progress', listener)

    return () => ipcRenderer.removeListener('filey:boot-progress', listener)
  },
  // First-launch bootstrap progress -- emitted by the install.ps1 stage
  // runner in main.ts (apps/desktop/electron/bootstrap-runner.ts).
  // Renderer's install overlay subscribes to live events and queries the
  // current snapshot via getBootstrapState() to recover after a devtools
  // reload mid-bootstrap.
  getBootstrapState: () => ipcRenderer.invoke('filey:bootstrap:get'),
  probeLocalBackend: () => ipcRenderer.invoke('filey:local-backend:probe'),
  continueBootstrapLocal: () => ipcRenderer.invoke('filey:bootstrap:continue-local'),
  recycleBackend: profile => ipcRenderer.invoke('filey:backend:recycle', profile),
  resetBootstrap: () => ipcRenderer.invoke('filey:bootstrap:reset'),
  updateHold: {
    recheck: () => ipcRenderer.invoke('filey:update-hold:recheck'),
    quit: () => ipcRenderer.invoke('filey:update-hold:quit'),
    startAnyway: (request: { holdId: string; confirmed: true }) =>
      ipcRenderer.invoke('filey:update-hold:start-anyway', request)
  },
  repairBootstrap: () => ipcRenderer.invoke('filey:bootstrap:repair'),
  cancelBootstrap: () => ipcRenderer.invoke('filey:bootstrap:cancel'),
  onBootstrapEvent: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('filey:bootstrap:event', listener)

    return () => ipcRenderer.removeListener('filey:bootstrap:event', listener)
  },
  getVersion: () => ipcRenderer.invoke('filey:version'),
  relaunchApp: () => ipcRenderer.invoke('filey:app:relaunch'),
  getMachineProfile: () => ipcRenderer.invoke('filey:machine:profile'),
  getRemoteDisplayReason: () => ipcRenderer.invoke('filey:get-remote-display-reason'),
  uninstall: {
    summary: () => ipcRenderer.invoke('filey:uninstall:summary'),
    run: mode => ipcRenderer.invoke('filey:uninstall:run', { mode }),
    openAppsSettings: () => ipcRenderer.invoke('filey:uninstall:openAppsSettings')
  },
  updates: {
    check: opts => ipcRenderer.invoke('filey:updates:check', opts),
    apply: opts => ipcRenderer.invoke('filey:updates:apply', opts),
    setChannel: name => ipcRenderer.invoke('filey:updates:channel:set', name),
    onProgress: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('filey:updates:progress', listener)

      return () => ipcRenderer.removeListener('filey:updates:progress', listener)
    },
    takePendingRun: () => ipcRenderer.invoke('filey:updates:metric:take'),
    ackPendingRun: sent => ipcRenderer.invoke('filey:updates:metric:ack', sent),
    onPendingRun: callback => {
      const listener = () => callback()
      ipcRenderer.on('filey:updates:metric:pending', listener)

      return () => ipcRenderer.removeListener('filey:updates:metric:pending', listener)
    }
  },
  desktopMetrics: {
    setEnabled: (on, profile) => ipcRenderer.invoke('filey:desktop-metrics:set-enabled', on, profile),
    takeRendererCrashes: () => ipcRenderer.invoke('filey:desktop-metrics:crash:take'),
    ackRendererCrashes: sent => ipcRenderer.invoke('filey:desktop-metrics:crash:ack', sent)
  },
  themes: {
    fetchMarketplace: id => ipcRenderer.invoke('filey:vscode-theme:fetch', id),
    searchMarketplace: query => ipcRenderer.invoke('filey:vscode-theme:search', query)
  },
  // Find-in-page (Ctrl/Cmd+F): delegates to Electron's
  // webContents.findInPage on the IPC sender's window so a Cmd+F pressed
  // in a secondary session window searches THAT window, not the primary.
  // `onFoundInPage` returns the unsubscribe fn; the renderer wires it via
  // `initFindInPageListener` in store/find-in-page.ts and tears it down
  // when the FindBar unmounts.
  findInPage: (query, options) => ipcRenderer.invoke('filey:find-in-page', query, options),
  stopFindInPage: () => ipcRenderer.invoke('filey:stop-find-in-page'),
  onFoundInPage: callback => {
    const listener = (_event, result) => callback(result)
    ipcRenderer.on('filey:found-in-page', listener)

    return () => ipcRenderer.removeListener('filey:found-in-page', listener)
  },
  // Main-process `before-input-event` forwards Ctrl/Cmd+F here so renderer
  // can open the FindBar even when the GTK compositor has already grabbed
  // the chord at the windowing layer (#81727).
  onOpenFindBarRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('filey:open-find-bar', listener)

    return () => ipcRenderer.removeListener('filey:open-find-bar', listener)
  }
})
