#!/usr/bin/env bash
set -euo pipefail

npm run build

node --input-type=module <<'JS'
import { packager } from '@electron/packager'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { artifactDir } from 'transcribe-cpp'

const nativeDirectory = artifactDir()
const nativeLibrary = process.platform === 'darwin' ? 'libtranscribe.dylib'
  : process.platform === 'win32' ? 'transcribe.dll' : 'libtranscribe.so'
if (!existsSync(join(nativeDirectory, nativeLibrary))
  || !existsSync(join(nativeDirectory, 'contract.json'))) {
  throw new Error('Native dictation artifacts are missing')
}

await packager({
  dir: '.',
  name: 'Leyline',
  out: 'release',
  overwrite: true,
  prune: true,
  icon: 'assets/icon',
  asar: { unpack: '**/{*.node,spawn-helper,@elune/embedded/**,@transcribe-cpp/**,koffi/**}' },
  extendInfo: {
    NSMicrophoneUsageDescription: 'Leyline uses the microphone for local dictation when you start recording.',
  },
  ignore: ['^/(screenshots|src|scripts)(/|$)', '^/vite.config.js$'],
  osxSign: process.platform === 'darwin' ? {
    identity: '-',
    identityValidation: false,
    continueOnError: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    strictVerify: true,
    optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' }),
  } : undefined,
})
JS
