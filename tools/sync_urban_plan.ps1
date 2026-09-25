[CmdletBinding()]
param(
  [ValidateSet("Setup", "Update", "Status")]
  [string]$Action = "Update",
  [string]$RepoPath = "C:\AI_BOT_SEO\korean_urban_plan_mcp"
)
$ErrorActionPreference = "Stop"
$ExpectedRemote = "https://github.com/yunsy84/test_file.git"
$TargetBranch = "urban-plan-source-evidence"

function Resolve-GitExe {
  if ($env:GIT_EXE -and (Test-Path $env:GIT_EXE)) { return (Resolve-Path $env:GIT_EXE).Path }

  $desktop = Join-Path $env:LOCALAPPDATA "GitHubDesktop"
  if (Test-Path $desktop) {
    $found = Get-ChildItem -Path $desktop -Filter git.exe -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "\\resources\\app\\git\\cmd\\git\.exe$" } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($found) { return $found.FullName }
  }

  $cmd = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $paths = @("C:\Program Files\Git\cmd\git.exe", "C:\Program Files\Git\bin\git.exe")
  foreach ($path in $paths) {
    if (Test-Path $path) { return (Resolve-Path $path).Path }
  }

  throw "git.exe를 찾지 못했습니다. GIT_EXE 환경변수로 실제 git.exe 경로를 지정할 수 있습니다."
}

function Invoke-GitText {
  param([Parameter(Mandatory)][string[]]$GitArguments)
  $output = & $script:GitExe @("--no-pager") @GitArguments 2>&1
  $code = $LASTEXITCODE
  $text = ($output | ForEach-Object { "$_" }) -join "`n"
  if ($code -ne 0) {
    throw ("Git 명령 실패 (exit $code): git " + ($GitArguments -join " ") + "`n" + $text.Trim())
  }
  return $text.Trim()
}

function Invoke-Git {
  param([Parameter(Mandatory)][string[]]$GitArguments)
  & $script:GitExe @("--no-pager") @GitArguments
  if ($LASTEXITCODE -ne 0) {
    throw ("Git 명령 실패 (exit $LASTEXITCODE): git " + ($GitArguments -join " "))
  }
}

if (-not (Test-Path $RepoPath)) { throw "프로젝트 폴더가 없습니다: $RepoPath" }
if (-not (Test-Path (Join-Path $RepoPath ".git"))) { throw "Git 저장소가 아닙니다: $RepoPath" }
$script:GitExe = Resolve-GitExe
$env:GIT_PAGER = "cat"
$env:GIT_CONFIG_NOSYSTEM = $env:GIT_CONFIG_NOSYSTEM

$root = Invoke-GitText @("-C", $RepoPath, "rev-parse", "--show-toplevel")
if ([IO.Path]::GetFullPath($root).TrimEnd("\") -ne [IO.Path]::GetFullPath($RepoPath).TrimEnd("\")) {
  throw "지정 폴더가 Git repository root가 아닙니다.`nroot: $root`nrepo: $RepoPath"
}
$remote = Invoke-GitText @("-C", $RepoPath, "remote", "get-url", "origin")
if ($remote -ne $ExpectedRemote) {
  throw ("origin URL이 예상값과 다릅니다.`nexpected: $ExpectedRemote`nactual:   $remote")
}
$currentBranch = Invoke-GitText @("-C", $RepoPath, "branch", "--show-current")
$statusText = Invoke-GitText @("-C", $RepoPath, "status", "--porcelain=v1", "--untracked-files=all")
$dirty = @($statusText -split "`n" | Where-Object { $_ -and $_.Trim() })

Write-Host "Repository : $RepoPath"
Write-Host "Git        : $script:GitExe"
Write-Host "Origin     : $remote"
Write-Host "Branch     : $currentBranch"
Write-Host "Dirty      : $($dirty.Count -gt 0)"

if ($Action -eq "Status") {
  $head = Invoke-GitText @("-C", $RepoPath, "rev-parse", "HEAD")
  $remoteRefExists = $true
  try { $remoteHead = Invoke-GitText @("-C", $RepoPath, "rev-parse", "origin/$TargetBranch") }
  catch { $remoteRefExists = $false; $remoteHead = "" }
  Write-Host "Local HEAD : $head"
  if ($remoteRefExists) { Write-Host "Remote HEAD: $remoteHead" }
  if ($dirty.Count -gt 0) { Write-Host "`n[변경 파일]"; $dirty | ForEach-Object { Write-Host $_ } }
  exit 0
}

if ($dirty.Count -gt 0) {
  Write-Host "로컬 변경사항이 있어 안전을 위해 중단했습니다."
  $dirty | ForEach-Object { Write-Host $_ }
  throw "변경사항을 보존한 채 작업 트리를 먼저 정리한 후 다시 실행하십시오."
}

Invoke-Git @("-C", $RepoPath, "fetch", "origin", $TargetBranch)

if ($Action -eq "Setup") {
  if ($currentBranch -eq $TargetBranch) {
    Write-Host "이미 대상 브랜치입니다."
  } else {
    $exists = Invoke-GitText @("-C", $RepoPath, "branch", "--list", $TargetBranch)
    if ($exists) {
      Invoke-Git @("-C", $RepoPath, "switch", $TargetBranch)
    } else {
      Invoke-Git @("-C", $RepoPath, "switch", "--track", "-c", $TargetBranch, "origin/$TargetBranch")
    }
  }
}

$currentBranch = Invoke-GitText @("-C", $RepoPath, "branch", "--show-current")
if ($currentBranch -ne $TargetBranch) {
  throw ("현재 브랜치는 " + $currentBranch + "입니다. Setup으로 먼저 연결하십시오.")
}

Invoke-Git @("-C", $RepoPath, "pull", "--ff-only", "origin", $TargetBranch)
$head = Invoke-GitText @("-C", $RepoPath, "rev-parse", "HEAD")
$remoteHead = Invoke-GitText @("-C", $RepoPath, "rev-parse", "origin/$TargetBranch")
Write-Host "Local HEAD : $head"
Write-Host "Remote HEAD: $remoteHead"
Write-Host "동기화 완료"
