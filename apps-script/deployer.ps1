# LNHQ — envoie publication.gs dans le projet Apps Script « LNHQ Publication » et met à jour
# le déploiement de l'application web utilisé par le Worker (même adresse, nouvelle version).
# Prérequis (une fois) : API Apps Script activée (script.google.com/home/usersettings) et
#                        « npx @google/clasp login ».
# Utilisation : pwsh apps-script/deployer.ps1 "Description de la version"
param([string]$Description = 'Mise à jour')
$ErrorActionPreference = 'Stop'

$SCRIPT_ID = '1zOGqxAC4MikhxDK61wwr7GQVqPd6JsypxkYGjPtbZb1JkM_EWu7WLAMv'
$DEPLOIEMENT = 'AKfycbzDNUqBxVnbDQTmIyz4xRRTOrJncWRWCzKU-iozWkN16nv9PZRYDriyORoKs0ly1dPWBw'

# Dossier temporaire : le projet en ligne n'a qu'un fichier, Code.js (+ le manifeste).
$tmp = Join-Path $env:TEMP 'lnhq-clasp'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $tmp | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'appsscript.json') $tmp
Copy-Item (Join-Path $PSScriptRoot 'publication.gs') (Join-Path $tmp 'Code.js')
"{ `"scriptId`": `"$SCRIPT_ID`", `"rootDir`": `"`" }" | Set-Content (Join-Path $tmp '.clasp.json') -Encoding utf8

Push-Location $tmp
try {
  npx --yes @google/clasp push -f
  if ($LASTEXITCODE -ne 0) { throw 'clasp push a échoué' }
  npx --yes @google/clasp deploy -i $DEPLOIEMENT -d $Description
  if ($LASTEXITCODE -ne 0) { throw 'clasp deploy a échoué' }
} finally {
  Pop-Location
}
