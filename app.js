// Shared data layer for Album Flow Visualizer
const STORAGE_KEY = 'albumFlowSongs';

const SONG_PALETTE = [
  '#4C6EF5', '#12B886', '#F59F00', '#E64980', '#7048E8',
  '#15AABF', '#FA5252', '#82C91E', '#FAB005', '#20C997',
];

const LABEL_PALETTE = [
  '#5C7CFA', '#38D9A9', '#FFA94D', '#FF8787', '#B197FC',
  '#3BC9DB', '#FFD43B', '#69DB7C', '#FF922B', '#66D9E8',
  '#F783AC', '#91A7FF',
];

function loadSongs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Failed to load songs', e);
    return [];
  }
}

function saveSongs(songs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Accepts "3:30", "3.30", "210" -> seconds
function parseTime(str) {
  if (str == null) return NaN;
  const trimmed = String(str).trim();
  if (trimmed === '') return NaN;
  const colonMatch = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (colonMatch) {
    return parseInt(colonMatch[1], 10) * 60 + parseInt(colonMatch[2], 10);
  }
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : NaN;
}

function colorForSongIndex(i) {
  return SONG_PALETTE[i % SONG_PALETTE.length];
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function colorForLabel(label) {
  if (!label) return '#adb5bd';
  const idx = hashString(label) % LABEL_PALETTE.length;
  return LABEL_PALETTE[idx];
}

function totalDuration(songs) {
  return songs.reduce((sum, s) => sum + (s.duration || 0), 0);
}

// Groups a song's segments by label, so repeated occurrences of the same
// label (e.g. "Hiphop" appearing twice in one song) render as one row with
// multiple time ranges instead of duplicate rows.
// Returns [{ label, ranges: [{start, end}, ...] }] ordered by each label's earliest start.
function groupSegmentsByLabel(segments) {
  const order = [];
  const map = {};
  segments
    .slice()
    .sort((a, b) => a.start - b.start)
    .forEach((seg) => {
      if (!map[seg.label]) {
        map[seg.label] = [];
        order.push(seg.label);
      }
      map[seg.label].push({ start: seg.start, end: seg.end });
    });
  return order.map((label) => ({ label, ranges: map[label] }));
}

// Groups segments by label across the WHOLE album (all songs), converting each
// segment's time into an absolute position on the total album timeline. Used so
// a label repeated in different songs (e.g. "Hiphop" in both 曲A and 曲B) still
// renders as a single row instead of one row per song.
// Returns [{ label, occurrences: [{ absStart, absEnd, start, end, songName }, ...] }]
// ordered by each label's first absolute occurrence.
function groupSegmentsByLabelAcrossAlbum(songs) {
  const order = [];
  const map = {};
  let cum = 0;
  songs.forEach((song) => {
    const offset = cum;
    cum += song.duration;
    song.segments.forEach((seg) => {
      if (!map[seg.label]) {
        map[seg.label] = [];
        order.push(seg.label);
      }
      map[seg.label].push({
        absStart: offset + seg.start,
        absEnd: offset + seg.end,
        start: seg.start,
        end: seg.end,
        songName: song.name,
      });
    });
  });
  order.forEach((label) => {
    map[label].sort((a, b) => a.absStart - b.absStart);
  });
  return order
    .slice()
    .sort((a, b) => map[a][0].absStart - map[b][0].absStart)
    .map((label) => ({ label, occurrences: map[label] }));
}

// --- Manual per-label color overrides ---
const LABEL_COLOR_KEY = 'albumFlowLabelColors';

function loadLabelColors() {
  try {
    const raw = localStorage.getItem(LABEL_COLOR_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('Failed to load label colors', e);
    return {};
  }
}

function saveLabelColors(map) {
  localStorage.setItem(LABEL_COLOR_KEY, JSON.stringify(map));
}

// Returns the manually-set color for a label if one exists, otherwise the hash-based default.
function getLabelColor(label) {
  if (!label) return '#adb5bd';
  const map = loadLabelColors();
  return map[label] || colorForLabel(label);
}

function setLabelColor(label, color) {
  const map = loadLabelColors();
  map[label] = color;
  saveLabelColors(map);
}

// --- Manual per-label "観点" (category/axis) assignment ---
// e.g. both "轟音" and "静か" belong to the "音量" category, so the overview
// page can plot them on one shared row instead of separate rows.
const LABEL_CATEGORY_KEY = 'albumFlowLabelCategories';

function loadLabelCategories() {
  try {
    const raw = localStorage.getItem(LABEL_CATEGORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('Failed to load label categories', e);
    return {};
  }
}

function saveLabelCategories(map) {
  localStorage.setItem(LABEL_CATEGORY_KEY, JSON.stringify(map));
}

// Returns the category assigned to a label, or '' if it has none.
function getLabelCategory(label) {
  if (!label) return '';
  const map = loadLabelCategories();
  return map[label] || '';
}

function setLabelCategory(label, category) {
  const map = loadLabelCategories();
  const trimmed = (category || '').trim();
  if (trimmed) {
    map[label] = trimmed;
  } else {
    delete map[label];
  }
  saveLabelCategories(map);
}

// Collects the distinct label names in use, in first-seen order.
// `extraSegments` lets callers include labels from a song being edited but not yet saved.
function collectLabels(songs, extraSegments) {
  const seen = [];
  const add = (label) => {
    if (label && !seen.includes(label)) seen.push(label);
  };
  songs.forEach((song) => song.segments.forEach((seg) => add(seg.label)));
  if (extraSegments) extraSegments.forEach((seg) => add(seg.label));
  return seen;
}

// Renders an editable color + category legend into `container` for the given labels.
// Calls `onChange()` after the user picks a new color or edits a category, so the
// caller can re-render whatever bars are on screen.
function renderLabelColorPanel(container, labels, onChange) {
  container.innerHTML = '';
  if (labels.length === 0) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'まだ要素が登録されていません。';
    container.appendChild(note);
    return;
  }
  labels.forEach((label) => {
    const row = document.createElement('div');
    row.className = 'label-color-row';

    const swatch = document.createElement('input');
    swatch.type = 'color';
    swatch.value = getLabelColor(label);
    swatch.addEventListener('input', () => {
      setLabelColor(label, swatch.value);
      if (onChange) onChange(label, swatch.value);
    });

    const name = document.createElement('span');
    name.className = 'label-color-name';
    name.textContent = label;

    const category = document.createElement('input');
    category.type = 'text';
    category.className = 'label-category-input';
    category.placeholder = '観点(任意)';
    category.value = getLabelCategory(label);
    category.addEventListener('change', () => {
      setLabelCategory(label, category.value);
      if (onChange) onChange(label, category.value);
    });

    row.appendChild(swatch);
    row.appendChild(name);
    row.appendChild(category);
    container.appendChild(row);
  });
}

// Groups segments by "観点" (category) across the whole album. Labels that
// share a category (e.g. "轟音" and "静か" both under "音量") are merged into
// one row so their combined occurrences render on a single shared track; each
// occurrence still keeps its own label so it can use that label's own color.
// Labels with no category assigned stay on their own row, keyed by the label itself.
// Returns [{ key, displayName, occurrences: [{ absStart, absEnd, start, end, songName, label }] }]
// ordered by each row's first absolute occurrence.
function groupSegmentsByCategoryAcrossAlbum(songs) {
  const order = [];
  const map = {};
  let cum = 0;
  songs.forEach((song) => {
    const offset = cum;
    cum += song.duration;
    song.segments.forEach((seg) => {
      const category = getLabelCategory(seg.label);
      const key = category ? `cat:${category}` : `label:${seg.label}`;
      const displayName = category || seg.label;
      if (!map[key]) {
        map[key] = { displayName, occurrences: [] };
        order.push(key);
      }
      map[key].occurrences.push({
        absStart: offset + seg.start,
        absEnd: offset + seg.end,
        start: seg.start,
        end: seg.end,
        songName: song.name,
        label: seg.label,
      });
    });
  });
  order.forEach((key) => {
    map[key].occurrences.sort((a, b) => a.absStart - b.absStart);
  });
  return order
    .slice()
    .sort((a, b) => map[a].occurrences[0].absStart - map[b].occurrences[0].absStart)
    .map((key) => ({ key, displayName: map[key].displayName, occurrences: map[key].occurrences }));
}

// --- Backup / restore (JSON export & import) ---

function buildExportPayload() {
  return {
    format: 'album-flow-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    songs: loadSongs(),
    labelColors: loadLabelColors(),
  };
}

function downloadJSON(filename, dataObj) {
  const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportAlbumData() {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadJSON(`album-flow-${stamp}.json`, buildExportPayload());
}

// Appends songs from an exported JSON string onto the current data.
// Imported songs/segments get fresh ids to avoid colliding with existing ones.
// Label colors are merged, with the imported file's colors taking precedence
// on conflicts (so importing someone else's color choices applies them).
// Returns { songsAdded } on success, or throws an Error with a Japanese message on failure.
function importAlbumDataAppend(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error('JSONの形式が正しくありません');
  }
  if (!parsed || !Array.isArray(parsed.songs)) {
    throw new Error('曲データが見つかりません（Album Flow Visualizerで書き出したファイルを選んでください）');
  }

  const remappedSongs = parsed.songs.map((song) => ({
    id: uid(),
    name: String(song.name || ''),
    duration: Number(song.duration) || 0,
    segments: Array.isArray(song.segments)
      ? song.segments.map((seg) => ({
          id: uid(),
          label: String(seg.label || ''),
          start: Number(seg.start) || 0,
          end: Number(seg.end) || 0,
        }))
      : [],
  }));

  const songs = loadSongs();
  saveSongs(songs.concat(remappedSongs));

  const existingColors = loadLabelColors();
  const importedColors = parsed.labelColors && typeof parsed.labelColors === 'object' ? parsed.labelColors : {};
  saveLabelColors({ ...existingColors, ...importedColors });

  return { songsAdded: remappedSongs.length };
}
