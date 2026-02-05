/**
 * Sync books from Slack to Micro.blog bookshelves
 *
 * Fetches "Title by Author" messages from Slack and adds them
 * to your Micro.blog "Currently Reading" bookshelf.
 *
 * Required environment variables:
 *   - SLACK_BOT_TOKEN
 *   - SLACK_READING_CHANNEL_ID
 *   - MICROBLOG_TOKEN (from micro.blog Account → App tokens)
 *   - MICROBLOG_BOOKSHELF_ID (get from micro.blog/books/bookshelves API)
 */

const fs = require('fs');
const path = require('path');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_READING_CHANNEL_ID = process.env.SLACK_READING_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;
const MICROBLOG_TOKEN = process.env.MICROBLOG_TOKEN;
const MICROBLOG_BOOKSHELF_ID = process.env.MICROBLOG_BOOKSHELF_ID;

const STATE_FILE = path.join(__dirname, '..', 'data', 'microblog-books-state.json');

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.log('Could not load state file, starting fresh');
  }
  return { syncedBooks: [], lastSync: null };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

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

async function searchIsbn(title, author) {
  try {
    const query = encodeURIComponent(`${title} ${author || ''}`);
    const searchUrl = `https://openlibrary.org/search.json?q=${query}&limit=1`;

    const response = await fetch(searchUrl, {
      headers: { 'User-Agent': 'SophieMicroblogSync/1.0' }
    });
    const data = await response.json();

    if (data.docs && data.docs.length > 0) {
      const book = data.docs[0];
      // Return first ISBN if available
      if (book.isbn && book.isbn.length > 0) {
        return book.isbn[0];
      }
    }
  } catch (e) {
    console.log(`Could not find ISBN for ${title}:`, e.message);
  }
  return null;
}

function extractBooks(messages) {
  const books = [];
  const seenTitles = new Set();

  for (const msg of messages) {
    const text = msg.text || '';

    // Skip messages with URLs (those are bookmarks)
    if (text.includes('http://') || text.includes('https://')) continue;

    // Skip bot messages and thread replies
    if (msg.bot_id || msg.thread_ts) continue;

    // Skip system messages
    if (msg.subtype) continue;

    const book = parseBookFromMessage(text);
    if (book) {
      const key = `${book.title.toLowerCase()}|${(book.author || '').toLowerCase()}`;
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);

      books.push(book);
    }
  }

  return books;
}

async function getBookshelves() {
  const response = await fetch('https://micro.blog/books/bookshelves', {
    headers: {
      'Authorization': `Bearer ${MICROBLOG_TOKEN}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to get bookshelves: ${response.status}`);
  }

  return response.json();
}

async function addBookToMicroblog(book, bookshelfId) {
  const params = new URLSearchParams({
    title: book.title,
    author: book.author || 'Unknown',
    bookshelf_id: bookshelfId
  });

  if (book.isbn) {
    params.set('isbn', book.isbn);
  }

  const response = await fetch('https://micro.blog/books', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MICROBLOG_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Books API error ${response.status}: ${text}`);
  }

  return response.json();
}

async function main() {
  if (!SLACK_BOT_TOKEN || !SLACK_READING_CHANNEL_ID) {
    console.error('Missing SLACK_BOT_TOKEN or SLACK_READING_CHANNEL_ID');
    process.exit(1);
  }

  if (!MICROBLOG_TOKEN) {
    console.error('Missing MICROBLOG_TOKEN');
    console.log('Get one from: https://micro.blog/account/apps');
    process.exit(1);
  }

  // Get bookshelf ID if not provided
  let bookshelfId = MICROBLOG_BOOKSHELF_ID;
  if (!bookshelfId) {
    console.log('No MICROBLOG_BOOKSHELF_ID provided, fetching bookshelves...');
    const shelves = await getBookshelves();
    console.log('Available bookshelves:');
    for (const shelf of shelves.items || []) {
      console.log(`  - ${shelf.title}: ${shelf._microblog?.id}`);
    }

    // Try to find "Currently Reading" shelf
    const currentlyReading = (shelves.items || []).find(s =>
      s.title.toLowerCase().includes('currently reading')
    );

    if (currentlyReading) {
      bookshelfId = currentlyReading._microblog?.id;
      console.log(`Using "Currently Reading" shelf: ${bookshelfId}`);
    } else {
      console.error('Could not find bookshelf. Set MICROBLOG_BOOKSHELF_ID manually.');
      process.exit(1);
    }
  }

  const state = loadState();
  console.log(`Previously synced ${state.syncedBooks.length} books`);

  console.log('Fetching messages from Slack...');
  const messages = await fetchSlackMessages();
  console.log(`Found ${messages.length} messages`);

  const books = extractBooks(messages);
  console.log(`Extracted ${books.length} books`);

  // Find new books not yet synced
  const newBooks = books.filter(book => {
    const key = `${book.title.toLowerCase()}|${(book.author || '').toLowerCase()}`;
    return !state.syncedBooks.includes(key);
  });
  console.log(`${newBooks.length} new books to sync`);

  let synced = 0;
  for (const book of newBooks) {
    try {
      console.log(`Looking up ISBN for: ${book.title} by ${book.author || 'Unknown'}`);
      book.isbn = await searchIsbn(book.title, book.author);

      console.log(`Adding to micro.blog: ${book.title}`);
      await addBookToMicroblog(book, bookshelfId);

      const key = `${book.title.toLowerCase()}|${(book.author || '').toLowerCase()}`;
      state.syncedBooks.push(key);
      synced++;

      // Small delay to be nice to the API
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.error(`Failed to add book "${book.title}":`, e.message);
    }
  }

  state.lastSync = new Date().toISOString();
  saveState(state);

  console.log(`Synced ${synced} new books to micro.blog`);
}

main().catch(console.error);
