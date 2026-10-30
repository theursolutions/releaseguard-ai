// Optional real names and photos for the crew, set by each developer on their own computer:
//   ~/.devcrew/crew.json      { "developer": { "name": "…", "title": "…", "photo": "me.png" } }
//   ~/.devcrew/crew/me.png    the photo, a square headshot
// Read on every request so edits show after a page reload. Nothing here ever leaves the computer.
const fs = require('fs');
const path = require('path');

const MAX_FILE_BYTES = 64 * 1024;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const AGENT_TYPE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
// A plain file name inside the crew folder: no folders, no hidden files.
const PHOTO_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function crewFolder(dataDir) {
  return path.join(dataDir, 'crew');
}

/** The photo file for an entry, or null when it is missing, too large or not an image name we accept. */
function photoFile(dataDir, name) {
  if (typeof name !== 'string' || !PHOTO_NAME.test(name) || !PHOTO_TYPES[path.extname(name).toLowerCase()]) return null;
  const file = path.join(crewFolder(dataDir), name);
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= MAX_PHOTO_BYTES ? file : null;
  } catch {
    return null;
  }
}

/** Valid entries from crew.json, keyed by agent type. A missing or broken file means no people. */
function readPeople(dataDir) {
  let raw;
  try {
    const file = path.join(dataDir, 'crew.json');
    if (fs.statSync(file).size > MAX_FILE_BYTES) return {};
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const people = {};
  for (const [type, entry] of Object.entries(raw)) {
    const name = text(entry?.name, 60);
    if (!AGENT_TYPE.test(type) || !name) continue;
    people[type] = { name, title: text(entry.title, 80), photoFile: photoFile(dataDir, entry.photo) };
  }
  return people;
}

/** What the page receives: names, titles and a photo URL. File paths stay on the server. */
function publicPeople(people) {
  return Object.fromEntries(
    Object.entries(people).map(([type, person]) => [type, { name: person.name, title: person.title, photo: person.photoFile ? `/people/${type}` : null }]),
  );
}

function photoType(file) {
  return PHOTO_TYPES[path.extname(file).toLowerCase()];
}

module.exports = { readPeople, publicPeople, photoType };
