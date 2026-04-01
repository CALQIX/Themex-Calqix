var fetch = require('node-fetch');
var FormData = require('form-data');
var dotenv = require('dotenv');

dotenv.config();

var PREDIS_API_BASE = 'https://brain.predis.ai/predis_api/v1';

async function createPost(options) {
  var apiKey = process.env.PREDIS_API_KEY;
  var brandId = process.env.PREDIS_BRAND_ID;

  if (!apiKey || !brandId) {
    return { success: false, error: 'PREDIS_API_KEY of PREDIS_BRAND_ID niet ingesteld' };
  }

  var text = options.text || '';
  var mediaType = options.media_type || 'single_image';
  var mediaUrls = options.media_urls || null;
  var colorPalette = options.color_palette_type || 'brand';
  var outputLanguage = options.output_language || 'english';

  var form = new FormData();
  form.append('brand_id', brandId);
  form.append('text', text);
  form.append('media_type', mediaType);
  form.append('color_palette_type', colorPalette);
  form.append('output_language', outputLanguage);

  if (mediaUrls && mediaUrls.length > 0) {
    form.append('media_urls', JSON.stringify(mediaUrls));
  }

  try {
    var response = await fetch(PREDIS_API_BASE + '/create_content/', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey
      },
      body: form
    });

    var data = await response.json();

    if (response.ok && data.post_ids && data.post_ids.length > 0) {
      return {
        success: true,
        post_ids: data.post_ids,
        post_status: data.post_status || 'inProgress',
        message: 'Post wordt gegenereerd. Check status via get_posts of wacht op webhook.'
      };
    } else {
      var errorMsg = 'Predis API error';
      if (data.errors && data.errors.length > 0) {
        errorMsg = data.errors.map(function (e) { return e.detail || e.message || JSON.stringify(e); }).join('; ');
      }
      return {
        success: false,
        error: errorMsg,
        status_code: response.status,
        raw: data
      };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getPosts(options) {
  var apiKey = process.env.PREDIS_API_KEY;
  var brandId = process.env.PREDIS_BRAND_ID;

  if (!apiKey || !brandId) {
    return { success: false, error: 'PREDIS_API_KEY of PREDIS_BRAND_ID niet ingesteld' };
  }

  var mediaType = (options && options.media_type) || 'single_image';
  var page = (options && options.page) || 1;
  var items = (options && options.items) || 10;

  var url = PREDIS_API_BASE + '/get_posts/' +
    '?brand_id=' + encodeURIComponent(brandId) +
    '&media_type=' + encodeURIComponent(mediaType) +
    '&page_n=' + page +
    '&items_n=' + items;

  try {
    var response = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + apiKey }
    });

    var data = await response.json();

    if (response.ok && data.posts) {
      return {
        success: true,
        posts: data.posts,
        total_pages: data.total_pages || 1
      };
    } else {
      var errorMsg = 'Predis API error';
      if (data.errors && data.errors.length > 0) {
        errorMsg = data.errors.map(function (e) { return e.detail || JSON.stringify(e); }).join('; ');
      }
      return { success: false, error: errorMsg, status_code: response.status };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function listBrands() {
  var apiKey = process.env.PREDIS_API_KEY;

  if (!apiKey) {
    return { success: false, error: 'PREDIS_API_KEY niet ingesteld' };
  }

  try {
    var response = await fetch(PREDIS_API_BASE + '/brands/', {
      headers: { 'Authorization': 'Bearer ' + apiKey }
    });
    var data = await response.json();
    return { success: true, data: data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { createPost, getPosts, listBrands };
