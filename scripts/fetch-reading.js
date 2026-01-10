const fs = require('fs');
const path = require('path');

const GOODREADS_RSS_URL = 'https://www.goodreads.com/review/list_rss/184356502-sophie-davis?shelf=currently-reading';

async function fetchReading() {
  console.log('Fetching Goodreads RSS feed...');

  const response = await fetch(GOODREADS_RSS_URL);
  const xml = await response.text();

  // Parse items from RSS
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];

    const title = extractTag(itemXml, 'title')?.replace(/ by .*$/, '').trim();
    const author = extractTag(itemXml, 'author_name');
    const link = extractTag(itemXml, 'link');

    // Try dedicated image tags first, then fall back to description
    let image = extractTag(itemXml, 'book_large_image_url')
             || extractTag(itemXml, 'book_medium_image_url')
             || extractTag(itemXml, 'book_image_url');

    // Fall back to extracting from description HTML
    if (!image) {
      const description = extractTag(itemXml, 'description');
      const imgMatch = description?.match(/src="([^"]+)"/);
      image = imgMatch ? imgMatch[1] : null;
    }

    if (title && author) {
      items.push({ title, author, image, link });
    }
  }

  const data = {
    updated: new Date().toISOString(),
    books: items
  };

  const outputPath = path.join(__dirname, '..', 'data', 'reading.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

  console.log(`Saved ${items.length} books to reading.json`);
  console.log(items.map(b => `  - ${b.title} by ${b.author}`).join('\n'));
}

function extractTag(xml, tag) {
  const regex = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}>([^<]*)<\\/${tag}>`);
  const match = xml.match(regex);
  return match ? (match[1] || match[2])?.trim() : null;
}

fetchReading().catch(console.error);
