// settings.json in userData. Atomic writes, defaults merged on read.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types'
import { log } from '../util/log'

export class SettingsStore {
  private cache: Settings | null = null

  constructor(private file: string) {}

  get(): Settings {
    if (this.cache) return this.cache
    let loaded: Partial<Settings> = {}
    try {
      if (existsSync(this.file)) loaded = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (e) {
      log('settings', 'unreadable, using defaults', String(e).slice(0, 160))
    }
    this.cache = { ...DEFAULT_SETTINGS, ...loaded }
    return this.cache
  }

  set(patch: Partial<Settings>): Settings {
    const next: Settings = { ...this.get(), ...patch }
    this.cache = next
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch (e) {
      log('settings', 'write failed', String(e).slice(0, 160))
    }
    return next
  }
}
