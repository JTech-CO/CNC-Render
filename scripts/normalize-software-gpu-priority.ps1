param(
  [Parameter(Mandatory = $true)][int]$GpuProcessId,
  [Parameter(Mandatory = $true)][int]$BrowserProcessId
)
$ErrorActionPreference = 'Stop'
if ($GpuProcessId -le 0 -or $BrowserProcessId -le 0) { throw 'Invalid task browser process ids' }
$taskBrowser = Get-Process -Id $BrowserProcessId
$expectedPath = $taskBrowser.Path
$taskProcess = Get-Process -Id $GpuProcessId
$taskInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $GpuProcessId"
if (-not $taskInfo -or
    $taskBrowser.ProcessName -notmatch '^chrome(?:-headless-shell)?$' -or
    $taskInfo.ParentProcessId -ne $BrowserProcessId -or
    -not [string]::Equals($taskProcess.Path, $expectedPath, [StringComparison]::OrdinalIgnoreCase) -or
    $taskInfo.CommandLine -notmatch '(?:^|\s)--type=gpu-process(?:\s|$)') {
  throw 'Process is not the CDP-owned browser GPU executable'
}
$before = $taskProcess.PriorityClass.ToString()
if ($before -notin @('Normal', 'AboveNormal')) { throw 'Unexpected GPU process priority' }
# SwiftShader runs the GPU workload on CPUs. Chromium's Windows GPU priority
# boost can starve Normal renderer/Worker threads; never boost those threads.
# This task-owned process exits with the test browser. Hardware runs are untouched.
$taskProcess.PriorityClass = 'Normal'
$taskProcess.Refresh()
$after = $taskProcess.PriorityClass.ToString()
if ($after -ne 'Normal') { throw 'GPU process priority normalization failed' }
[pscustomobject]@{ policy = 'windows-software-gpu-normal'; before = $before; after = $after } | ConvertTo-Json -Compress
