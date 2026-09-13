param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference = 'Stop'
[Console]::WriteLine('Installer functions: shell started')
$PSModuleAutoLoadingPreference = 'None'
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
foreach ($module in @('Microsoft.PowerShell.Management', 'Microsoft.PowerShell.Utility')) {
    [Console]::WriteLine("Installer functions: importing builtin $module")
    Import-Module -Name ([IO.Path]::Combine($PSHOME, 'Modules', $module, "$module.psd1")) -ErrorAction Stop
}
[Console]::WriteLine('Installer functions: parsing source')
$tokens = $null
$errors = $null
$tree = [System.Management.Automation.Language.Parser]::ParseFile($Source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Installer parsing failed' }
# Evaluate only comparison functions, never installation.
foreach ($name in @('Normalize-Text', 'Get-PackageIdentity', 'Test-PackageSpecEqual', 'Test-SameFile', 'Get-NeuraTerminalFragment')) {
    $definition = $tree.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "Missing installer function $name" }
    . ([scriptblock]::Create($definition.Extent.Text))
}
if ((Get-PackageIdentity 'npm:@scope/pkg@1.2.3') -ne 'npm:@scope/pkg') { throw 'Scoped package identity failed' }
if ((Get-PackageIdentity 'npm:pkg@1.2.3') -ne 'npm:pkg') { throw 'Package identity failed' }
if ((Get-PackageIdentity 'local-package') -ne 'local-package') { throw 'Local identity changed' }
$filtered = [PSCustomObject]@{ source = 'npm:@scope/pkg@1.2.3'; extensions = @() }
if ((Get-PackageIdentity $filtered) -ne 'npm:@scope/pkg') { throw 'Filtered package identity failed' }
if (-not (Test-PackageSpecEqual $filtered ([PSCustomObject]@{ source = 'npm:@scope/pkg@1.2.3'; extensions = @() }))) { throw 'Equal package filters differ' }
if (Test-PackageSpecEqual $filtered ([PSCustomObject]@{ source = 'npm:@scope/pkg@1.2.3' })) { throw 'Missing package filter accepted' }
[Console]::WriteLine('Installer functions: text comparisons')
$left = Join-Path $Scratch 'left.ts'
$right = Join-Path $Scratch 'right.ts'
[IO.File]::WriteAllText($left, "source`r`n")
[IO.File]::WriteAllText($right, "source`n")
if (-not (Test-SameFile $left $right)) { throw 'Line-ending normalization failed' }
[IO.File]::WriteAllText($right, "different`n")
if (Test-SameFile $left $right) { throw 'Content drift missed' }
if (Test-SameFile $left (Join-Path $Scratch 'missing.ts')) { throw 'Missing file accepted' }
[Console]::WriteLine('Installer functions: binary comparisons')
$binaryLeft = Join-Path $Scratch 'left.bin'
$binaryRight = Join-Path $Scratch 'right.bin'
[IO.File]::WriteAllBytes($binaryLeft, [byte[]]@(0,1,2))
[IO.File]::WriteAllBytes($binaryRight, [byte[]]@(0,1,2))
if (-not (Test-SameFile $binaryLeft $binaryRight)) { throw 'Equal binary rejected' }
[IO.File]::WriteAllBytes($binaryRight, [byte[]]@(0,1,3))
if (Test-SameFile $binaryLeft $binaryRight) { throw 'Binary drift missed' }
[Console]::WriteLine('Installer functions: Windows Terminal fragment')
$fragment = Get-NeuraTerminalFragment '{7e8b22c4-2cd7-5f7c-b5a8-a461f718bdaf}' 'C:\Users\Test\.local\bin\neura.cmd' 'C:\Users\Test\.pi\agent\neura\launch-artwork.png' | ConvertFrom-Json
$profile = $fragment.profiles[0]
if ($profile.name -ne 'Neura') { throw 'Terminal profile name changed' }
if ($profile.guid -ne '{7e8b22c4-2cd7-5f7c-b5a8-a461f718bdaf}') { throw 'Terminal profile identity changed' }
if ($profile.commandline -notlike '*neura.cmd*') { throw 'Terminal profile launcher missing' }
if ($profile.backgroundImage -ne 'C:\Users\Test\.pi\agent\neura\launch-artwork.png') { throw 'Terminal profile artwork missing' }
if ($profile.backgroundImageAlignment -ne 'center' -or $profile.backgroundImageStretchMode -ne 'uniform') { throw 'Terminal artwork geometry changed' }
if ($profile.backgroundImageOpacity -ne 0.42) { throw 'Terminal artwork opacity changed' }
if ($profile.environment.PI_SKIP_VERSION_CHECK -ne '1') { throw 'Terminal startup update notice is not suppressed' }
[Console]::WriteLine('PASS installer functions')
