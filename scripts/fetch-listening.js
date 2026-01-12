const fs = require('fs');
const path = require('path');

const LASTFM_API_KEY = process.env.LASTFM_API_KEY || '8b61de3f5eb035dd820b09c27fc7f129';
const LASTFM_USER = 'sophiealu';
const LIMIT = 10;

async function fetchListening() {
  console.log('Fetching Last.fm recent tracks...');

  const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${LASTFM_USER}&api_key=${LASTFM_API_KEY}&format=json&limit=${LIMIT}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'SophiePortfolio/1.0' }
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error('Failed to parse response:', text.slice(0, 200));
    throw e;
  }

  const tracks = data.recenttracks?.track || [];

  const items = tracks.map(track => {
    const title = track.name;
    const artist = track.artist['#text'];
    // Create Spotify search URL
    const spotifyUrl = `https://open.spotify.com/search/${encodeURIComponent(artist + ' ' + title)}`;

    return {
      title,
      artist,
      album: track.album['#text'],
      image: track.image?.find(img => img.size === 'large')?.['#text'] || null,
      url: spotifyUrl,
      lastfmUrl: track.url,
      nowPlaying: track['@attr']?.nowplaying === 'true'
    };
  });

  // Dedupe by title+artist (keep first occurrence)
  const seen = new Set();
  const unique = items.filter(item => {
    const key = `${item.title}|${item.artist}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const output = {
    updated: new Date().toISOString(),
    tracks: unique
  };

  const outputPath = path.join(__dirname, '..', 'data', 'listening.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`Saved ${unique.length} tracks to listening.json`);
  console.log(unique.map(t => `  - ${t.title} by ${t.artist}`).join('\n') || '  (no tracks yet)');
}

fetchListening().catch(console.error);
