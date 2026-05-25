var crypto = require('crypto');
var fetch = require('node-fetch');
var store = require('./store');

var DOCS = [
  {
    slug: 'meta_about_capi',
    url: 'https://www.facebook.com/business/help/AboutConversionsAPI',
    anchors: ['conversions api', 'server', 'pixel', 'events']
  },
  {
    slug: 'meta_server_event_parameters',
    url: 'https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event/',
    anchors: ['event_time', 'event_id', 'action_source', 'user_data']
  },
  {
    slug: 'meta_customer_information_parameters',
    url: 'https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters/',
    anchors: ['em', 'ph', 'external_id', 'client_ip_address', 'client_user_agent', 'fbp', 'fbc']
  },
  {
    slug: 'meta_fbp_fbc',
    url: 'https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc/',
    anchors: ['fbp', 'fbc', 'fbclid']
  },
  {
    slug: 'meta_deduplication',
    url: 'https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events/',
    anchors: ['deduplication', 'event_id', 'event_name', 'browser', 'server']
  },
  {
    slug: 'shopify_web_pixel_standard_events',
    url: 'https://shopify.dev/docs/api/web-pixels-api/standard-events',
    anchors: ['analytics.subscribe', 'checkout_started', 'payment_info_submitted', 'checkout_completed']
  },
  {
    slug: 'upstash_qstash_schedules',
    url: 'https://upstash.com/docs/qstash/features/schedules',
    anchors: ['qstash', 'schedules', 'cron']
  },
  {
    slug: 'vercel_cron_jobs',
    url: 'https://vercel.com/docs/cron-jobs/manage-cron-jobs',
    anchors: ['cron jobs', 'vercel.json', 'path', 'schedule']
  }
];

var TTL_DOC = 90 * 86400;
var TTL_RUN = 30 * 86400;

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function docKey(slug) {
  return 'tracking_standard:doc:' + slug;
}

function normalizeText(text) {
  return String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[a-f0-9]{32,}\b/gi, ' ')
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, ' ')
    .replace(/\b\d{10,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/Last updated[^<\n\r]{0,80}/ig, '')
    .toLowerCase()
    .trim();
}

function isDynamicOfficialDoc(url) {
  return /(^|\.)facebook\.com$/i.test(hostname(url)) || /(^|\.)developers\.facebook\.com$/i.test(hostname(url));
}

function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

function hasStableValidator(snapshot) {
  return Boolean(snapshot && (snapshot.etag || snapshot.last_modified));
}

function anchorSnapshot(doc, normalized) {
  var anchors = doc.anchors || [];
  var matched = [];
  var missing = [];
  anchors.forEach(function (anchor) {
    var needle = String(anchor || '').toLowerCase();
    if (!needle) return;
    if (normalized.indexOf(needle) !== -1) matched.push(anchor);
    else missing.push(anchor);
  });
  return {
    expected: anchors.length,
    matched: matched.length,
    ratio: anchors.length ? matched.length / anchors.length : null,
    missing: missing,
    matched_anchors: matched
  };
}

function stableComparisonMode(doc, current, previous) {
  if (hasStableValidator(current) || hasStableValidator(previous)) return 'http_validator';
  if (isDynamicOfficialDoc(doc.url)) return 'http_status_dynamic_official_doc';
  return 'semantic_anchors_static_doc';
}

function buildStableHash(doc, current) {
  var mode = current.comparison_mode;
  var basis = {
    slug: doc.slug,
    url: doc.url,
    status: current.status,
    mode: mode
  };
  if (mode === 'http_validator') {
    basis.etag = current.etag || null;
    basis.last_modified = current.last_modified || null;
  }
  if (mode === 'semantic_anchors_static_doc') {
    basis.anchors = current.anchors;
  }
  if (mode === 'normalized_body_hash') {
    basis.content_sha256 = current.sha256;
  }
  return sha256(JSON.stringify(basis));
}

function compareSnapshots(doc, previous, current) {
  if (!previous) return null;

  if (previous.status !== current.status) {
    return {
      slug: doc.slug,
      url: doc.url,
      previous_status: previous.status,
      current_status: current.status,
      reason: 'http_status_changed',
      status: 'review_required'
    };
  }

  if (hasStableValidator(previous) || hasStableValidator(current)) {
    if ((previous.etag || null) !== (current.etag || null) || (previous.last_modified || null) !== (current.last_modified || null)) {
      return {
        slug: doc.slug,
        url: doc.url,
        previous_etag: previous.etag || null,
        current_etag: current.etag || null,
        previous_last_modified: previous.last_modified || null,
        current_last_modified: current.last_modified || null,
        reason: 'http_validator_changed',
        status: 'review_required'
      };
    }
  }

  if ((current.comparison_mode === 'http_status_dynamic_official_doc' || current.comparison_mode === 'semantic_anchors_static_doc') && previous.comparison_mode !== current.comparison_mode) {
    return {
      slug: doc.slug,
      url: doc.url,
      reason: 'baseline_upgraded_to_' + current.comparison_mode,
      status: 'baseline_upgrade'
    };
  }

  if (previous.stable_sha256 && previous.stable_sha256 !== current.stable_sha256) {
    return {
      slug: doc.slug,
      url: doc.url,
      previous_stable_sha256: previous.stable_sha256,
      current_stable_sha256: current.stable_sha256,
      previous_sha256: previous.sha256 || null,
      current_sha256: current.sha256,
      previous_fetched_at: previous.fetched_at || null,
      current_fetched_at: current.fetched_at,
      comparison_mode: current.comparison_mode,
      reason: current.comparison_mode === 'semantic_anchors_static_doc' ? 'semantic_anchor_changed' : 'content_changed',
      status: 'review_required'
    };
  }

  if (!previous.stable_sha256 && !isDynamicOfficialDoc(doc.url) && previous.sha256 && previous.sha256 !== current.sha256) {
    return {
      slug: doc.slug,
      url: doc.url,
      previous_sha256: previous.sha256,
      current_sha256: current.sha256,
      previous_fetched_at: previous.fetched_at || null,
      current_fetched_at: current.fetched_at,
      comparison_mode: current.comparison_mode,
      reason: 'legacy_content_hash_changed',
      status: 'review_required'
    };
  }

  return null;
}

async function fetchDoc(doc) {
  var started = Date.now();
  var response = await fetch(doc.url, {
    method: 'GET',
    headers: {
      'User-Agent': 'CALQIX-Tracking-Standards-Watch/2.1',
      'Accept': 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8'
    },
    timeout: 15000
  });
  var text = await response.text();
  var normalized = normalizeText(text);
  var current = {
    slug: doc.slug,
    url: doc.url,
    status: response.status,
    ok: response.ok,
    etag: response.headers.get('etag') || null,
    last_modified: response.headers.get('last-modified') || null,
    sha256: sha256(normalized),
    bytes: text.length,
    fetched_at: new Date().toISOString(),
    fetch_ms: Date.now() - started,
    anchors: anchorSnapshot(doc, normalized)
  };
  current.comparison_mode = stableComparisonMode(doc, current, null);
  current.stable_sha256 = buildStableHash(doc, current);
  return current;
}

async function run(options) {
  options = options || {};
  var diffs = [];
  var docs = [];
  for (var i = 0; i < DOCS.length; i++) {
    var doc = DOCS[i];
    try {
      var current = await fetchDoc(doc);
      docs.push(current);
      if (!current.ok) {
        diffs.push({
          slug: doc.slug,
          url: doc.url,
          status: 'fetch_failed',
          http_status: current.status
        });
        continue;
      }
      var previous = store.parseJsonValue(await store.get(docKey(doc.slug)), null);
      current.comparison_mode = stableComparisonMode(doc, current, previous);
      current.stable_sha256 = buildStableHash(doc, current);
      var comparison = compareSnapshots(doc, previous, current);
      if (comparison) {
        diffs.push(comparison);
      }
      if (!options.dryRun) {
        await store.set(docKey(doc.slug), JSON.stringify(current), TTL_DOC);
      }
    } catch (err) {
      diffs.push({
        slug: doc.slug,
        url: doc.url,
        status: 'fetch_failed',
        error: err.message
      });
    }
  }

  var result = {
    ok: diffs.filter(function (d) { return d.status === 'fetch_failed'; }).length === 0,
    review_required: diffs.some(function (d) { return d.status === 'review_required'; }),
    dry_run: Boolean(options.dryRun),
    fetched_at: new Date().toISOString(),
    docs_checked: DOCS.length,
    docs: docs,
    tracking_standard_diff: diffs,
    baseline_upgrades: diffs.filter(function (d) { return d.status === 'baseline_upgrade'; }).length
  };

  if (!options.dryRun) {
    await store.set('tracking_standard:last_run', JSON.stringify(result), TTL_RUN);
    if (result.review_required) {
      await store.set('tracking_standard:status', JSON.stringify({
        status: 'review_required',
        updated_at: result.fetched_at,
        diffs: diffs.filter(function (d) { return d.status === 'review_required'; })
      }), TTL_RUN);
    }
  }

  return result;
}

module.exports = {
  DOCS: DOCS,
  run: run,
  normalizeText: normalizeText
};
