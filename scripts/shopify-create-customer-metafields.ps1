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

# Metafield definitions to create on CUSTOMER owner
$definitions = @(
  @{
    name        = 'Birthday'
    namespace   = 'calqix'
    key         = 'birthday'
    type        = 'date'
    ownerType   = 'CUSTOMER'
    description = 'Customer birthday (YYYY-MM-DD) used for Meta Advanced Matching db field.'
    pin         = $true
  },
  @{
    name        = 'Gender'
    namespace   = 'calqix'
    key         = 'gender'
    type        = 'single_line_text_field'
    ownerType   = 'CUSTOMER'
    description = 'Customer gender (male|female|other|prefer_not_to_say) used for Meta Advanced Matching ge field.'
    pin         = $true
  }
)

$m = 'mutation CreateDef($d: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $d) { createdDefinition { id name namespace key type { name } } userErrors { field message code } } }'

foreach ($d in $definitions) {
  $v = @{ d = $d }
  try {
    $res = Invoke-Gql -Query $m -Variables $v
    $errors = $res.metafieldDefinitionCreate.userErrors
    if ($errors -and $errors.Count -gt 0) {
      $errTxt = ($errors | ConvertTo-Json -Compress)
      if ($errTxt -match 'already exists|TAKEN') {
        Write-Output "[SKIP] $($d.namespace).$($d.key) - already exists"
      } else {
        Write-Output "[FAIL] $($d.namespace).$($d.key) - $errTxt"
      }
    } else {
      $cd = $res.metafieldDefinitionCreate.createdDefinition
      Write-Output "[OK] created $($cd.namespace).$($cd.key) ($($cd.type.name)) - $($cd.id)"
    }
  } catch {
    $errMsg = $_.Exception.Message
    Write-Output "[ERR] $($d.namespace).$($d.key) - $errMsg"
  }
}
