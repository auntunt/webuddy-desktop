// Why: Webuddy is an internal fork of Orca; the upstream "star Orca on GitHub"
// prompt is meaningless to our users, so every surface stays closed. Only unit
// tests flip this to keep exercising the upstream flow behind the gate.
let starNagEnabled = false

export function isStarNagEnabled(): boolean {
  return starNagEnabled
}

export function setStarNagEnabledForTests(enabled: boolean): void {
  starNagEnabled = enabled
}
