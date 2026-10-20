#!/usr/bin/env bash
set -euo pipefail

npm run build

node --input-type=module <<'JS'
import { packager } from '@electron/packager'

await packager({
  dir: '.',
  name: 'Leyline',
  out: 'release',
  overwrite: true,
  prune: true,
  icon: 'assets/icon',
  asar: { unpack: '**/{*.node,spawn-helper,@elune/embedded/**}' },
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
