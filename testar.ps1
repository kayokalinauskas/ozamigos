# Roda toda a suíte de testes, na ordem da mais rápida para a mais lenta, e mostra um resumo no fim.
#   .\testar.ps1            tudo
#   .\testar.ps1 -Rapido    só servidor e interface (sem navegadores nem o app)
# O ponta a ponta sobe um servidor na porta 8090 (a 8080 fica livre).
param([switch]$Rapido)

$raiz = $PSScriptRoot
$resultados = @()

function Etapa($nome, $pasta, [scriptblock]$comando) {
  Write-Host "`n=== $nome ===" -ForegroundColor Cyan
  Push-Location (Join-Path $raiz $pasta)
  $inicio = Get-Date
  try {
    & $comando
    $ok = ($LASTEXITCODE -eq 0)
  } catch {
    Write-Host $_ -ForegroundColor Red
    $ok = $false
  } finally {
    Pop-Location
  }
  $script:resultados += [pscustomobject]@{ Etapa = $nome; Resultado = $(if ($ok) { 'ok' } else { 'FALHOU' }); Segundos = [int]((Get-Date) - $inicio).TotalSeconds }
}

Etapa 'Servidor: unidade e sinalização (JUnit)' '.' { .\mvnw.cmd -q -B test }
Etapa 'Interface: unidade e áudio (Vitest)' 'web' { npm test --silent }
if (-not $Rapido) {
  Etapa 'Interface: build (tipos + pacote)' 'web' { npm run build --silent }
  Etapa 'Ponta a ponta: sala, transmissão e voz (Playwright)' 'web' { npm run test:e2e --silent }
  Etapa 'App do Windows: fumaça (Playwright + Electron)' 'desktop' { npm test --silent }
}

$resultados | Format-Table -AutoSize
if ($resultados.Resultado -contains 'FALHOU') { exit 1 }
