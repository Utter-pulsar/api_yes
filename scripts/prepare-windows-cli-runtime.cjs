#!/usr/bin/env node
const { copyFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function prepareWindowsCliRuntime(context) {
  if (context.electronPlatformName !== 'win32') return

  const resourcesDir = join(context.appOutDir, 'resources')
  mkdirSync(resourcesDir, { recursive: true })
  copyFileSync(process.execPath, join(resourcesDir, 'node.exe'))

  console.log('Copied node.exe for the Windows API-YES CLI runtime')
}
