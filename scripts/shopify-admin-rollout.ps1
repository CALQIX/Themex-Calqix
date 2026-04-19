param(
  [switch]$DryRun = $false
)

<#
  CALQIX Shopify Admin API rollout script (Task 1 + Task 9 Custom Pixel install).

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/shopify-admin-rollout.ps1          # live
    powershell -ExecutionPolicy Bypass -File scripts/shopify-admin-rollout.ps1 -DryRun  # plan only

  Reads tokens from calqix-capi/.env. Does not print secret values.
#>

$ErrorActionPreference = 'Stop'

function Get-EnvValue {
  param([string]$Key, [string]$Path = 'calqix-capi/.env')
  $line = (Get-Content $Path | Select-String "^$Key=").ToString()
  if ($null -eq $line) { throw "Missing env var: $Key" }
  return ($line -replace "^$Key=`"?([^`"]+)`"?.*$", '$1').Trim()
}

$token = Get-EnvValue -Key 'SHOPIFY_ADMIN_ACCESS_TOKEN'
$store = Get-EnvValue -Key 'SHOPIFY_STORE_DOMAIN'
$apiVer = '2025-01'
$gqlUri = "https://$store/admin/api/$apiVer/graphql.json"
$headers = @{ 'X-Shopify-Access-Token' = $token; 'Content-Type' = 'application/json' }

$actionLog = @()

function Invoke-Gql {
  param([string]$Query, [hashtable]$Variables = @{})
  $body = @{ query = $Query; variables = $Variables } | ConvertTo-Json -Depth 20
  $resp = Invoke-RestMethod -Uri $gqlUri -Headers $headers -Method POST -Body $body
  if ($resp.errors) { throw "GraphQL errors: $($resp.errors | ConvertTo-Json -Depth 10)" }
  return $resp.data
}

function Log-Action {
  param([string]$Name, [string]$Status, [string]$Details = '')
  $script:actionLog += [PSCustomObject]@{ Action = $Name; Status = $Status; Details = $Details }
  Write-Output "[$Status] $Name $(if ($Details) { "- $Details" })"
}

$blogId = 'gid://shopify/Blog/123272659273'
$menuId = 'gid://shopify/Menu/302487273801'
$elenaMenuItemId = 'gid://shopify/MenuItem/743268155721'
$newBlogHandle = 'the-science-journal'

# ---------------------------------------------------------------------------
# 1. URL redirect (create only if missing)
# ---------------------------------------------------------------------------
$redirectFrom = '/blogs/calqix-elena-writes'
$redirectTo = "/blogs/$newBlogHandle"
$existing = (Invoke-Gql -Query 'query($q: String!) { urlRedirects(first: 1, query: $q) { nodes { id path target } } }' -Variables @{ q = "path:$redirectFrom" }).urlRedirects.nodes
if ($existing -and $existing.Count -gt 0) {
  Log-Action 'URL Redirect' 'SKIP' "already exists: $($existing[0].path) -> $($existing[0].target)"
} elseif ($DryRun) {
  Log-Action 'URL Redirect' 'DRY_RUN' "would create $redirectFrom -> $redirectTo"
} else {
  $m = 'mutation($r: UrlRedirectInput!) { urlRedirectCreate(urlRedirect: $r) { urlRedirect { id path target } userErrors { field message } } }'
  $v = @{ r = @{ path = $redirectFrom; target = $redirectTo } }
  $res = Invoke-Gql -Query $m -Variables $v
  if ($res.urlRedirectCreate.userErrors.Count -gt 0) {
    Log-Action 'URL Redirect' 'FAIL' ($res.urlRedirectCreate.userErrors | ConvertTo-Json -Compress)
  } else {
    Log-Action 'URL Redirect' 'OK' "$redirectFrom -> $redirectTo [$($res.urlRedirectCreate.urlRedirect.id)]"
  }
}

# ---------------------------------------------------------------------------
# 2. Rename blog title + change handle (atomic)
# ---------------------------------------------------------------------------
$newBlogTitle = 'The Science Journal'
if ($DryRun) {
  Log-Action 'Blog rename' 'DRY_RUN' "would rename title to '$newBlogTitle' + handle to '$newBlogHandle'"
} else {
  $m = 'mutation($id: ID!, $blog: BlogUpdateInput!) { blogUpdate(id: $id, blog: $blog) { blog { id handle title } userErrors { field message } } }'
  $v = @{ id = $blogId; blog = @{ title = $newBlogTitle; handle = $newBlogHandle } }
  $res = Invoke-Gql -Query $m -Variables $v
  if ($res.blogUpdate.userErrors.Count -gt 0) {
    Log-Action 'Blog rename' 'FAIL' ($res.blogUpdate.userErrors | ConvertTo-Json -Compress)
  } else {
    Log-Action 'Blog rename' 'OK' "handle=$($res.blogUpdate.blog.handle) title='$($res.blogUpdate.blog.title)'"
  }
}

# ---------------------------------------------------------------------------
# 3. Update main menu: rename "Elena writes" -> "Science Journal", update URL, rewrite subitems
# ---------------------------------------------------------------------------
$menuData = (Invoke-Gql -Query 'query($id: ID!) { menu(id: $id) { id handle title items { id title url type resourceId tags items { id title url type resourceId tags } } } }' -Variables @{ id = $menuId }).menu
$newItems = @()
foreach ($item in $menuData.items) {
  $newItem = [ordered]@{
    title = $item.title
    type  = $item.type
    url   = $item.url
  }
  if ($item.resourceId) { $newItem.resourceId = $item.resourceId }
  if ($item.id -eq $elenaMenuItemId) {
    $newItem.title = 'Science Journal'
    $newItem.url = "https://www.calqix.com/blogs/$newBlogHandle"
  }
  $subItems = @()
  foreach ($sub in $item.items) {
    $newSub = [ordered]@{
      title = $sub.title
      type  = $sub.type
      url   = if ($sub.url -like '*/blogs/calqix-elena-writes*') { $sub.url -replace 'calqix-elena-writes', $newBlogHandle } else { $sub.url }
    }
    if ($sub.resourceId) { $newSub.resourceId = $sub.resourceId }
    $subItems += $newSub
  }
  if ($subItems.Count -gt 0) { $newItem.items = $subItems }
  $newItems += $newItem
}

if ($DryRun) {
  Log-Action 'Menu update' 'DRY_RUN' "would rename Elena writes -> Science Journal and rewrite subitem URLs"
} else {
  $m = 'mutation($id: ID!, $title: String!, $handle: String!, $items: [MenuItemUpdateInput!]!) { menuUpdate(id: $id, title: $title, handle: $handle, items: $items) { menu { id items { title url } } userErrors { field message } } }'
  $v = @{ id = $menuId; title = $menuData.title; handle = $menuData.handle; items = $newItems }
  $res = Invoke-Gql -Query $m -Variables $v
  if ($res.menuUpdate.userErrors.Count -gt 0) {
    Log-Action 'Menu update' 'FAIL' ($res.menuUpdate.userErrors | ConvertTo-Json -Compress)
  } else {
    Log-Action 'Menu update' 'OK' "renamed item, rewrote $($subItems.Count) subitem URLs"
  }
}

# ---------------------------------------------------------------------------
# 4. Install / update CALQIX Meta CAPI Custom Pixel (Shopify web pixel)
# ---------------------------------------------------------------------------
# Shopify Custom Pixels (the type defined in Shopify admin > Customer events > Add custom pixel)
# cannot be created via Admin API. `webPixelCreate` only registers a pixel owned by the calling
# app, which requires an app extension bundle.
# We copy the pixel source to a known path so the operator can paste it into admin.
Copy-Item 'calqix-capi/shopify-custom-pixel.js' 'scripts/shopify-custom-pixel.for-admin.js' -Force
Log-Action 'Custom Pixel' 'MANUAL' 'Admin API cannot install Custom Pixels. Pixel source copied to scripts/shopify-custom-pixel.for-admin.js for operator to paste into admin > Settings > Customer events > Add custom pixel (name: CALQIX Meta CAPI).'

# ---------------------------------------------------------------------------
# 5. Scan the NHA article for Elena / Dr. Elena mentions, produce dry-run diff
# ---------------------------------------------------------------------------
$nhaArticleId = 'gid://shopify/Article/615270777161'
$art = (Invoke-Gql -Query 'query($id: ID!) { article(id: $id) { id title handle body author { name } } }' -Variables @{ id = $nhaArticleId }).article
$body = $art.body
$findings = @()
foreach ($pattern in @('Dr. Elena Hartwell', 'Dr\. Elena', 'Elena Hartwell', 'Elena')) {
  $matches = [regex]::Matches($body, $pattern)
  foreach ($m in $matches) {
    $start = [Math]::Max(0, $m.Index - 40)
    $len = [Math]::Min(120, $body.Length - $start)
    $ctx = $body.Substring($start, $len) -replace "`r?`n", ' '
    $findings += "  pattern='$pattern' context='...$ctx...'"
  }
}
if ($findings.Count -gt 0) {
  Log-Action 'Article scan' 'FOUND' "article '$($art.title)' by '$($art.author.name)' has $($findings.Count) matches"
  $findings | ForEach-Object { $script:actionLog += [PSCustomObject]@{ Action = '  article match'; Status = 'INFO'; Details = $_ } }
} else {
  Log-Action 'Article scan' 'CLEAN' "no Elena mentions in article body"
}

# Dump body to file for operator review
New-Item -ItemType Directory -Path 'reports' -Force | Out-Null
$reportFile = 'reports/task1-article-body-for-review.html'
"<!-- Article: $($art.title)`nHandle: $($art.handle)`nAuthor: $($art.author.name)`nShopify ID: $($art.id)`n-->`n" + $body | Out-File -FilePath $reportFile -Encoding utf8
Log-Action 'Article dump' 'OK' "saved body to $reportFile for operator review"

# ---------------------------------------------------------------------------
# 5b. Rewrite article author fields for any article authored by Dr. Elena Hartwell
# ---------------------------------------------------------------------------
$allArticles = @()
$nextCursor = $null
do {
  $q = 'query($cursor: String) { articles(first: 100, after: $cursor) { nodes { id title author { name } } pageInfo { hasNextPage endCursor } } }'
  $d = (Invoke-Gql -Query $q -Variables @{ cursor = $nextCursor }).articles
  $allArticles += $d.nodes
  $nextCursor = if ($d.pageInfo.hasNextPage) { $d.pageInfo.endCursor } else { $null }
} while ($nextCursor)

$elenaArticles = $allArticles | Where-Object { $_.author.name -like '*Elena*' }
if ($elenaArticles.Count -eq 0) {
  Log-Action 'Article author rewrite' 'CLEAN' 'no articles authored by Elena remaining'
} else {
  foreach ($a in $elenaArticles) {
    if ($DryRun) {
      Log-Action '  author rewrite' 'DRY_RUN' "would rewrite author of '$($a.title)' from '$($a.author.name)' -> 'CALQIX Science Team'"
    } else {
      $m = 'mutation($id: ID!, $article: ArticleUpdateInput!) { articleUpdate(id: $id, article: $article) { article { id title author { name } } userErrors { field message } } }'
      $v = @{ id = $a.id; article = @{ author = @{ name = 'CALQIX Science Team' } } }
      $res = Invoke-Gql -Query $m -Variables $v
      if ($res.articleUpdate.userErrors.Count -gt 0) {
        Log-Action '  author rewrite' 'FAIL' ("$($a.title): " + ($res.articleUpdate.userErrors | ConvertTo-Json -Compress))
      } else {
        Log-Action '  author rewrite' 'OK' "'$($a.title)' -> '$($res.articleUpdate.article.author.name)'"
      }
    }
  }
}

# ---------------------------------------------------------------------------
# 6. Write summary
# ---------------------------------------------------------------------------
$summary = @"
# Shopify Admin Rollout Summary

Run at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ($(if ($DryRun) { 'DRY RUN' } else { 'LIVE' }))
Store: $store

"@
$summary += "| # | Action | Status | Details |`n| - | - | - | - |`n"
$i = 1
foreach ($a in $actionLog) {
  $summary += "| $i | $($a.Action) | $($a.Status) | $($a.Details) |`n"
  $i++
}
$summary | Out-File -FilePath 'reports/task1-admin-rollout.md' -Encoding utf8
Write-Output ""
Write-Output "Summary written to reports/task1-admin-rollout.md"
