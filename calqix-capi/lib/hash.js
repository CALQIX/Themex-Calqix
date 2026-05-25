const crypto = require('crypto');
const nlProvince = require('./nl-postcode-province');

const COUNTRY_DIAL_CODES = {
  NL: '31',
  BE: '32',
  DE: '49',
  FR: '33',
  ES: '34',
  GB: '44',
  UK: '44',
  US: '1',
  CA: '1',
  AT: '43',
  CH: '41',
  LI: '423',
  SE: '46',
  NO: '47',
  DK: '45',
  FI: '358',
  IS: '354',
  LU: '352'
};

const COUNTRY_NAME_TO_CODE = {
  nederland: 'nl',
  netherlands: 'nl',
  holland: 'nl',
  belgie: 'be',
  belgium: 'be',
  belgique: 'be',
  deutschland: 'de',
  germany: 'de',
  allemagne: 'de',
  france: 'fr',
  frankrijk: 'fr',
  espana: 'es',
  spain: 'es',
  austria: 'at',
  osterreich: 'at',
  switzerland: 'ch',
  schweiz: 'ch',
  suisse: 'ch',
  unitedkingdom: 'gb',
  uk: 'gb',
  greatbritain: 'gb',
  england: 'gb',
  unitedstates: 'us',
  unitedstatesofamerica: 'us',
  usa: 'us',
  canada: 'ca',
  sweden: 'se',
  sverige: 'se',
  norway: 'no',
  norge: 'no',
  denmark: 'dk',
  danmark: 'dk',
  finland: 'fi',
  iceland: 'is',
  luxembourg: 'lu',
  luxemburg: 'lu'
};

function normalizeBase(value) {
  if (value === null || value === undefined) return null;

  const normalized = value.toString().trim().toLowerCase();
  return normalized || null;
}

function normalizeText(value, options = {}) {
  const base = normalizeBase(value);
  if (!base) return null;

  const sanitized = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(options.keepSpaces ? /[^a-z0-9\s]/g : /[^a-z0-9]/g, '')
    .replace(/\s+/g, options.removeSpaces === false ? ' ' : '');

  return sanitized || null;
}

function normalizeEmail(email) {
  return normalizeBase(email);
}

function normalizeCountry(country) {
  const normalized = normalizeBase(country);
  if (!normalized) return null;

  const compact = normalizeText(normalized);
  if (!compact) return null;
  if (compact.length === 2) return compact;
  return COUNTRY_NAME_TO_CODE[compact] || null;
}

function normalizeZip(zip) {
  const normalized = normalizeBase(zip);
  if (!normalized) return null;

  return normalized.replace(/\s+/g, '');
}

function normalizeDateOfBirth(value) {
  const normalized = normalizeBase(value);
  if (!normalized) return null;

  const compactMatch = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    const compact = compactMatch[1] + compactMatch[2] + compactMatch[3];
    return isValidYYYYMMDD(compact) ? compact : null;
  }

  const isoMatch = normalized.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (isoMatch) {
    const iso = isoMatch[1] + isoMatch[2] + isoMatch[3];
    return isValidYYYYMMDD(iso) ? iso : null;
  }

  return null;
}

function isValidYYYYMMDD(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (year < 1900 || year > new Date().getUTCFullYear()) return false;
  if (month < 1 || month > 12) return false;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= lastDay;
}

function getDialCode(countryCode) {
  if (!countryCode) return null;

  return COUNTRY_DIAL_CODES[countryCode.toString().trim().toUpperCase()] || null;
}

function normalizePhone(phone, countryCode) {
  const base = phone === null || phone === undefined ? null : phone.toString().trim();
  if (!base) return null;

  let digits = base.replace(/\D/g, '');
  if (!digits) return null;

  if (base.trim().startsWith('+')) {
    return digits;
  }

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
    return digits || null;
  }

  const dialCode = getDialCode(countryCode);

  if (digits.startsWith('0')) {
    if (!dialCode) return null;
    digits = `${dialCode}${digits.replace(/^0+/, '')}`;
    return digits || null;
  }

  if (dialCode && digits.length <= 10 && !digits.startsWith(dialCode)) {
    digits = `${dialCode}${digits}`;
  } else if (!dialCode && digits.length <= 10) {
    return null;
  }

  return digits || null;
}

function hash(value) {
  const normalized = normalizeBase(value);
  if (!normalized) return null;

  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function hashPhone(phone, countryCode) {
  const normalizedPhone = normalizePhone(phone, countryCode);
  if (!normalizedPhone) return null;

  return hash(normalizedPhone);
}

function setHashedField(target, key, value) {
  if (value) {
    target[key] = [hash(value)];
  }
}

function formatUserData(customer = {}, ip, userAgent) {
  const userData = {};

  const email = normalizeEmail(customer.email);
  const country = normalizeCountry(
    customer.country_code ||
    customer.countryCode ||
    customer.country ||
    customer.country_name ||
    customer.countryName
  );
  const phone = normalizePhone(
    customer.phone || customer.phone_number || customer.phoneNumber,
    country || customer.country_code || customer.countryCode
  );
  const firstName = normalizeText(customer.first_name || customer.firstName || customer.fn);
  const lastName = normalizeText(customer.last_name || customer.lastName || customer.ln);
  const city = normalizeText(customer.city || customer.town || customer.ct, { keepSpaces: true });
  const zip = normalizeZip(customer.zip || customer.postal_code || customer.postalCode || customer.zp);
  const stateRaw =
    customer.state ||
    customer.st ||
    customer.province_code ||
    customer.provinceCode ||
    customer.province ||
    customer.province_name ||
    customer.provinceName ||
    customer.region_code ||
    (country === 'nl' && zip ? nlProvince.lookup(zip) : null);
  const state = normalizeText(stateRaw);
  const dateOfBirth = normalizeDateOfBirth(
    customer.db ||
    customer.date_of_birth ||
    customer.dateOfBirth ||
    customer.birthdate ||
    customer.birthday
  );

  setHashedField(userData, 'em', email);
  if (phone) userData.ph = [hash(phone)];
  setHashedField(userData, 'fn', firstName);
  setHashedField(userData, 'ln', lastName);
  setHashedField(userData, 'ct', city);
  setHashedField(userData, 'st', state);
  setHashedField(userData, 'zp', zip);
  setHashedField(userData, 'country', country);
  setHashedField(userData, 'db', dateOfBirth);

  if (ip) userData.client_ip_address = ip;
  if (userAgent) userData.client_user_agent = userAgent;
  if (customer.fbc) userData.fbc = customer.fbc;
  if (customer.fbp) userData.fbp = customer.fbp;

  // external_id must be a stable first-party identifier. Do not inflate it
  // with email fallback; email already has its own hashed `em` field.
  const externalIdRaw = customer.external_id;
  if (externalIdRaw) {
    userData.external_id = [hash(String(externalIdRaw))];
  }

  // fb_login_id — Facebook's internal numeric user ID, passed when user logs in via FB.
  // Captured via Shopify/Klaviyo custom field or custom signup form integration.
  if (customer.fb_login_id) {
    userData.fb_login_id = String(customer.fb_login_id);
  }

  // subscription_id — for recurring subscription orders (Seal Subscriptions).
  // Lets Meta group repeat purchases and improves retention-based modeling.
  if (customer.subscription_id) {
    userData.subscription_id = String(customer.subscription_id);
  }

  return userData;
}

module.exports = {
  hash,
  hashPhone,
  formatUserData,
  normalizeBase,
  normalizeCountry,
  normalizeEmail,
  normalizeDateOfBirth,
  normalizePhone,
  normalizeText,
  normalizeZip
};
