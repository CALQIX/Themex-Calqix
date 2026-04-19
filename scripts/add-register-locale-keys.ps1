# One-off: adds 7 new keys under customer.register in all 8 shipped locales.
# Idempotent: if key exists already, skips it.
$ErrorActionPreference = 'Stop'

$translations = @{
  'en.default.json' = @{
    optional_profile = 'Optional (helps us personalise your experience)'
    birthday = 'Birthday'
    gender = 'Gender'
    gender_placeholder = 'Prefer not to say'
    gender_female = 'Female'
    gender_male = 'Male'
    gender_other = 'Other'
  }
  'nl.json' = @{
    optional_profile = 'Optioneel (helpt ons jouw ervaring te personaliseren)'
    birthday = 'Geboortedatum'
    gender = 'Geslacht'
    gender_placeholder = 'Zeg ik liever niet'
    gender_female = 'Vrouw'
    gender_male = 'Man'
    gender_other = 'Anders'
  }
  'de.json' = @{
    optional_profile = 'Optional (hilft uns, dein Erlebnis zu personalisieren)'
    birthday = 'Geburtstag'
    gender = 'Geschlecht'
    gender_placeholder = 'Keine Angabe'
    gender_female = 'Weiblich'
    gender_male = 'Männlich'
    gender_other = 'Divers'
  }
  'fr.json' = @{
    optional_profile = 'Facultatif (nous aide a personnaliser votre experience)'
    birthday = 'Date de naissance'
    gender = 'Genre'
    gender_placeholder = 'Prefere ne pas dire'
    gender_female = 'Femme'
    gender_male = 'Homme'
    gender_other = 'Autre'
  }
  'fi.json' = @{
    optional_profile = 'Valinnainen (auttaa meita personoimaan kokemuksesi)'
    birthday = 'Syntymapaiva'
    gender = 'Sukupuoli'
    gender_placeholder = 'En halua kertoa'
    gender_female = 'Nainen'
    gender_male = 'Mies'
    gender_other = 'Muu'
  }
  'nb.json' = @{
    optional_profile = 'Valgfritt (hjelper oss a tilpasse opplevelsen din)'
    birthday = 'Fodselsdag'
    gender = 'Kjonn'
    gender_placeholder = 'Foretrekker a ikke si'
    gender_female = 'Kvinne'
    gender_male = 'Mann'
    gender_other = 'Annet'
  }
  'sv.json' = @{
    optional_profile = 'Valfritt (hjalper oss att personalisera din upplevelse)'
    birthday = 'Fodelsedag'
    gender = 'Kon'
    gender_placeholder = 'Vill inte saga'
    gender_female = 'Kvinna'
    gender_male = 'Man'
    gender_other = 'Annat'
  }
  'da.json' = @{
    optional_profile = 'Valgfrit (hjaelper os med at personalisere din oplevelse)'
    birthday = 'Fodselsdag'
    gender = 'Kon'
    gender_placeholder = 'Foretraekker ikke at sige'
    gender_female = 'Kvinde'
    gender_male = 'Mand'
    gender_other = 'Andet'
  }
}

foreach ($file in $translations.Keys) {
  $path = "locales/$file"
  if (!(Test-Path $path)) {
    Write-Output "[SKIP] $file - not found"
    continue
  }

  $raw = Get-Content -Raw -Path $path -Encoding utf8
  $json = $raw | ConvertFrom-Json

  if (-not $json.customer) { $json | Add-Member -MemberType NoteProperty -Name 'customer' -Value ([PSCustomObject]@{}) -Force }
  if (-not $json.customer.register) { $json.customer | Add-Member -MemberType NoteProperty -Name 'register' -Value ([PSCustomObject]@{}) -Force }

  $added = 0
  foreach ($k in $translations[$file].Keys) {
    if ($null -eq $json.customer.register.$k) {
      $json.customer.register | Add-Member -MemberType NoteProperty -Name $k -Value $translations[$file][$k] -Force
      $added++
    }
  }

  if ($added -gt 0) {
    $out = $json | ConvertTo-Json -Depth 50
    Set-Content -Path $path -Value $out -Encoding utf8
    Write-Output "[OK] $file - added $added keys"
  } else {
    Write-Output "[SKIP] $file - all keys present"
  }
}
