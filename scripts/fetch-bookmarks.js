/**
 * Fetch bookmarks from a Slack channel
 *
 * Setup:
 * 1. Create a Slack app at https://api.slack.com/apps
 * 2. Add OAuth scope: channels:history (or groups:history for private channels)
 * 3. Install to workspace, get Bot Token (xoxb-...)
 * 4. Create a channel (e.g., #bookmarks) and invite the bot
 * 5. Set environment variables:
 *    - SLACK_BOT_TOKEN
 *    - SLACK_CHANNEL_ID (right-click channel > View channel details > copy ID at bottom)
 */

const fs = require('fs');
const path = require('path');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

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

async function fetchPageTitle(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BookmarkBot/1.0)' },
      timeout: 5000
    });
    const html = await response.text();
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (match) {
      return match[1].trim().replace(/\s+/g, ' ');
    }
  } catch (e) {
    console.log(`Could not fetch title for ${url}:`, e.message);
  }
  return null;
}

async function extractBookmarks(messages) {
  const bookmarks = [];

  // URL regex
  const urlRegex = /<(https?:\/\/[^>|]+)(?:\|([^>]+))?>/g;

  for (const msg of messages) {
    const text = msg.text || '';
    const timestamp = new Date(parseFloat(msg.ts) * 1000);

    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      const url = match[1];
      let title = match[2]; // Slack sometimes includes title after |

      // Skip Slack internal links
      if (url.includes('slack.com')) continue;

      // Fetch actual page title if Slack didn't provide one
      if (!title || title === url) {
        console.log(`Fetching title for: ${url}`);
        title = await fetchPageTitle(url) || url;
      }

      bookmarks.push({
        url,
        title,
        date: timestamp.toISOString(),
        dateFormatted: timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      });
    }
  }

  // Sort by date, newest first
  bookmarks.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Remove duplicates by URL
  const seen = new Set();
  return bookmarks.filter(b => {
    if (seen.has(b.url)) return false;
    seen.add(b.url);
    return true;
  });
}

async function main() {
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.error('Missing SLACK_BOT_TOKEN or SLACK_CHANNEL_ID environment variables');
    console.log('\nTo test with sample data, run with --sample flag');

    if (process.argv.includes('--sample')) {
      const sampleData = {
        updated: new Date().toISOString(),
        bookmarks: [
          { url: 'https://example.com/article-1', title: 'Sample Article 1', date: new Date().toISOString(), dateFormatted: 'Jan 30' },
          { url: 'https://example.com/article-2', title: 'Sample Article 2', date: new Date(Date.now() - 86400000).toISOString(), dateFormatted: 'Jan 29' }
        ]
      };

      const outputPath = path.join(__dirname, '..', 'data', 'bookmarks.json');
      fs.writeFileSync(outputPath, JSON.stringify(sampleData, null, 2));
      console.log('Sample data written to data/bookmarks.json');
    }
    return;
  }

  console.log('Fetching messages from Slack...');
  const messages = await fetchSlackMessages();
  console.log(`Found ${messages.length} messages`);

  const bookmarks = await extractBookmarks(messages);
  console.log(`Extracted ${bookmarks.length} bookmarks`);

  const output = {
    updated: new Date().toISOString(),
    bookmarks
  };

  const outputPath = path.join(__dirname, '..', 'data', 'bookmarks.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Written to ${outputPath}`);
}

main().catch(console.error);
