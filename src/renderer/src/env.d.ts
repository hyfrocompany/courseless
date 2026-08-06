/// <reference types="vite/client" />

import type { CourselessApi } from '../../shared/ipc'

declare global {
  interface Window {
    courseless: CourselessApi
  }
}

export {}
