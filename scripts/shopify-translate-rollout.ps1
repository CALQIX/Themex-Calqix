$ErrorActionPreference = 'Stop'

function Get-EnvValue {
  param([string]$Key, [string]$Path = 'calqix-capi/.env')
  $line = (Get-Content $Path | Select-String "^$Key=").ToString()
  return ($line -replace "^$Key=`"?([^`"]+)`"?.*$", '$1').Trim()
}

$token = Get-EnvValue -Key 'SHOPIFY_ADMIN_ACCESS_TOKEN'
$store = Get-EnvValue -Key 'SHOPIFY_STORE_DOMAIN'
$gqlUri = "https://$store/admin/api/2025-01/graphql.json"
$headers = @{ 'X-Shopify-Access-Token' = $token; 'Content-Type' = 'application/json' }

function Invoke-Gql {
  param([string]$Query, [hashtable]$Variables = @{})
  $body = @{ query = $Query; variables = $Variables } | ConvertTo-Json -Depth 20
  $resp = Invoke-RestMethod -Uri $gqlUri -Headers $headers -Method POST -Body $body
  if ($resp.errors) { throw "GraphQL errors: $($resp.errors | ConvertTo-Json -Depth 10)" }
  return $resp.data
}

# Get fresh digests
$blogRes = (Invoke-Gql -Query 'query { translatableResource(resourceId: "gid://shopify/Blog/123272659273") { translatableContent { key value digest } } }').translatableResource
$linkRes = (Invoke-Gql -Query 'query { translatableResource(resourceId: "gid://shopify/Link/746921230665") { translatableContent { key value digest } } }').translatableResource

$blogTitleDigest = ($blogRes.translatableContent | Where-Object { $_.key -eq 'title' }).digest
$linkTitleDigest = ($linkRes.translatableContent | Where-Object { $_.key -eq 'title' }).digest

Write-Output "Blog digest: $($blogTitleDigest.Substring(0,8))... | Link digest: $($linkTitleDigest.Substring(0,8))..."

# Blog title translations (for 'The Science Journal')
$blogTranslations = @{
  'nl' = 'Wetenschapsjournaal'
  'de' = 'Wissenschaftsjournal'
  'fr' = 'Journal scientifique'
  'fi' = 'Tiedejulkaisu'
  'nb' = 'Vitenskapsjournalen'
  'sv' = 'Vetenskapsjournalen'
  'da' = 'Videnskabsjournalen'
}

# Menu link title translations (for 'Science Journal')
$linkTranslations = @{
  'nl' = 'Wetenschap'
  'de' = 'Wissenschaft'
  'fr' = 'Science'
  'fi' = 'Tiede'
  'nb' = 'Vitenskap'
  'sv' = 'Vetenskap'
  'da' = 'Videnskab'
}

function Register-Translations {
  param(
    [string]$ResourceId,
    [string]$Key,
    [string]$Digest,
    [hashtable]$Values,
    [string]$ResourceLabel
  )
  $translationInputs = @()
  foreach ($locale in $Values.Keys) {
    $translationInputs += @{
      key               = $Key
      locale            = $locale
      translatableContentDigest = $Digest
      value             = $Values[$locale]
    }
  }
  $m = 'mutation($id: ID!, $t: [TranslationInput!]!) { translationsRegister(resourceId: $id, translations: $t) { translations { locale key value } userErrors { field message } } }'
  $v = @{ id = $ResourceId; t = $translationInputs }
  $res = Invoke-Gql -Query $m -Variables $v
  if ($res.translationsRegister.userErrors.Count -gt 0) {
    Write-Output "[FAIL] $ResourceLabel : $($res.translationsRegister.userErrors | ConvertTo-Json -Compress)"
  } else {
    Write-Output "[OK] $ResourceLabel : registered $($res.translationsRegister.translations.Count) translations"
    $res.translationsRegister.translations | ForEach-Object { Write-Output "     $($_.locale) $($_.key) -> '$($_.value)'" }
  }
}

Register-Translations -ResourceId 'gid://shopify/Blog/123272659273' -Key 'title' -Digest $blogTitleDigest -Values $blogTranslations -ResourceLabel 'Blog title'
Register-Translations -ResourceId 'gid://shopify/Link/746921230665' -Key 'title' -Digest $linkTitleDigest -Values $linkTranslations -ResourceLabel 'Menu link title'
