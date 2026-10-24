export function isOnboardingEnabled(): boolean {
  return window.fileyDesktop?.guestOnboardingEnabled === true
}
