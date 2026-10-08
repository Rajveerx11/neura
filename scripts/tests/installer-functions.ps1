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
foreach ($name in @('Normalize-Text', 'Get-PackageIdentity', 'Test-PackageSpecEqual', 'Test-KeybindingEqual', 'Test-SameFile', 'Get-NeuraTerminalFragment', 'Invoke-NeuraVersionProbe', 'Get-NeuraVersionProblem', 'Get-NeuraPrerequisiteProblems')) {
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
if (-not (Test-KeybindingEqual @('enter', 'shift+enter') @('enter', 'shift+enter'))) { throw 'Equal new-line bindings differ' }
if (Test-KeybindingEqual @('enter', 'shift+enter') @('enter')) { throw 'Missing new-line binding accepted' }
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
[Console]::WriteLine('Installer functions: prerequisite version checks')
$contractPath = Join-Path ([IO.Path]::GetDirectoryName($Source)) 'agent/neura/runtime-contract.json'
$pin = ([IO.File]::ReadAllText($contractPath) | ConvertFrom-Json).piVersion
$minimum = '24.15.0'
foreach ($case in @(@('node', 'v24.19.0'), @('npm', '11.6.0'), @('pi', $pin), @('git', 'git version 2.50.1.windows.1'))) {
    $probe = [PSCustomObject]@{ Found = $true; ExitCode = 0; Output = $case[1] }
    if (Get-NeuraVersionProblem $case[0] $probe $pin $minimum) { throw "Valid $($case[0]) prerequisite rejected" }
    $probe.ExitCode = 37
    if ((Get-NeuraVersionProblem $case[0] $probe $pin $minimum) -notlike '*probe failed*') { throw 'Failed native exit accepted' }
    $probe.Found = $false
    if ((Get-NeuraVersionProblem $case[0] $probe $pin $minimum) -notlike '*is missing*') { throw 'Missing prerequisite accepted' }
    $probe.Found = $true; $probe.ExitCode = 0
    foreach ($bad in @('', 'garbage', "$pin`n$pin", '999999999999999999999.0.0', "$pin-beta.1")) {
        $probe.Output = $bad
        if ((Get-NeuraVersionProblem $case[0] $probe $pin $minimum) -notlike '*invalid version*') { throw 'Malformed prerequisite accepted' }
    }
}
$probe = [PSCustomObject]@{ Found = $true; ExitCode = 0; Output = 'v22.19.0' }
if ((Get-NeuraVersionProblem 'node' $probe $pin $minimum) -notlike '*24.15.0 or newer*') { throw 'Old Node accepted' }
$probe.Output = '1.1.1'
$newer = Get-NeuraVersionProblem 'pi' $probe $pin $minimum
if ($newer -notlike '*Update Neura; do not downgrade Pi.*' -or $newer -like '*npm install*') { throw 'Newer Pi was downgraded' }
foreach ($older in @('0.99.2', '1.0.4', '1.0.5')) {
    $probe.Output = $older
    if ((Get-NeuraVersionProblem 'pi' $probe $pin $minimum) -notlike "*upgrade to reviewed Pi $pin*") { throw 'Old Pi mismatch missed' }
}
if ([Environment]::OSVersion.Platform -eq 'Win32NT') {
    $native = Join-Path $Scratch 'version-probe.cmd'
    [IO.File]::WriteAllText($native, "@echo off`r`necho $pin`r`nexit /b 37`r`n")
    $global:LASTEXITCODE = 19
    $nativeProbe = Invoke-NeuraVersionProbe $native @('--version')
    if ($nativeProbe.ExitCode -ne 37 -or $nativeProbe.Output -ne $pin) { throw 'Native version probe swallowed its exit code or output' }
    if ($global:LASTEXITCODE -ne 19) { throw 'Version probe changed caller exit status' }
    [IO.File]::WriteAllText($native, "@echo off`r`necho $pin`r`nexit /b 0`r`n")
    if ((Invoke-NeuraVersionProbe $native @('--version')).ExitCode -ne 0) { throw 'Successful native version probe rejected' }
    $wrapper = Join-Path $Scratch 'version-probe.ps1'
    [IO.File]::WriteAllText($wrapper, "& '$native'`nexit `$LASTEXITCODE`n")
    if ((Invoke-NeuraVersionProbe $wrapper @('--version')).ExitCode -ne 0) { throw 'PowerShell CLI shim rejected' }
}
$script:probeCalls = @()
function Invoke-NeuraVersionProbe($Name, $Arguments) {
    $script:probeCalls += $Name
    [PSCustomObject]@{ Found = $true; ExitCode = 37; Output = 'v24.19.0' }
}
$problems = @(Get-NeuraPrerequisiteProblems $pin $minimum)
if ($problems.Count -ne 1 -or $script:probeCalls.Count -ne 1 -or $script:probeCalls[0] -ne 'node') { throw 'Pi/npm executed after failed Node prerequisite' }
[Console]::WriteLine('PASS installer functions')
