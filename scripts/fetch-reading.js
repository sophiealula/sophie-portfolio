/**
 * Fetch currently reading books from a Slack channel
 * Uses Open Library API to get book covers
 *
 * Message format in Slack:
 * - "Title by Author"
 * - "📚 Title by Author"
 * - "Currently reading: Title by Author"
 *
 * Setup:
 * 1. Create a Slack channel (e.g., #reading)
 * 2. Use same Slack app as bookmarks
 * 3. Set environment variables:
 *    - SLACK_BOT_TOKEN
 *    - SLACK_READING_CHANNEL_ID (or reuse SLACK_CHANNEL_ID)
 */

const fs = require('fs');
const path = require('path');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_READING_CHANNEL_ID = process.env.SLACK_READING_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;

async function fetchSlackMessages() {
  const response = await fetch(`https://slack.com/api/conversations.history?channel=${SLACK_READING_CHANNEL_ID}&limit=20`, {
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

async function fetchBookCover(title, author) {
  try {
    // Search Open Library for the book
    const query = encodeURIComponent(`${title} ${author || ''}`);
    const searchUrl = `https://openlibrary.org/search.json?q=${query}&limit=1`;

    console.log(`  Searching Open Library for: ${title}${author ? ` by ${author}` : ''}`);

    const response = await fetch(searchUrl, {
      headers: { 'User-Agent': 'SophiePortfolio/1.0' }
    });
    const data = await response.json();

    if (data.docs && data.docs.length > 0) {
      const book = data.docs[0];

      // Get cover ID (prefer edition covers, fall back to work covers)
      const coverId = book.cover_i;

      if (coverId) {
        // M = medium size, L = large
        const coverUrl = `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
        console.log(`  Found cover: ${coverUrl}`);
        return coverUrl;
      }
    }

    console.log(`  No cover found for: ${title}`);
    return null;
  } catch (e) {
    console.log(`  Error fetching cover for ${title}:`, e.message);
    return null;
  }
}

function parseBookFromMessage(text) {
  // Remove common prefixes
  let cleaned = text
    .replace(/^📚\s*/i, '')
    .replace(/^currently reading:\s*/i, '')
    .replace(/^reading:\s*/i, '')
    .replace(/^now reading:\s*/i, '')
    .trim();

  // Parse "Title by Author" format
  const byMatch = cleaned.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return {
      title: byMatch[1].trim(),
      author: byMatch[2].trim()
    };
  }

  // If no "by", treat whole thing as title
  if (cleaned.length > 0 && cleaned.length < 200) {
    return {
      title: cleaned,
      author: null
    };
  }

  return null;
}

async function extractBooks(messages) {
  const books = [];
  const seenTitles = new Set();

  for (const msg of messages) {
    const text = msg.text || '';

    // Skip messages with URLs (those are bookmarks)
    if (text.includes('http://') || text.includes('https://')) continue;

    // Skip bot messages and thread replies
    if (msg.bot_id || msg.thread_ts) continue;

    // Skip system messages (joins, leaves, etc.)
    if (msg.subtype) continue;

    // Skip messages that are just user mentions or system-like
    if (text.match(/^<@U[A-Z0-9]+>/) || text.includes('has joined')) continue;

    const book = parseBookFromMessage(text);
    if (book) {
      // Skip duplicates
      const key = `${book.title.toLowerCase()}|${(book.author || '').toLowerCase()}`;
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);

      console.log(`Found book: ${book.title}${book.author ? ` by ${book.author}` : ''}`);

      // Fetch cover from Open Library
      const image = await fetchBookCover(book.title, book.author);

      books.push({
        title: book.title,
        author: book.author || 'Unknown',
        image: image,
        link: null // No link for Slack-sourced books
      });
    }
  }

  return books;
}

async function main() {
  if (!SLACK_BOT_TOKEN || !SLACK_READING_CHANNEL_ID) {
    console.error('Missing SLACK_BOT_TOKEN or SLACK_READING_CHANNEL_ID environment variables');
    console.log('\nTo test with sample data, run with --sample flag');

    if (process.argv.includes('--sample')) {
      // Fetch covers for sample data
      console.log('Generating sample data with real covers...');

      const sampleBooks = [
        { title: 'Breakneck', author: 'Dan Wang' },
        { title: 'The Design of Everyday Things', author: 'Don Norman' }
      ];

      const booksWithCovers = [];
      for (const book of sampleBooks) {
        const image = await fetchBookCover(book.title, book.author);
        booksWithCovers.push({
          ...book,
          image,
          link: null
        });
      }

      const sampleData = {
        updated: new Date().toISOString(),
        books: booksWithCovers
      };

      const outputPath = path.join(__dirname, '..', 'data', 'reading.json');
      fs.writeFileSync(outputPath, JSON.stringify(sampleData, null, 2));
      console.log('Sample data written to data/reading.json');
    }
    return;
  }

  console.log('Fetching messages from Slack reading channel...');
  const messages = await fetchSlackMessages();
  console.log(`Found ${messages.length} messages`);

  const books = await extractBooks(messages);
  console.log(`Extracted ${books.length} books`);

  if (books.length === 0) {
    console.log('No books found. Make sure to post in format: "Title by Author"');
  }

  const output = {
    updated: new Date().toISOString(),
    books
  };

  const outputPath = path.join(__dirname, '..', 'data', 'reading.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Written to ${outputPath}`);
}

main().catch(console.error);
