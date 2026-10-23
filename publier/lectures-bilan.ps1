# Bilan des lectures de photos de résultats par Gemini (historique du Worker publier,
# KV LECTURES, clé « historique » : les 300 dernières).
# Usage :  pwsh publier/lectures-bilan.ps1 [-Detail]
param([switch]$Detail)

Push-Location $PSScriptRoot
try {
  $brut = npx --yes wrangler@4 kv key get historique --binding LECTURES --remote 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $brut) { Write-Host "Aucune lecture enregistrée pour l'instant."; return }
  $liste = ($brut -join "`n") | ConvertFrom-Json
} finally { Pop-Location }

$heure = { param($e) ([datetime]$e.t).ToLocalTime() }
$med = { param($v) $s = @($v | Sort-Object); if (!$s.Count) { return 0 }; $s[[math]::Floor(($s.Count - 1) / 2)] }
$ok = @($liste | ? ok)
Write-Host ("{0} lectures, du {1:d MMM HH:mm} au {2:d MMM HH:mm}" -f $liste.Count, (& $heure $liste[-1]), (& $heure $liste[0]))
Write-Host ("Réussies : {0}  ·  échecs : {1}  ·  photo illisible : {2}" -f $ok.Count, ($liste.Count - $ok.Count), @($ok | ? { -not $_.lisible }).Count)
if ($ok.Count) {
  Write-Host ("Durée : médiane {0:N1} s, moyenne {1:N1} s, max {2:N1} s" -f ((& $med $ok.ms) / 1000), (($ok.ms | Measure-Object -Average).Average / 1000), (($ok.ms | Measure-Object -Maximum).Maximum / 1000))
  $soir = @($ok | ? { $h = (& $heure $_).Hour; $h -ge 18 -or $h -lt 2 })
  $jour = @($ok | ? { $soir -notcontains $_ })
  if ($soir.Count -and $jour.Count) { Write-Host ("Soir (18 h-2 h) : médiane {0:N1} s sur {1}  ·  reste : {2:N1} s sur {3}" -f ((& $med $soir.ms) / 1000), $soir.Count, ((& $med $jour.ms) / 1000), $jour.Count) }
  $ok | Group-Object modele | % { Write-Host ("  {0} : {1} lectures, médiane {2:N1} s" -f $_.Name, $_.Count, ((& $med $_.Group.ms) / 1000)) }
}
$secours = @($liste | ? { $_.essais.Count -gt 1 }).Count
Write-Host "Bascules / nouveaux essais : $secours"
if ($Detail) {
  $liste | % { "{0:d MMM HH:mm}  match {1,-4} {2,6:N1} s  {3}  {4}" -f (& $heure $_), $_.match, ($_.ms / 1000), ($(if ($_.ok) { $_.modele } else { 'ÉCHEC ' + $_.erreur })), (($_.essais | % { "$($_[0]):$($_[2]) $([math]::Round($_[1]/1000,1))s" }) -join ' → ') }
}
