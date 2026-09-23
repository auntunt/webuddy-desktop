import { translate } from '@/i18n/i18n'
import type { ConnectCurrentOrcaProfileResult } from '../../../../shared/orca-profiles'

/** Form-facing error for a sign-in result; null means the sign-in connected. */
export function orcaProfileSignInResultError(
  result: ConnectCurrentOrcaProfileResult
): string | null {
  if (result.status === 'connected') {
    return null
  }
  if (result.status === 'failed') {
    return result.error
  }
  return translate('webuddyAuth.signInIncomplete', '登录未完成，请重试。')
}

/** Form-facing error for a sign-in IPC call that threw. */
export function orcaProfileSignInThrownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
