const fs = require('fs');
const path = require('path');

const MICROBLOG_FEED_URL = 'https://sophiealula.micro.blog/feed.json';
const NOW_TAG = 'Now';

async function fetchMicroblog() {
  console.log('Fetching micro.blog feed...');

  try {
    const response = await fetch(MICROBLOG_FEED_URL);
    const feed = await response.json();

    if (!feed.items || feed.items.length === 0) {
      console.log('No posts found');
      return;
    }

    // Filter to only posts tagged with "Now"
    const nowItems = feed.items.filter(item =>
      item.tags && item.tags.includes(NOW_TAG)
    );

    if (nowItems.length === 0) {
      console.log('No posts with "Now" tag found');
      return;
    }

    console.log(`Found ${nowItems.length} post(s) tagged "${NOW_TAG}"`);

    // Process posts
    const posts = nowItems.map(item => {
      const date = new Date(item.date_published);
      return {
        id: item.id,
        title: item.title || null,
        content: item.content_html,
        date: item.date_published,
        dateFormatted: date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric'
        }),
        url: item.url
      };
    });

    const data = {
      updated: new Date().toISOString(),
      posts: posts
    };

    // Save to data directory
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(dataDir, 'microblog.json'),
      JSON.stringify(data, null, 2)
    );

    console.log(`Saved ${posts.length} posts to data/microblog.json`);

  } catch (error) {
    console.error('Error fetching micro.blog:', error.message);
    process.exit(1);
  }
}

fetchMicroblog();
