/**
 * Dutch postcode to province mapping.
 *
 * Maps the first 2 digits of a Dutch (NL) postcode to province.
 * Used for Meta CAPI state/province coverage on NL orders.
 *
 * Source: official Dutch postcode ranges per province.
 */

var POSTCODE_RANGES = [
  // [min, max, province_code]
  [10, 10, 'NH'],  // 10xx = Amsterdam
  [11, 11, 'NH'],  // 11xx = Amsterdam area
  [12, 12, 'NH'],  // 12xx = Hilversum area
  [13, 13, 'NH'],  // 13xx = Almere (actually Flevoland for 13xx)
  [14, 14, 'UT'],  // 14xx = Utrecht area
  [15, 15, 'NH'],  // 15xx = Zaandam area
  [16, 16, 'NH'],  // 16xx = Hoofddorp area
  [17, 17, 'NH'],  // 17xx = Heerhugowaard area
  [18, 18, 'NH'],  // 18xx = Alkmaar area
  [19, 19, 'NH'],  // 19xx = Hoorn/Den Helder area
  [20, 20, 'ZH'],  // 20xx = Den Haag
  [21, 21, 'ZH'],  // 21xx = Den Haag area
  [22, 22, 'ZH'],  // 22xx = Leiden area
  [23, 23, 'ZH'],  // 23xx = Katwijk area
  [24, 24, 'ZH'],  // 24xx = Alphen a/d Rijn area
  [25, 25, 'ZH'],  // 25xx = Gouda area
  [26, 26, 'ZH'],  // 26xx = Delft area
  [27, 27, 'ZH'],  // 27xx = Zoetermeer area
  [28, 28, 'ZH'],  // 28xx = Gouda area
  [29, 29, 'ZH'],  // 29xx = Rotterdam area
  [30, 30, 'ZH'],  // 30xx = Rotterdam
  [31, 31, 'ZH'],  // 31xx = Rotterdam/Schiedam area
  [32, 32, 'ZH'],  // 32xx = Vlaardingen/Spijkenisse
  [33, 33, 'ZH'],  // 33xx = Dordrecht
  [34, 34, 'UT'],  // 34xx = Utrecht
  [35, 35, 'UT'],  // 35xx = Utrecht area
  [36, 36, 'UT'],  // 36xx = Zeist area
  [37, 37, 'UT'],  // 37xx = Amersfoort area
  [38, 38, 'FL'],  // 38xx = Lelystad/Flevoland
  [39, 39, 'GE'],  // 39xx = Veluwe area
  [40, 40, 'GE'],  // 40xx = Arnhem area
  [41, 41, 'GE'],  // 41xx = Culemborg area
  [42, 42, 'GE'],  // 42xx = overig Gelderland
  [43, 43, 'OV'],  // 43xx = overig Gelderland
  [44, 44, 'GE'],  // 44xx = overig Gelderland
  [45, 45, 'GE'],  // 45xx = overig Gelderland
  [46, 46, 'NB'],  // 46xx = overig NB
  [47, 47, 'NB'],  // 47xx = overig NB
  [48, 48, 'NB'],  // 48xx = overig NB
  [49, 49, 'NB'],  // 49xx = overig NB
  [50, 50, 'NB'],  // 50xx = Tilburg/Eindhoven
  [51, 51, 'NB'],  // 51xx = Tilburg area
  [52, 52, 'NB'],  // 52xx = 's-Hertogenbosch
  [53, 53, 'NB'],  // 53xx = overig NB
  [54, 54, 'NB'],  // 54xx = overig NB
  [55, 55, 'NB'],  // 55xx = overig NB
  [56, 56, 'NB'],  // 56xx = Eindhoven area
  [57, 57, 'NB'],  // 57xx = overig NB
  [58, 58, 'NB'],  // 58xx = overig NB
  [59, 59, 'NB'],  // 59xx = Oss area
  [60, 60, 'LI'],  // 60xx = Limburg
  [61, 61, 'LI'],  // 61xx = Limburg
  [62, 62, 'LI'],  // 62xx = Maastricht area
  [63, 63, 'LI'],  // 63xx = Limburg
  [64, 64, 'LI'],  // 64xx = Limburg
  [65, 65, 'LI'],  // 65xx = Limburg
  [66, 66, 'GE'],  // 66xx = Arnhem area
  [67, 67, 'GE'],  // 67xx = Wageningen area
  [68, 68, 'GE'],  // 68xx = Doetinchem area
  [69, 69, 'GE'],  // 69xx = overig Gelderland
  [70, 70, 'GE'],  // 70xx = overig Gelderland
  [71, 71, 'GE'],  // 71xx = overig Gelderland
  [72, 72, 'OV'],  // 72xx = overig Overijssel
  [73, 73, 'OV'],  // 73xx = overig Overijssel
  [74, 74, 'OV'],  // 74xx = Deventer area
  [75, 75, 'OV'],  // 75xx = overig Overijssel
  [76, 76, 'OV'],  // 76xx = Almelo area
  [77, 77, 'OV'],  // 77xx = overig Overijssel
  [78, 78, 'OV'],  // 78xx = Zwolle area
  [79, 79, 'DR'],  // 79xx = Hoogeveen area
  [80, 80, 'OV'],  // 80xx = Zwolle
  [81, 81, 'OV'],  // 81xx = Kampen/Steenwijk area
  [82, 82, 'FL'],  // 82xx = Lelystad
  [83, 83, 'FL'],  // 83xx = Emmeloord area
  [84, 84, 'FR'],  // 84xx = overig Friesland
  [85, 85, 'FR'],  // 85xx = overig Friesland
  [86, 86, 'FR'],  // 86xx = overig Friesland
  [87, 87, 'FR'],  // 87xx = Sneek/Heerenveen area
  [88, 88, 'FR'],  // 88xx = Leeuwarden area
  [89, 89, 'FR'],  // 89xx = overig Friesland
  [90, 90, 'FR'],  // 90xx = Leeuwarden
  [91, 91, 'FR'],  // 91xx = Dokkum area
  [92, 92, 'GR'],  // 92xx = Groningen area
  [93, 93, 'DR'],  // 93xx = Assen area
  [94, 94, 'GR'],  // 94xx = overig Groningen
  [95, 95, 'GR'],  // 95xx = Groningen
  [96, 96, 'GR'],  // 96xx = Delfzijl/Appingedam
  [97, 97, 'GR'],  // 97xx = Groningen area
  [98, 98, 'DR'],  // 98xx = Emmen area
  [99, 99, 'DR']   // 99xx = overig Drenthe
];

// Province code to full name mapping
var PROVINCE_NAMES = {
  DR: 'Drenthe',
  FL: 'Flevoland',
  FR: 'Friesland',
  GE: 'Gelderland',
  GR: 'Groningen',
  LI: 'Limburg',
  NB: 'Noord-Brabant',
  NH: 'Noord-Holland',
  OV: 'Overijssel',
  UT: 'Utrecht',
  ZE: 'Zeeland',
  ZH: 'Zuid-Holland'
};

// Corrections for specific ranges that cross provinces
// 13xx is actually Flevoland (Almere)
POSTCODE_RANGES[3] = [13, 13, 'FL'];
// 43xx is Overijssel (Enschede area)
POSTCODE_RANGES[33] = [43, 43, 'OV'];

/**
 * Look up province from a Dutch postcode.
 *
 * @param {string} postcode — Dutch postcode (e.g. "1012AB", "1012 AB", "1012")
 * @returns {string|null} — province code (e.g. "NH") or null if not found/not NL
 */
function lookup(postcode) {
  if (!postcode) return null;

  var cleaned = postcode.toString().replace(/\s+/g, '').toUpperCase();
  var digits = cleaned.replace(/[^0-9]/g, '');

  if (digits.length < 2) return null;

  var prefix = parseInt(digits.substring(0, 2), 10);
  if (prefix < 10 || prefix > 99) return null;

  for (var i = 0; i < POSTCODE_RANGES.length; i++) {
    if (prefix >= POSTCODE_RANGES[i][0] && prefix <= POSTCODE_RANGES[i][1]) {
      return POSTCODE_RANGES[i][2];
    }
  }

  return null;
}

/**
 * Get full province name from code.
 */
function provinceName(code) {
  return PROVINCE_NAMES[code] || null;
}

/**
 * Look up province and return both code and name.
 */
function lookupFull(postcode) {
  var code = lookup(postcode);
  if (!code) return null;
  return { code: code, name: PROVINCE_NAMES[code] || code };
}

module.exports = {
  lookup: lookup,
  provinceName: provinceName,
  lookupFull: lookupFull,
  PROVINCE_NAMES: PROVINCE_NAMES
};
