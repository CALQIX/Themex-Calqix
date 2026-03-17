const crypto = require('crypto');

const COUNTRY_DIAL_CODES = {
  NL: '31',
  BE: '32',
  DE: '49',
  FR: '33',
  ES: '34',
  GB: '44',
  UK: '44',
  US: '1',
  CA: '1'
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

  return normalized.slice(0, 2);
}

function normalizeZip(zip) {
  const normalized = normalizeBase(zip);
  if (!normalized) return null;

  return normalized.replace(/\s+/g, '');
}

function getDialCode(countryCode) {
  if (!countryCode) return '31';

  return COUNTRY_DIAL_CODES[countryCode.toString().trim().toUpperCase()] || '31';
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
    digits = `${dialCode}${digits.replace(/^0+/, '')}`;
    return digits || null;
  }

  if (countryCode && digits.length <= 10 && !digits.startsWith(dialCode)) {
    digits = `${dialCode}${digits}`;
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
  const phone = normalizePhone(customer.phone, customer.country_code || customer.countryCode);
  const firstName = normalizeText(customer.first_name || customer.firstName);
  const lastName = normalizeText(customer.last_name || customer.lastName);
  const city = normalizeText(customer.city, { keepSpaces: true });
  const state = normalizeText(customer.province_code || customer.provinceCode);
  const zip = normalizeZip(customer.zip || customer.postal_code || customer.postalCode);
  const country = normalizeCountry(customer.country_code || customer.countryCode);

  setHashedField(userData, 'em', email);
  if (phone) userData.ph = [hash(phone)];
  setHashedField(userData, 'fn', firstName);
  setHashedField(userData, 'ln', lastName);
  setHashedField(userData, 'ct', city);
  setHashedField(userData, 'st', state);
  setHashedField(userData, 'zp', zip);
  setHashedField(userData, 'country', country);

  if (ip) userData.client_ip_address = ip;
  if (userAgent) userData.client_user_agent = userAgent;
  if (customer.fbc) userData.fbc = customer.fbc;
  if (customer.fbp) userData.fbp = customer.fbp;

  return userData;
}

module.exports = {
  hash,
  hashPhone,
  formatUserData,
  normalizeBase,
  normalizeCountry,
  normalizeEmail,
  normalizePhone,
  normalizeText,
  normalizeZip
};
