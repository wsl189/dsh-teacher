$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$MetadataPath = Join-Path $RepositoryRoot 'third-party/windows-mcp/runtime.json'
$RequirementsPath = Join-Path $RepositoryRoot 'third-party/windows-mcp/requirements.lock'
$SmokePath = Join-Path $RepositoryRoot 'third-party/windows-mcp/smoke.py'
$RuntimeRoot = Join-Path $RepositoryRoot 'apps/desktop/runtime/windows-mcp'
$Metadata = Get-Content $MetadataPath -Raw | ConvertFrom-Json

$SetupPythonVersion = (& python -c 'import platform; print(platform.python_version())').Trim()
if ($LASTEXITCODE -ne 0 -or $SetupPythonVersion -ne $Metadata.python.version) {
  throw "Windows-MCP runtime build requires setup Python $($Metadata.python.version); received '$SetupPythonVersion'"
}

$TemporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "dsh-windows-mcp-$([guid]::NewGuid().ToString('N'))"
$ArchivePath = Join-Path $TemporaryRoot 'python-embed.zip'
New-Item -ItemType Directory -Path $TemporaryRoot | Out-Null
try {
  Invoke-WebRequest -Uri $Metadata.python.url -OutFile $ArchivePath
  $ArchiveHash = (Get-FileHash $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ArchiveHash -ne $Metadata.python.sha256) {
    throw "CPython embedded archive SHA256 mismatch: expected $($Metadata.python.sha256), received $ArchiveHash"
  }

  if (Test-Path $RuntimeRoot) {
    Remove-Item -LiteralPath $RuntimeRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $RuntimeRoot | Out-Null
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $RuntimeRoot

  $PathFiles = @(Get-ChildItem -LiteralPath $RuntimeRoot -File -Filter 'python*._pth')
  if ($PathFiles.Count -ne 1) {
    throw "Expected one embedded-Python ._pth file, found $($PathFiles.Count)"
  }
  $PathLines = @(
    Get-Content $PathFiles[0].FullName |
      Where-Object { $_ -ne 'Lib/site-packages' -and $_ -ne 'import site' }
  )
  $PathLines += 'Lib/site-packages'
  $PathLines += 'import site'
  Set-Content -LiteralPath $PathFiles[0].FullName -Value $PathLines -Encoding ascii

  $SitePackages = Join-Path $RuntimeRoot 'Lib/site-packages'
  New-Item -ItemType Directory -Path $SitePackages | Out-Null
  & python -m pip install `
    --disable-pip-version-check `
    --no-compile `
    --no-deps `
    --require-hashes `
    --only-binary=:all: `
    --target $SitePackages `
    --requirement $RequirementsPath
  if ($LASTEXITCODE -ne 0) {
    throw "pip failed to assemble the Windows-MCP runtime (exit $LASTEXITCODE)"
  }

  foreach ($Patch in $Metadata.patches) {
    $PatchPath = Join-Path $RepositoryRoot $Patch.path
    $PatchHash = (Get-FileHash $PatchPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($PatchHash -ne $Patch.sha256) {
      throw "Windows-MCP patch SHA256 mismatch for '$($Patch.path)': expected $($Patch.sha256), received $PatchHash"
    }

    $PatchTargetPath = Join-Path $SitePackages $Patch.target
    $Source = [IO.File]::ReadAllText($PatchTargetPath)
    $Matches = ([regex]::Matches($Source, [regex]::Escape($Patch.before))).Count
    if ($Matches -ne 1) {
      throw "Windows-MCP patch target '$($Patch.target)' contains $Matches copies of the expected source text"
    }
    $PatchedSource = $Source.Replace($Patch.before, $Patch.after)
    [IO.File]::WriteAllText(
      $PatchTargetPath,
      $PatchedSource,
      [Text.UTF8Encoding]::new($false)
    )
  }

  $EmbeddedPython = Join-Path $RuntimeRoot 'python.exe'
  & $EmbeddedPython $SmokePath
  if ($LASTEXITCODE -ne 0) {
    throw "Bundled Windows-MCP stdio smoke failed (exit $LASTEXITCODE)"
  }
} finally {
  if (Test-Path $TemporaryRoot) {
    Remove-Item -LiteralPath $TemporaryRoot -Recurse -Force
  }
}
