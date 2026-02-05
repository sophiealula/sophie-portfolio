/**
 * Sync bookmarks from Slack to Micro.blog
 *
 * Fetches URLs from a Slack channel and creates bookmarks on Micro.blog
 * via the Micropub API.
 *
 * Required environment variables:
 *   - SLACK_BOT_TOKEN
 *   - SLACK_CHANNEL_ID
 *   - MICROBLOG_TOKEN (from micro.blog Account → App tokens)
 */

const fs = require('fs');
const path = require('path');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;
const MICROBLOG_TOKEN = process.env.MICROBLOG_TOKEN;

const STATE_FILE = path.join(__dirname, '..', 'data', 'microblog-bookmarks-state.json');

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.log('Could not load state file, starting fresh');
  }
  return { syncedUrls: [], lastSync: null };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function fetchSlackMessages() {
  const response = await fetch(`https://slack.com/api/conversations.history?channel=${SLACK_CHANNEL_ID}&limit=50`, {
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });

  const data = await response.json();

  if (!data.ok) {
    console.error('Slack API error:', data.error);
    return [];
  }

  return data.messages || [];
}

function extractUrls(messages) {
  const urls = [];
  const urlRegex = /<(https?:\/\/[^>|]+)(?:\|([^>]+))?>/g;

  for (const msg of messages) {
    const text = msg.text || '';
    let match;

    while ((match = urlRegex.exec(text)) !== null) {
      const url = match[1];

      // Skip Slack internal links
      if (url.includes('slack.com')) continue;

      urls.push(url);
    }
  }

  // Remove duplicates
  return [...new Set(urls)];
}

async function createMicroblogBookmark(url) {
  const response = await fetch('https://micro.blog/micropub', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MICROBLOG_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      'h': 'entry',
      'bookmark-of': url
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Micropub error ${response.status}: ${text}`);
  }

  return response.headers.get('Location');
}

async function main() {
  console.log('Starting bookmark sync...');
  console.log('SLACK_BOT_TOKEN:', SLACK_BOT_TOKEN ? 'set' : 'MISSING');
  console.log('SLACK_CHANNEL_ID:', SLACK_CHANNEL_ID ? 'set' : 'MISSING');
  console.log('MICROBLOG_TOKEN:', MICROBLOG_TOKEN ? 'set' : 'MISSING');

  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.error('Missing SLACK_BOT_TOKEN or SLACK_CHANNEL_ID');
    process.exit(1);
  }

  if (!MICROBLOG_TOKEN) {
    console.error('Missing MICROBLOG_TOKEN');
    console.log('Get one from: https://micro.blog/account/apps');
    process.exit(1);
  }

  const state = loadState();
  console.log(`Previously synced ${state.syncedUrls.length} bookmarks`);

  console.log('Fetching messages from Slack...');
  const messages = await fetchSlackMessages();
  console.log(`Found ${messages.length} messages`);

  const urls = extractUrls(messages);
  console.log(`Extracted ${urls.length} unique URLs`);

  // Find new URLs not yet synced
  const newUrls = urls.filter(url => !state.syncedUrls.includes(url));
  console.log(`${newUrls.length} new bookmarks to sync`);

  let synced = 0;
  for (const url of newUrls) {
    try {
      console.log(`Creating bookmark: ${url}`);
      await createMicroblogBookmark(url);
      state.syncedUrls.push(url);
      synced++;
      // Small delay to be nice to the API
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`Failed to create bookmark for ${url}:`, e.message);
    }
  }

  state.lastSync = new Date().toISOString();
  saveState(state);

  console.log(`Synced ${synced} new bookmarks to micro.blog`);
}

main().catch(console.error);
