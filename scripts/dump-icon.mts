import { writeFileSync } from 'node:fs'
import { courselessIconPng } from '../src/main/util/icon'
const dir = process.argv[2]
writeFileSync(dir + '/tray-icon-16.png', courselessIconPng(16))
writeFileSync(dir + '/tray-icon-128.png', courselessIconPng(128))
console.log('wrote tray icons to ' + dir)
