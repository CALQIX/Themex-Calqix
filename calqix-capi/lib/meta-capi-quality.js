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
  'https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events/',
  'https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/custom-data/'
];

var FUNNEL = ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase'];

var EVENT_PROFILES = {
  ViewContent: {
    prefix: /^vc_/,
    minFbp: 80,
    minFbc: 20,
    requiredCustom: ['content_ids', 'content_type'],
    preferredCustom: ['contents'],
    identityFloor: 1
  },
  AddToCart: {
    prefix: /^atc_/,
    minFbp: 80,
    minFbc: 20,
    requiredCustom: ['content_ids', 'content_type'],
    preferredCustom: ['contents', 'value', 'currency', 'num_items'],
    identityFloor: 2
  },
  InitiateCheckout: {
    prefix: /^ic_/,
    minFbp: 80,
    minFbc: 20,
    requiredCustom: ['content_ids', 'content_type', 'value', 'currency'],
    preferredCustom: ['contents', 'num_items'],
    identityFloor: 3
  },
  AddPaymentInfo: {
    prefix: /^add_payment_info_/,
    minFbp: 80,
    minFbc: 20,
    requiredCustom: ['content_ids', 'content_type', 'value', 'currency'],
    preferredCustom: ['contents', 'num_items'],
    identityFloor: 3
  },
  Purchase: {
    prefix: /^purchase_/,
    minFbp: 80,
    minFbc: 20,
    requiredCustom: ['content_ids', 'content_type', 'value', 'currency', 'order_id'],
    preferredCustom: ['contents', 'num_items'],
    identityFloor: 4
  }
};

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
  var payloadAudit = events.payload_quality || {};
  var sourceAudit = events.source_counts || {};
  var resubmit = context.resubmit || {};
  var salesRisk = context.salesRisk || {};
  var scheduleAudit = context.scheduleAudit || {};
  var recommendations = [];

  FUNNEL.forEach(function (eventName) {
    var row = coverage[eventName] || {};
    var total = Number(row.total) || 0;
    var profile = EVENT_PROFILES[eventName] || {};
    if (!total) return;

    var fbp = pct(row, 'fbp');
    var fbc = pct(row, 'fbc');
    var ip = pct(row, 'client_ip_address');
    var ua = pct(row, 'client_user_agent');
    var externalId = pct(row, 'external_id');
    var email = pct(row, 'em');
    var phone = pct(row, 'ph');

    if (fbp !== null && fbp < (profile.minFbp || 80)) {
      recommendations.push(issue(
        fbp < 50 && total >= 5 ? 'P1' : 'P2',
        'meta_fbp_coverage',
        eventName + ' _fbp onder Meta norm',
        '_fbp uit browser bridge/custom pixel bewaren en in CAPI user_data doorgeven.',
        '_fbp ' + fbp + '% over ' + total + ' events',
        DOCS[2]
      ));
    }

    if (fbc !== null && fbc < (profile.minFbc || 20) && total >= 5) {
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

    var identityFields = countIdentitySignals(row);
    if (identityFields < (profile.identityFloor || 1) && total >= 5) {
      recommendations.push(issue(
        eventName === 'Purchase' || eventName === 'InitiateCheckout' ? 'P1' : 'P2',
        'meta_identity_depth',
        eventName + ' heeft te weinig match identifiers',
        'Combineer fbp/fbc met IP/UA en waar beschikbaar hashed email, phone, external_id, naam en adresvelden.',
        identityFields + ' sterke identifiergroepen over ' + total + ' events',
        DOCS[1]
      ));
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

  addSourceCoverageRecommendations(recommendations, sourceAudit, coverage);
  addPayloadRecommendations(recommendations, payloadAudit);
  addFunnelContinuityRecommendations(recommendations, coverage, sourceAudit, salesRisk);
  addScheduleRecommendations(recommendations, scheduleAudit);

  return summarize(recommendations, coverage, payloadAudit, sourceAudit, scheduleAudit);
}

function summarize(recommendations, coverage, payloadAudit, sourceAudit, scheduleAudit) {
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
    meta_standard_version: '2026-05-12',
    coverage_targets: buildCoverageTargets(),
    funnel_events_seen: FUNNEL.filter(function (eventName) {
      return Number(coverage[eventName] && coverage[eventName].total) > 0;
    }),
    source_counts: sourceAudit || {},
    payload_quality: payloadAudit || {},
    schedule_health: scheduleAudit || {},
    recommendations: dedupe(recommendations).slice(0, 10),
    meta_docs: DOCS
  };
}

function countIdentitySignals(row) {
  var groups = 0;
  if (Number(row.fbp) > 0) groups++;
  if (Number(row.fbc) > 0) groups++;
  if (Number(row.client_ip_address) > 0 && Number(row.client_user_agent) > 0) groups++;
  if (Number(row.external_id) > 0) groups++;
  if (Number(row.em) > 0 || Number(row.ph) > 0) groups++;
  if (Number(row.fn) > 0 || Number(row.ln) > 0 || Number(row.ct) > 0 || Number(row.st) > 0 || Number(row.zp) > 0 || Number(row.country) > 0) groups++;
  return groups;
}

function buildCoverageTargets() {
  var out = {};
  FUNNEL.forEach(function (eventName) {
    var profile = EVENT_PROFILES[eventName] || {};
    out[eventName] = {
      fbp_min_pct: profile.minFbp || 80,
      fbc_min_pct: profile.minFbc || 20,
      required_custom_data: profile.requiredCustom || [],
      preferred_custom_data: profile.preferredCustom || [],
      event_id_prefix: String(profile.prefix || ''),
      min_identifier_groups: profile.identityFloor || 1
    };
  });
  return out;
}

function addSourceCoverageRecommendations(recommendations, sourceAudit, coverage) {
  FUNNEL.forEach(function (eventName) {
    var sources = (sourceAudit && sourceAudit[eventName]) || {};
    var total = Number(sources.total) || 0;
    if (!total) return;

    if ((sources.server || 0) === 0 && (eventName === 'InitiateCheckout' || eventName === 'Purchase')) {
      recommendations.push(issue(
        'P1',
        'meta_server_source_missing',
        eventName + ' mist server/webhook bron',
        'Shopify webhook of server-side CAPI route moet naast browser pixel blijven bevestigen.',
        'server 0 van ' + total + ' lifecycle events',
        DOCS[0]
      ));
    }

    if ((sources.browser || 0) === 0 && (eventName === 'ViewContent' || eventName === 'AddToCart')) {
      recommendations.push(issue(
        'P1',
        'meta_browser_source_missing',
        eventName + ' mist browser bridge bron',
        'Custom Pixel/browser bridge moet fbp/fbc en gedeelde event_id blijven leveren voor dedup en click matching.',
        'browser 0 van ' + total + ' lifecycle events',
        DOCS[3]
      ));
    }
  });
}

function addPayloadRecommendations(recommendations, payloadAudit) {
  FUNNEL.forEach(function (eventName) {
    var profile = EVENT_PROFILES[eventName] || {};
    var row = (payloadAudit && payloadAudit[eventName]) || {};
    var total = Number(row.total) || 0;
    if (!total) return;

    if ((row.source_url_missing || 0) > 0) {
      recommendations.push(issue(
        eventName === 'Purchase' ? 'P1' : 'P2',
        'meta_event_source_url',
        eventName + ' mist event_source_url in payload audit',
        'Voor website action_source altijd de echte pagina/checkout URL meesturen.',
        row.source_url_missing + '/' + total + ' payloads zonder source_url',
        DOCS[0]
      ));
    }

    (profile.requiredCustom || []).forEach(function (field) {
      var present = Number(row[field]) || 0;
      if (present < total) {
        recommendations.push(issue(
          field === 'order_id' || eventName === 'Purchase' ? 'P1' : 'P2',
          'meta_custom_data_' + field,
          eventName + ' custom_data.' + field + ' niet compleet',
          'Vul Meta custom_data volgens eventtype zodat catalogus, value optimization en dedup traceerbaar blijven.',
          field + ' ' + pctValue(present, total) + '% over ' + total + ' payloads',
          DOCS[4]
        ));
      }
    });

    (profile.preferredCustom || []).forEach(function (field) {
      var present = Number(row[field]) || 0;
      if (total >= 5 && pctValue(present, total) < 80) {
        recommendations.push(issue(
          'P2',
          'meta_preferred_custom_data_' + field,
          eventName + ' custom_data.' + field + ' laag',
          'Maak de product/value payload rijker voor Meta optimalisatie en catalog matching.',
          field + ' ' + pctValue(present, total) + '% over ' + total + ' payloads',
          DOCS[4]
        ));
      }
    });
  });
}

function addFunnelContinuityRecommendations(recommendations, coverage, sourceAudit, salesRisk) {
  var vc = eventTotal('ViewContent', coverage, sourceAudit);
  var atc = eventTotal('AddToCart', coverage, sourceAudit);
  var ic = eventTotal('InitiateCheckout', coverage, sourceAudit);
  var api = eventTotal('AddPaymentInfo', coverage, sourceAudit);
  var purchase = eventTotal('Purchase', coverage, sourceAudit);

  if (atc >= 5 && ic === 0) {
    recommendations.push(issue(
      'P1',
      'meta_funnel_gap_initiate_checkout',
      'InitiateCheckout ontbreekt terwijl AddToCart loopt',
      'Controleer Shopify Custom Pixel checkout_started en checkouts-create webhook dedup met event_id ic_{checkout_token}.',
      'AddToCart ' + atc + ', InitiateCheckout 0',
      DOCS[3]
    ));
  }
  if (ic >= 3 && api === 0) {
    recommendations.push(issue(
      'P2',
      'meta_funnel_gap_add_payment_info',
      'AddPaymentInfo wordt niet gemeten',
      'Sluit payment_info_submitted aan op dezelfde checkout_token en verrijk met contact_info_submitted.',
      'InitiateCheckout ' + ic + ', AddPaymentInfo 0',
      DOCS[0]
    ));
  }
  if ((salesRisk && salesRisk.status === 'warn') && vc >= 5 && purchase === 0) {
    recommendations.push(issue(
      'P1',
      'meta_sales_gap_purchase',
      'Geen Purchase events bij actieve bovenfunnel',
      'Audit Shopify orders-paid webhook, checkout_completed Custom Pixel en platform-sales reconciliation voordat budget wordt opgeschaald.',
      'upstream ' + (salesRisk.upstream_events || (vc + atc + ic + api)) + ', Purchase 0',
      DOCS[0]
    ));
  }
}

function addScheduleRecommendations(recommendations, scheduleAudit) {
  if (!scheduleAudit || scheduleAudit.available === false) return;
  if (scheduleAudit.tracking_hub_15m !== true) {
    recommendations.push(issue(
      'P1',
      'meta_tracking_hub_schedule',
      'Tracking Hub kwartiercheck schedule niet bevestigd',
      'QStash schedule calqix-tracking-hub moet elke 15 minuten POST /api/cron/tracking-hub draaien.',
      scheduleAudit.reason || 'schedule not confirmed',
      DOCS[0]
    ));
  }
  if (scheduleAudit.recovery_1m !== true) {
    recommendations.push(issue(
      'P1',
      'meta_recovery_schedule',
      'Recovery schedule niet bevestigd',
      'Recovery mag alleen retry_pending events opnieuw verwerken en hoort elke minuut te draaien.',
      scheduleAudit.recovery_reason || 'recovery schedule not confirmed',
      DOCS[0]
    ));
  }
}

function eventTotal(eventName, coverage, sourceAudit) {
  var fromCoverage = Number(coverage[eventName] && coverage[eventName].total) || 0;
  var fromSource = Number(sourceAudit && sourceAudit[eventName] && sourceAudit[eventName].total) || 0;
  return Math.max(fromCoverage, fromSource);
}

function pctValue(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((Number(numerator || 0) / Number(denominator)) * 100);
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
