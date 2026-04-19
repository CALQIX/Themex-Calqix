$ErrorActionPreference = 'Stop'

function Get-EnvValue {
  param([string]$Key, [string]$Path = 'calqix-capi/.env')
  $line = (Get-Content $Path | Select-String "^$Key=").ToString()
  return ($line -replace "^$Key=`"?([^`"]+)`"?.*$", '$1').Trim()
}

$token = Get-EnvValue -Key 'SHOPIFY_ADMIN_ACCESS_TOKEN'
$store = Get-EnvValue -Key 'SHOPIFY_STORE_DOMAIN'
$base  = 'https://calqix-capi.vercel.app'
$headers = @{ 'X-Shopify-Access-Token' = $token; 'Content-Type' = 'application/json' }
$restUri = "https://$store/admin/api/2025-01/webhooks.json"
$gqlUri  = "https://$store/admin/api/2025-01/graphql.json"

# Step 1: delete all REST-owned calqix-capi webhooks
Write-Output '== Step 1: delete existing REST webhooks =='
$existing = Invoke-RestMethod -Uri $restUri -Headers $headers -Method GET
foreach ($w in $existing.webhooks) {
  if ($w.address -like "$base*") {
    try {
      Invoke-RestMethod -Uri "https://$store/admin/api/2025-01/webhooks/$($w.id).json" -Headers $headers -Method DELETE | Out-Null
      Write-Output "[DEL] $($w.topic) id=$($w.id)"
    } catch {
      Write-Output "[FAIL-DEL] $($w.topic) - $($_.Exception.Message)"
    }
  }
}

# Step 2: recreate via GraphQL webhookSubscriptionCreate (signed with Custom App API secret)
Write-Output ''
Write-Output '== Step 2: create via GraphQL (app-secret signed) =='
$subs = @(
  @{ topic = 'CUSTOMERS_CREATE'; endpoint = "$base/api/webhook/customers-create" },
  @{ topic = 'CARTS_CREATE';     endpoint = "$base/api/webhook/carts-create" },
  @{ topic = 'CARTS_UPDATE';     endpoint = "$base/api/webhook/carts-create" },
  @{ topic = 'CHECKOUTS_CREATE'; endpoint = "$base/api/webhook/checkouts-create" },
  @{ topic = 'CHECKOUTS_UPDATE'; endpoint = "$base/api/webhook/checkouts-create" },
  @{ topic = 'ORDERS_PAID';      endpoint = "$base/api/webhook/orders-paid" }
)

$m = 'mutation Sub($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { webhookSubscription { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } userErrors { field message } } }'

foreach ($s in $subs) {
  $vars = @{
    topic = $s.topic
    sub = @{
      callbackUrl = $s.endpoint
      format = 'JSON'
    }
  }
  $body = @{ query = $m; variables = $vars } | ConvertTo-Json -Depth 10
  try {
    $resp = Invoke-RestMethod -Uri $gqlUri -Headers $headers -Method POST -Body $body
    if ($resp.errors) {
      Write-Output "[FAIL] $($s.topic) - GraphQL errors: $($resp.errors | ConvertTo-Json -Compress)"
      continue
    }
    $errs = $resp.data.webhookSubscriptionCreate.userErrors
    if ($errs -and $errs.Count -gt 0) {
      Write-Output "[FAIL] $($s.topic) - $($errs | ConvertTo-Json -Compress)"
    } else {
      $w = $resp.data.webhookSubscriptionCreate.webhookSubscription
      Write-Output "[OK] $($w.topic) -> $($w.endpoint.callbackUrl) (id $($w.id))"
    }
  } catch {
    Write-Output "[ERR] $($s.topic) - $($_.Exception.Message)"
  }
}
