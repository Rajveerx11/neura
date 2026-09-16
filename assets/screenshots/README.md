# README screenshots

These images are generated from synthetic fixtures by Neura's real offline
browser renderers. They contain no private workspace, account, credential, or
user data.

From PowerShell at the repository root:

```powershell
$planOutput = Join-Path $env:TEMP "neura-readme-plan"
$env:NEURA_A11Y_OUTPUT = $planOutput
node .\scripts\verify-plan-accessibility.mjs
Copy-Item "$planOutput\plan-1280x900.png" .\assets\screenshots\plan-review.png
Remove-Item Env:\NEURA_A11Y_OUTPUT

$learnOutput = Join-Path $env:TEMP "neura-readme-learn"
$env:NEURA_LEARN_BROWSER_OUTPUT = $learnOutput
node .\scripts\tests\learn-browser.mjs
Copy-Item "$learnOutput\learn-1280.png" .\assets\screenshots\learn-workshop.png
Remove-Item Env:\NEURA_LEARN_BROWSER_OUTPUT
```

Both runs use installed Microsoft Edge through Playwright, assert no unexpected
network activity, and fail on browser, layout, or accessibility errors. Refresh
the images only from a passing run and inspect them before committing.
