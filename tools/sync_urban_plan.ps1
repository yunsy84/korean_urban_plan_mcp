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
  $cmd = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $paths = @("C:\Program Files\Git\cmd\git.exe", "C:\Program Files\Git\bin\git.exe")
  $desktop = Join-Path $env:LOCALAPPDATA "GitHubDesktop"
  if (Test-Path $desktop) {
    $found = Get-ChildItem -Path $desktop -Filter git.exe -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "\\resources\\app\\git\\" } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($found) { $paths += $found.FullName }
  }
  foreach ($path in $paths) { if ($path -and (Test-Path $path)) { return (Resolve-Path $path).Path } }
  throw "git.exe를 찾지 못했습니다. GIT_EXE 환경변수로 실제 git.exe 경로를 지정할 수 있습니다."
}

function GitOut([string[]]$Args) {
  $out = & $script:GitExe @Args 2>&1
  if ($LASTEXITCODE -ne 0) { throw ("git 실패: " + ($Args -join " ")) }
  return ($out -join "`n").Trim()
}

function GitRun([string[]]$Args) {
  & $script:GitExe @Args
  if ($LASTEXITCODE -ne 0) { throw ("git 실패: " + ($Args -join " ")) }
}

if (-not (Test-Path $RepoPath)) { throw "프로젝트 폴더가 없습니다: $RepoPath" }
if (-not (Test-Path (Join-Path $RepoPath ".git"))) { throw "Git 저장소가 아닙니다: $RepoPath" }
$script:GitExe = Resolve-GitExe
$root = GitOut @("-C", $RepoPath, "rev-parse", "--show-toplevel")
if ([IO.Path]::GetFullPath($root).TrimEnd("\") -ne [IO.Path]::GetFullPath($RepoPath).TrimEnd("\")) { throw "지정 폴더가 Git repository root가 아닙니다." }
$remote = GitOut @("-C", $RepoPath, "remote", "get-url", "origin")
if ($remote -ne $ExpectedRemote) { throw ("origin URL이 예상값과 다릅니다. expected=" + $ExpectedRemote + " actual=" + $remote) }
$currentBranch = GitOut @("-C", $RepoPath, "branch", "--show-current")
$status = & $script:GitExe -C $RepoPath status --porcelain=v1 --untracked-files=all 2>&1
if ($LASTEXITCODE -ne 0) { throw "working tree 상태 확인 실패" }
$dirty = @($status | Where-Object { $_ -and $_.Trim() })
Write-Host "Repository : $RepoPath"
Write-Host "Git        : $script:GitExe"
Write-Host "Origin     : $remote"
Write-Host "Branch     : $currentBranch"
Write-Host "Dirty      : $($dirty.Count -gt 0)"

if ($Action -eq "Status") {
  Write-Host ("Local HEAD : " + (GitOut @("-C", $RepoPath, "rev-parse", "HEAD")))
  if ($dirty.Count -gt 0) { $dirty | ForEach-Object { Write-Host $_ } }
  exit 0
}

if ($dirty.Count -gt 0) {
  Write-Host "로컬 변경사항이 있어 안전을 위해 중단합니다."
  $dirty | ForEach-Object { Write-Host $_ }
  throw "변경사항을 보존한 채 작업 트리를 먼저 정리한 후 다시 실행하십시오."
}

GitRun @("-C", $RepoPath, "fetch", "origin", $TargetBranch)

if ($Action -eq "Setup") {
  if ($currentBranch -eq $TargetBranch) {
    Write-Host "이미 대상 브랜치입니다."
  } else {
    $exists = GitOut @("-C", $RepoPath, "branch", "--list", $TargetBranch)
    if ($exists) {
      GitRun @("-C", $RepoPath, "switch", $TargetBranch)
    } else {
      GitRun @("-C", $RepoPath, "switch", "--track", "-c", $TargetBranch, "origin/$TargetBranch")
    }
  }
}

$currentBranch = GitOut @("-C", $RepoPath, "branch", "--show-current")
if ($currentBranch -ne $TargetBranch) { throw ("현재 브랜치는 " + $currentBranch + "입니다. Setup으로 먼저 연결하십시오.") }

GitRun @("-C", $RepoPath, "pull", "--ff-only", "origin", $TargetBranch)
Write-Host ("Local HEAD : " + (GitOut @("-C", $RepoPath, "rev-parse", "HEAD")))
Write-Host ("Remote HEAD: " + (GitOut @("-C", $RepoPath, "rev-parse", "origin/$TargetBranch")))
Write-Host "동기화 완료"
