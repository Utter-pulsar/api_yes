import type { ApiYesApi } from '@shared/api/contract'

declare global {
  interface Window {
    api: ApiYesApi
    platform: string
  }
}

export {}
