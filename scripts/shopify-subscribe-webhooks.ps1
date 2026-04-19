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
$uri = "https://$store/admin/api/2025-01/webhooks.json"

$subs = @(
  @{ topic = 'customers/create';   address = "$base/api/webhook/customers-create" },
  @{ topic = 'carts/create';       address = "$base/api/webhook/carts-create" },
  @{ topic = 'carts/update';       address = "$base/api/webhook/carts-create" },
  @{ topic = 'checkouts/create';   address = "$base/api/webhook/checkouts-create" },
  @{ topic = 'checkouts/update';   address = "$base/api/webhook/checkouts-create" },
  @{ topic = 'orders/paid';        address = "$base/api/webhook/orders-paid" }
)

# List existing first (for idempotency)
$existingResp = Invoke-RestMethod -Uri $uri -Headers $headers -Method GET
$existingMap = @{}
foreach ($w in $existingResp.webhooks) {
  $existingMap["$($w.topic)|$($w.address)"] = $w.id
}

foreach ($s in $subs) {
  $key = "$($s.topic)|$($s.address)"
  if ($existingMap.ContainsKey($key)) {
    Write-Output "[SKIP] $($s.topic) -> already subscribed (id $($existingMap[$key]))"
    continue
  }
  $body = @{ webhook = @{ topic = $s.topic; address = $s.address; format = 'json' } } | ConvertTo-Json -Depth 5
  try {
    $resp = Invoke-RestMethod -Uri $uri -Headers $headers -Method POST -Body $body
    $wh = $resp.webhook
    Write-Output "[OK] $($wh.topic) -> $($wh.address) (id $($wh.id))"
  } catch {
    $msg = $_.Exception.Message
    $detail = ''
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $detail = $reader.ReadToEnd()
    } catch {}
    Write-Output "[FAIL] $($s.topic) - $msg $detail"
  }
}
