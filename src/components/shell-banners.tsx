import { MissingRateBanner } from '@/features/rates/components/missing-rate-banner'
import { BackupReminderBanner } from './backup-reminder-banner'

export function ShellBanners() {
  return (
    <>
      <MissingRateBanner />
      <BackupReminderBanner />
    </>
  )
}
