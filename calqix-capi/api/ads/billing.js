var { apiGet, authDiagnostics, AD_ACCOUNT_ID } = require('../../lib/meta-ads');

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!authDiagnostics(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Get account-level billing info
  var accountResult = await apiGet(AD_ACCOUNT_ID, {
    fields: 'name,account_status,spend_cap,amount_spent,balance,currency,funding_source_details'
  });

  if (!accountResult.ok) {
    return res.status(200).json({ ok: false, error: accountResult.error });
  }

  var account = accountResult.data;

  // amount_spent is in cents, lifetime total
  var amountSpent = account.amount_spent ? parseInt(account.amount_spent, 10) / 100 : null;
  var spendCap = account.spend_cap ? parseInt(account.spend_cap, 10) / 100 : null;
  var balance = account.balance ? parseInt(account.balance, 10) / 100 : null;

  // Calculate billing threshold usage
  var thresholdPct = null;
  if (spendCap && amountSpent) {
    thresholdPct = (amountSpent / spendCap * 100);
  }

  return res.status(200).json({
    ok: true,
    account_name: account.name,
    currency: account.currency,
    amount_spent_total: amountSpent,
    spend_cap: spendCap,
    balance: balance,
    threshold_pct: thresholdPct ? thresholdPct.toFixed(1) + '%' : 'N/A',
    funding_source: account.funding_source_details || null
  });
}

module.exports = handler;
