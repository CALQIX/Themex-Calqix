/**
 * Meta CAPI Quality Baseline
 *
 * Converts Meta's current CAPI implementation standards into deterministic
 * checks that the 15-minute Tracking Hub can enforce without inventing events.
 */

var DOCS = [
  'https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event/',
  'https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters/',
  'https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc/',
  'https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events/'
];

var FUNNEL = ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase'];

function pct(row, field) {
  var total = Number(row && row.total) || 0;
  if (!total) return null;
  return Math.round(((Number(row[field]) || 0) / total) * 100);
}

function issue(priority, code, title, action, metric, doc) {
  return {
    priority: priority,
    code: code,
    title: title,
    action: action,
    metric: metric,
    meta_doc: doc || DOCS[0]
  };
}

function evaluate(context) {
  context = context || {};
  var coverage = context.coverageRaw || {};
  var events = context.events || {};
  var resubmit = context.resubmit || {};
  var salesRisk = context.salesRisk || {};
  var recommendations = [];

  FUNNEL.forEach(function (eventName) {
    var row = coverage[eventName] || {};
    var total = Number(row.total) || 0;
    if (!total) return;

    var fbp = pct(row, 'fbp');
    var fbc = pct(row, 'fbc');
    var ip = pct(row, 'client_ip_address');
    var ua = pct(row, 'client_user_agent');
    var externalId = pct(row, 'external_id');
    var email = pct(row, 'em');
    var phone = pct(row, 'ph');

    if (fbp !== null && fbp < 80) {
      recommendations.push(issue(
        fbp < 50 && total >= 5 ? 'P1' : 'P2',
        'meta_fbp_coverage',
        eventName + ' _fbp onder Meta norm',
        '_fbp uit browser bridge/custom pixel bewaren en in CAPI user_data doorgeven.',
        '_fbp ' + fbp + '% over ' + total + ' events',
        DOCS[2]
      ));
    }

    if (fbc !== null && fbc < 20 && total >= 5) {
      var commercialRisk = salesRisk.status === 'warn' &&
        (eventName === 'ViewContent' || eventName === 'AddToCart');
      var checkoutRisk = eventName === 'InitiateCheckout' || eventName === 'AddPaymentInfo' || eventName === 'Purchase';
      recommendations.push(issue(
        fbc === 0 && (commercialRisk || checkoutRisk) ? 'P1' : 'P2',
        'meta_fbc_coverage',
        eventName + ' _fbc/click-id onder Meta norm',
        'fbclid vanaf landing persistenter opslaan als _fbc en bij elke funnelstap meesturen.',
        '_fbc ' + fbc + '% over ' + total + ' events',
        DOCS[2]
      ));
    }

    if (ip !== null && ip < 80) {
      recommendations.push(issue(
        ip < 50 && total >= 5 ? 'P1' : 'P2',
        'meta_ip_coverage',
        eventName + ' mist client_ip_address',
        'IP uit request headers doorgeven aan formatUserData; geen raw IP loggen.',
        'IP ' + ip + '% over ' + total + ' events',
        DOCS[1]
      ));
    }

    if (ua !== null && ua < 80) {
      recommendations.push(issue(
        ua < 50 && total >= 5 ? 'P1' : 'P2',
        'meta_ua_coverage',
        eventName + ' mist client_user_agent',
        'User-Agent uit request headers of Custom Pixel payload doorgeven.',
        'UA ' + ua + '% over ' + total + ' events',
        DOCS[1]
      ));
    }

    if ((eventName === 'Purchase' || eventName === 'InitiateCheckout') && total > 0) {
      if (externalId !== null && externalId < 80) {
        recommendations.push(issue(
          externalId < 50 ? 'P1' : 'P2',
          'meta_external_id_coverage',
          eventName + ' external_id te laag',
          'Shopify customer/order/checkout identifiers deterministisch hashen en meesturen.',
          'external_id ' + externalId + '%',
          DOCS[1]
        ));
      }
      if (email !== null && email < 80 && phone !== null && phone < 40) {
        recommendations.push(issue(
          eventName === 'Purchase' ? 'P1' : 'P2',
          'meta_contact_identity_coverage',
          eventName + ' contact identifiers te laag',
          'Checkout contact_info_submitted enrichment en identity-resubmit blijven verwerken tot em/ph of external_id toereikend is.',
          'email ' + email + '%, phone ' + phone + '%',
          DOCS[1]
        ));
      }
    }
  });

  var idQuality = events.event_id_quality || {};
  if ((idQuality.invalid || 0) > 0 || (idQuality.missing || 0) > 0) {
    recommendations.push(issue(
      'P0',
      'meta_dedup_event_id',
      'Event deduplicatie niet Meta-proof',
      'Browser Pixel eventID en CAPI event_id moeten exact gelijk zijn per event_name; herstel shared event_id format.',
      'invalid ' + (idQuality.invalid || 0) + ', missing ' + (idQuality.missing || 0),
      DOCS[3]
    ));
  }

  if ((events.failed_terminal || 0) > 0 || (resubmit.meta_failures || 0) > 0) {
    recommendations.push(issue(
      'P0',
      'meta_delivery_failure',
      'Meta CAPI delivery faalt',
      'Recovery queue en backfill failures eerst oplossen; alleen retry_pending events opnieuw verzenden.',
      'failed ' + (events.failed_terminal || 0) + ', resubmit failures ' + (resubmit.meta_failures || 0),
      DOCS[0]
    ));
  }

  if ((events.retry_pending || 0) > 0) {
    recommendations.push(issue(
      'P1',
      'meta_retry_pending',
      'Meta recovery queue loopt achter',
      'Recovery job laten drainen en next_retry_at controleren; geen nieuwe duplicate events maken.',
      'retry_pending ' + events.retry_pending,
      DOCS[0]
    ));
  }

  return summarize(recommendations, coverage);
}

function summarize(recommendations, coverage) {
  var score = 100;
  recommendations.forEach(function (rec) {
    if (rec.priority === 'P0') score -= 35;
    else if (rec.priority === 'P1') score -= 18;
    else if (rec.priority === 'P2') score -= 7;
  });
  score = Math.max(0, score);
  var highest = highestPriority(recommendations);

  return {
    status: highest === 'OK' ? 'ok' : 'warn',
    score: score,
    highest_priority: highest,
    funnel_events_seen: FUNNEL.filter(function (eventName) {
      return Number(coverage[eventName] && coverage[eventName].total) > 0;
    }),
    recommendations: dedupe(recommendations).slice(0, 10),
    meta_docs: DOCS
  };
}

function highestPriority(items) {
  var max = 'OK';
  (items || []).forEach(function (item) {
    if (rank(item.priority) > rank(max)) max = item.priority;
  });
  return max;
}

function rank(priority) {
  if (priority === 'P0') return 3;
  if (priority === 'P1') return 2;
  if (priority === 'P2') return 1;
  return 0;
}

function dedupe(items) {
  var seen = {};
  return (items || []).filter(function (item) {
    var key = [item.priority, item.code, item.title, item.metric].join('|');
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

module.exports = {
  evaluate: evaluate,
  docs: DOCS
};
