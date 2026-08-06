#!/usr/bin/env node
const { existsSync, mkdirSync, writeFileSync, chmodSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const bin = join(root, '.apiyes-dev-bin')
const cli = join(root, 'out', 'main', 'cli.js')
mkdirSync(bin, { recursive: true })

writeFileSync(
  join(bin, 'apiyesdev.cmd'),
  `@echo off\r\nset "APIYES_ENV=dev"\r\nnode "%~dp0..\\out\\main\\cli.js" %*\r\n`,
  'utf8'
)

writeFileSync(
  join(bin, 'apiyesdev.ps1'),
  `$env:APIYES_ENV = "dev"\nnode "$PSScriptRoot/../out/main/cli.js" @args\n`,
  'utf8'
)

writeFileSync(
  join(bin, 'apiyesdev'),
  `#!/usr/bin/env sh\nAPIYES_ENV=dev exec node "$(dirname "$0")/../out/main/cli.js" "$@"\n`,
  'utf8'
)
chmodSync(join(bin, 'apiyesdev'), 0o755)

writeFileSync(
  join(bin, 'activate.cmd'),
  `@echo off\r\nset "APIYES_ENV=dev"\r\nset "PATH=%~dp0;%PATH%"\r\necho API-YES dev CLI enabled for this cmd session. Run: apiyesdev\r\n`,
  'utf8'
)

writeFileSync(
  join(bin, 'activate.ps1'),
  `$bin = Split-Path -Parent $MyInvocation.MyCommand.Path\n$env:APIYES_ENV = "dev"\n$sep = [IO.Path]::PathSeparator\nif (($env:Path -split [Regex]::Escape($sep)) -notcontains $bin) { $env:Path = "$bin$sep$env:Path" }\nWrite-Host "API-YES dev CLI enabled for this PowerShell session. Run: apiyesdev"\n`,
  'utf8'
)

writeFileSync(
  join(bin, 'activate.sh'),
  [
    '#!/usr/bin/env sh',
    'if [ -n "${BASH_SOURCE:-}" ]; then',
    '  APIYES_ACTIVATE="$BASH_SOURCE"',
    'elif [ -n "${ZSH_VERSION:-}" ]; then',
    '  APIYES_ACTIVATE="${(%):-%x}"',
    'else',
    '  APIYES_ACTIVATE="$0"',
    'fi',
    'case "$APIYES_ACTIVATE" in',
    '  */*) APIYES_BIN_DIR="$(CDPATH= cd -- "$(dirname -- "$APIYES_ACTIVATE")" && pwd)" ;;',
    '  *) APIYES_BIN_DIR="$(pwd)" ;;',
    'esac',
    'export APIYES_ENV=dev',
    'case ":$PATH:" in',
    '  *":$APIYES_BIN_DIR:"*) ;;',
    '  *) export PATH="$APIYES_BIN_DIR:$PATH" ;;',
    'esac',
    'unset APIYES_ACTIVATE APIYES_BIN_DIR',
    'echo "API-YES dev CLI enabled for this shell session. Run: apiyesdev"'
  ].join('\n') + '\n',
  'utf8'
)
chmodSync(join(bin, 'activate.sh'), 0o755)

console.log('API-YES dev CLI shims created in .apiyes-dev-bin')
if (!existsSync(cli)) console.log('Note: out/main/cli.js does not exist yet. Run npm run build before apiyesdev.')
console.log('\nActivate in the current terminal session:')
console.log('  PowerShell: . .\\.apiyes-dev-bin\\activate.ps1')
console.log('  cmd.exe:    .\\.apiyes-dev-bin\\activate.cmd')
console.log('  bash/zsh:   . ./.apiyes-dev-bin/activate.sh')
console.log('\nThen run: apiyesdev')
