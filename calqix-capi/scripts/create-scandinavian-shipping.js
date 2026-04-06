/**
 * Create Scandinavian shipping zones in Shopify General profile.
 *
 * Zones created:
 *   SE (Sweden)  — PostNord  €6.95 / Free ≥€80
 *   DK (Denmark) — PostNord  €6.95 / Free ≥€80
 *   FI (Finland) — Posti     €6.95 / Free ≥€80
 *   NO (Norway)  — PostNord  €8.95 / Free ≥€80  (non-EU)
 *   IS (Iceland) — DHL Express €9.95 / Free ≥€80 (remote)
 *
 * Run: node scripts/create-scandinavian-shipping.js
 */
require('dotenv').config();
var shopify = require('../lib/shopify-admin');

var PROFILE_ID = 'gid://shopify/DeliveryProfile/134730645833';
var LOCATION_GROUP_ID = 'gid://shopify/DeliveryLocationGroup/136872952137';

var ZONES = [
  { name: 'Sweden',  code: 'SE', carrier: 'PostNord',    paid: '6.95' },
  { name: 'Denmark', code: 'DK', carrier: 'PostNord',    paid: '6.95' },
  { name: 'Finland', code: 'FI', carrier: 'Posti',       paid: '6.95' },
  { name: 'Norway',  code: 'NO', carrier: 'PostNord',    paid: '8.95' },
  { name: 'Iceland', code: 'IS', carrier: 'DHL Express', paid: '9.95' }
];

function buildZone(z) {
  return {
    name: z.name,
    countries: [{ code: z.code }],
    methodDefinitionsToCreate: [
      {
        name: z.carrier,
        active: true,
        rateDefinition: {
          price: { amount: z.paid, currencyCode: 'EUR' }
        },
        priceConditionsToCreate: [
          { criteria: { amount: '0.00', currencyCode: 'EUR' }, operator: 'GREATER_THAN_OR_EQUAL_TO' },
          { criteria: { amount: '79.99', currencyCode: 'EUR' }, operator: 'LESS_THAN_OR_EQUAL_TO' }
        ]
      },
      {
        name: z.carrier,
        active: true,
        rateDefinition: {
          price: { amount: '0.00', currencyCode: 'EUR' }
        },
        priceConditionsToCreate: [
          { criteria: { amount: '80.00', currencyCode: 'EUR' }, operator: 'GREATER_THAN_OR_EQUAL_TO' }
        ]
      }
    ]
  };
}

var MUTATION = [
  'mutation deliveryProfileUpdate($id: ID!, $profile: DeliveryProfileInput!) {',
  '  deliveryProfileUpdate(id: $id, profile: $profile) {',
  '    profile {',
  '      id',
  '      profileLocationGroups {',
  '        locationGroupZones(first: 30) {',
  '          edges { node { zone { id name countries { code { countryCode } } } } }',
  '        }',
  '      }',
  '    }',
  '    userErrors { field message }',
  '  }',
  '}'
].join('\n');

async function main() {
  console.log('Creating Scandinavian shipping zones...\n');

  var zonesToCreate = ZONES.map(buildZone);

  var variables = {
    id: PROFILE_ID,
    profile: {
      locationGroupsToUpdate: [{
        id: LOCATION_GROUP_ID,
        zonesToCreate: zonesToCreate
      }]
    }
  };

  try {
    var result = await shopify.graphql(MUTATION, variables);

    if (result.deliveryProfileUpdate.userErrors && result.deliveryProfileUpdate.userErrors.length > 0) {
      console.error('UserErrors:');
      result.deliveryProfileUpdate.userErrors.forEach(function(e) {
        console.error('  -', e.field, ':', e.message);
      });
      process.exit(1);
    }

    console.log('SUCCESS — Zones created:\n');
    var zones = result.deliveryProfileUpdate.profile.profileLocationGroups[0].locationGroupZones.edges;
    zones.forEach(function(z) {
      var zone = z.node.zone;
      var codes = zone.countries.map(function(c) { return c.code.countryCode; }).join(',');
      console.log('  ' + zone.name + ' (' + codes + ') — ' + zone.id);
    });
    console.log('\nTotal zones:', zones.length);
  } catch (err) {
    console.error('FATAL:', err.message);
    process.exit(1);
  }
}

main();
