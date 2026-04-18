/**
 * Predis.ai Webhook Callback
 *
 * Receives POST from Predis when content generation completes or fails.
 * Webhook payload (completed):
 *   { status: "completed", caption: "...", post_id: "...", generated_media: [{url: "..."}], brand_id: "..." }
 * Webhook payload (error):
 *   { status: "error", post_id: "..." }
 *
 * On completion: stores result + auto-triggers Claude review + Telegram preview.
 */
var store = require('../../lib/store');
var jobStore = require('../../lib/predis-job-store');
var telegramReview = require('../../lib/telegram-content-review');
var dates = require('../../lib/dates');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Optional HMAC verification (set PREDIS_WEBHOOK_SECRET in env to enable)
  var secret = process.env.PREDIS_WEBHOOK_SECRET;
  if (secret) {
    var providedSecret = (req.query && req.query.secret) ||
      (req.headers && req.headers['x-webhook-secret']);
    if (providedSecret !== secret) {
      console.warn('[PredisCallback] Invalid webhook secret');
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }
  }

  try {
    var body = req.body;
    if (!body || !body.post_id) {
      console.warn('[PredisCallback] Missing post_id in payload');
      return res.status(200).json({ ok: false, error: 'Missing post_id' });
    }

    var postId = body.post_id;
    var status = body.status || 'unknown';
    var imageUrl = null;
    if (body.generated_media && body.generated_media.length > 0) {
      imageUrl = body.generated_media[0].url || null;
    }
    var predisLink = 'https://app.predis.ai/post-details/' + postId;

    console.log('[PredisCallback] Received:', { postId: postId, status: status, hasImage: !!imageUrl });

    // Store webhook result in Redis (TTL 7 days)
    var result = {
      postId: postId,
      status: status,
      caption: body.caption || null,
      image_url: imageUrl,
      predis_link: predisLink,
      generatedMedia: body.generated_media || [],
      brandId: body.brand_id || null,
      receivedAt: new Date().toISOString()
    };

    await store.set('predis:webhook:' + postId, JSON.stringify(result), 7 * 86400);

    // Update job store if we have a record for this post
    var jobData = null;
    try {
      jobData = await jobStore.getJob(postId);
      if (jobData) {
        if (status === 'completed') {
          await jobStore.recordCompletion(postId, {
            caption: body.caption,
            image_url: imageUrl,
            predis_link: predisLink,
            media: body.generated_media,
            completedAt: new Date().toISOString()
          });
        } else if (status === 'error') {
          await jobStore.recordFailure(postId, 'Predis generation failed');
        }
        console.log('[PredisCallback] Job store updated for', postId);
      } else {
        console.log('[PredisCallback] No job record found for', postId);
      }
    } catch (jobErr) {
      console.warn('[PredisCallback] Job store update error:', jobErr.message);
    }

    // Auto-trigger Claude review + Telegram preview for completed jobs
    if (status === 'completed' && jobData) {
      try {
        var creative = {
          post_id: postId,
          image_url: imageUrl,
          predis_link: predisLink,
          caption: body.caption || '',
          product: jobData.brief ? jobData.brief.product : 'unknown',
          angle: jobData.brief ? jobData.brief.angle : 'unknown',
          slot: jobData.slot || 'unknown'
        };
        await telegramReview.reviewAndPreview(creative);
        console.log('[PredisCallback] Auto-review triggered for', postId);
      } catch (reviewErr) {
        console.warn('[PredisCallback] Auto-review failed:', reviewErr.message);
      }
    }

    return res.status(200).json({ ok: true, postId: postId, status: status, imageUrl: imageUrl });
  } catch (err) {
    console.error('[PredisCallback] Error:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
