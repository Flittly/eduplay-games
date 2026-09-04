# 打包插件：manifest.json + dist/web -> dist/<gameCode>-<version>.zip
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root "manifest.json"
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

$webDir = Join-Path $root "dist\web"
if (-not (Test-Path -LiteralPath $webDir)) {
    throw "未找到构建产物 dist/web，请先运行 npm run build"
}

$stage = Join-Path $root "dist\package"
if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $stage "manifest.json")
Copy-Item -LiteralPath $webDir -Destination (Join-Path $stage "web") -Recurse

$zipName = "$($manifest.gameCode)-$($manifest.version).zip"
$zip = Join-Path $root "dist\$zipName"
if (Test-Path -LiteralPath $zip) {
    Remove-Item -LiteralPath $zip -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)

Remove-Item -LiteralPath $stage -Recurse -Force
Write-Output "打包完成：$zip"
