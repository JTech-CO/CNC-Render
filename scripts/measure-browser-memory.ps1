param([Parameter(Mandatory=$true)][string]$ProcessIds)
$ErrorActionPreference = 'Stop'
if ($ProcessIds -notmatch '^\d+(,\d+)*$') { throw 'Invalid scoped process IDs' }
$m12Ids = @($ProcessIds.Split(',') | ForEach-Object { [int]$_ })
$m12Processes = @(Get-Process -Id $m12Ids -ErrorAction SilentlyContinue)
if ($m12Processes.Count -ne $m12Ids.Count) { throw 'Test browser process set changed during sampling; restart the measurement' }
$m12ProcessSamples = @($m12Processes | ForEach-Object {
  # Snapshot once before the slower WDDM query: Process properties can become
  # unavailable if a short-lived renderer exits while GPU counters are read.
  if ($_.HasExited) { throw 'Test browser process set changed during sampling; restart the measurement' }
  $_.Refresh()
  $m12Private = $_.PrivateMemorySize64
  $m12WorkingSet = $_.WorkingSet64
  if ($_.HasExited) { throw 'Test browser process set changed during sampling; restart the measurement' }
  if ($null -eq $m12Private -or $null -eq $m12WorkingSet -or $m12Private -lt 0 -or $m12WorkingSet -lt 0) {
    throw 'Browser process memory unavailable; restart the measurement'
  }
  @{ id=$_.Id; privateBytes=$m12Private; workingSetBytes=$m12WorkingSet }
})
$m12CpuBound = 0L
foreach ($m12Process in $m12ProcessSamples) {
  # Conservatively include private committed memory and resident shared mappings.
  $m12CpuBound += [Math]::Max($m12Process.privateBytes, $m12Process.workingSetBytes)
}
$m12GpuRows = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory | Where-Object {
  $_.Name -match '^pid_(\d+)_' -and $m12Ids -contains [int]$Matches[1]
})
if ($m12GpuRows.Count -eq 0) { throw 'GPU process counters unavailable; total memory cannot be certified' }
$m12GpuBytes = 0L
foreach ($m12GpuRow in $m12GpuRows) { $m12GpuBytes += [long]$m12GpuRow.DedicatedUsage + [long]$m12GpuRow.SharedUsage }
@{ processCount=$m12ProcessSamples.Count; processMemoryBoundBytes=$m12CpuBound; gpuReportedBytes=$m12GpuBytes; conservativeObservedBytes=$m12CpuBound+$m12GpuBytes; processes=$m12ProcessSamples } | ConvertTo-Json -Compress -Depth 4
