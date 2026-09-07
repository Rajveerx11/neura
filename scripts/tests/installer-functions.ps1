param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$tree = [System.Management.Automation.Language.Parser]::ParseFile($Source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Installer parsing failed' }
# Evaluate only comparison functions, never installation.
foreach ($name in @('Normalize-Text', 'Get-PackageIdentity', 'Test-SameFile')) {
    $definition = $tree.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "Missing installer function $name" }
    . ([scriptblock]::Create($definition.Extent.Text))
}
if ((Get-PackageIdentity 'npm:@scope/pkg@1.2.3') -ne 'npm:@scope/pkg') { throw 'Scoped package identity failed' }
if ((Get-PackageIdentity 'npm:pkg@1.2.3') -ne 'npm:pkg') { throw 'Package identity failed' }
if ((Get-PackageIdentity 'local-package') -ne 'local-package') { throw 'Local identity changed' }
$left = Join-Path $Scratch 'left.ts'
$right = Join-Path $Scratch 'right.ts'
[IO.File]::WriteAllText($left, "source`r`n")
[IO.File]::WriteAllText($right, "source`n")
if (-not (Test-SameFile $left $right)) { throw 'Line-ending normalization failed' }
[IO.File]::WriteAllText($right, "different`n")
if (Test-SameFile $left $right) { throw 'Content drift missed' }
if (Test-SameFile $left (Join-Path $Scratch 'missing.ts')) { throw 'Missing file accepted' }
$binaryLeft = Join-Path $Scratch 'left.bin'
$binaryRight = Join-Path $Scratch 'right.bin'
[IO.File]::WriteAllBytes($binaryLeft, [byte[]]@(0,1,2))
[IO.File]::WriteAllBytes($binaryRight, [byte[]]@(0,1,2))
if (-not (Test-SameFile $binaryLeft $binaryRight)) { throw 'Equal binary rejected' }
[IO.File]::WriteAllBytes($binaryRight, [byte[]]@(0,1,3))
if (Test-SameFile $binaryLeft $binaryRight) { throw 'Binary drift missed' }
Write-Output 'PASS installer functions'
