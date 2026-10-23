# Envoie la base des ratings NHL 27 (projet nhl27-ratings) dans le KV privé RATINGS
# du Worker publier. Le fichier n'est jamais copié dans ce dépôt (public sur GitHub).
# Usage, depuis n'importe où :  pwsh publier/ratings-envoyer.ps1 [chemin\joueurs.json]
param([string]$Fichier = "$PSScriptRoot\..\..\nhl27-ratings\donnees\joueurs.json")

$Fichier = (Resolve-Path $Fichier -ErrorAction Stop).Path
$joueurs = Get-Content $Fichier -Raw -Encoding UTF8 | ConvertFrom-Json   # refuse un JSON invalide
$n = ($joueurs.PSObject.Properties | Measure-Object).Count
$meta = '{"misAJour":"' + (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss') + '"}'

Push-Location $PSScriptRoot
try {
  npx --yes wrangler@4 kv key put joueurs --path $Fichier --binding RATINGS --remote --metadata $meta
  if ($LASTEXITCODE -eq 0) { Write-Host "$n joueurs envoyés : https://publier.lnhq.ca/ratings.html" }
} finally { Pop-Location }
