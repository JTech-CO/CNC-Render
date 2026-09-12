param([Parameter(Mandatory=$true)][string]$ProcessIds)
$ErrorActionPreference = 'Stop'
if ($ProcessIds -notmatch '^\d+(,\d+)*$') { throw 'Invalid scoped process IDs' }
$m12Ids = @($ProcessIds.Split(',') | ForEach-Object { [int]$_ })
$m12Processes = @(Get-Process -Id $m12Ids -ErrorAction SilentlyContinue)
if ($m12Processes.Count -eq 0) { throw 'Test browser processes disappeared' }
$m12CpuBound = 0L
foreach ($m12Process in $m12Processes) {
  # Conservatively include private committed memory and resident shared mappings.
  $m12CpuBound += [Math]::Max($m12Process.PrivateMemorySize64, $m12Process.WorkingSet64)
}
$m12GpuRows = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory | Where-Object {
  $_.Name -match '^pid_(\d+)_' -and $m12Ids -contains [int]$Matches[1]
})
if ($m12GpuRows.Count -eq 0) { throw 'GPU process counters unavailable; total memory cannot be certified' }
$m12GpuBytes = 0L
foreach ($m12GpuRow in $m12GpuRows) { $m12GpuBytes += [long]$m12GpuRow.DedicatedUsage + [long]$m12GpuRow.SharedUsage }
@{ processCount=$m12Processes.Count; processMemoryBoundBytes=$m12CpuBound; gpuReportedBytes=$m12GpuBytes; conservativeObservedBytes=$m12CpuBound+$m12GpuBytes; processes=@($m12Processes | ForEach-Object { @{ id=$_.Id; privateBytes=$_.PrivateMemorySize64; workingSetBytes=$_.WorkingSet64 } }) } | ConvertTo-Json -Compress -Depth 4
