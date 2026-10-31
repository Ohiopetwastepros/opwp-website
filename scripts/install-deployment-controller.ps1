$ErrorActionPreference = 'Stop'
$deploymentRoot = if ($PSScriptRoot) { (Resolve-Path (Join-Path $PSScriptRoot '..')).Path } else { (Get-Location).Path }
$deploymentNode = (Get-Command node.exe).Source
$deploymentScript = Join-Path $deploymentRoot 'scripts\deployment-controller.mjs'
$deploymentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
# EncodedCommand transports a fixed script with literal, escaped paths; no execution-policy override.
$deploymentCommand = "& '$($deploymentNode.Replace("'", "''"))' '$($deploymentScript.Replace("'", "''"))'"
$deploymentEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($deploymentCommand))
$deploymentAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand $deploymentEncoded" -WorkingDirectory $deploymentRoot
$deploymentPrincipal = New-ScheduledTaskPrincipal -UserId $deploymentUser -LogonType Interactive -RunLevel Limited
$deploymentSettings = New-ScheduledTaskSettingsSet -MultipleInstances Queue -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'OPWP Deployment Recovery' -Action $deploymentAction -Principal $deploymentPrincipal -Settings $deploymentSettings -Description 'Runs only after a recorded OPWP deployment failure; retries bounded failures and verifies production.' -Force | Out-Null
$deploymentTask = Get-ScheduledTask -TaskName 'OPWP Deployment Recovery'
$deploymentTask | Select-Object TaskName, State, @{ Name = 'TriggerCount'; Expression = { @($_.Triggers | Where-Object { $_ }).Count } }
