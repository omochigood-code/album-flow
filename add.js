function startAddPage() {
  let songs = loadSongs();
  let currentSong = null; // { id, name, duration, segments: [{id, label, start, end}] }
  let editingExistingId = null;
  let pendingSelection = null; // { start, end }

  const nameInput = document.getElementById('song-name');
  const durationInput = document.getElementById('song-duration');
  const btnStart = document.getElementById('btn-start');
  const btnReset = document.getElementById('btn-reset');
  const editingNote = document.getElementById('editing-note');

  const timelineWrap = document.getElementById('timeline-wrap');
  const ruler = document.getElementById('ruler');
  const selectTrack = document.getElementById('select-track');
  const selectHint = document.getElementById('select-hint');
  const selectPreview = document.getElementById('select-preview');

  const segForm = document.getElementById('add-segment-form');
  const segLabelInput = document.getElementById('seg-label');
  const segStartInput = document.getElementById('seg-start');
  const segEndInput = document.getElementById('seg-end');
  const segCategoryInput = document.getElementById('seg-category');
  const btnAddSegment = document.getElementById('btn-add-segment');
  const btnCancelSegment = document.getElementById('btn-cancel-segment');

  const segmentList = document.getElementById('segment-list');
  const btnSaveSong = document.getElementById('btn-save-song');
  const songListEl = document.getElementById('song-list');
  const labelColorPanel = document.getElementById('label-color-panel');

  // Upserts currentSong into the songs list and saves immediately, so
  // in-progress edits aren't lost if the tab closes before "保存" is clicked
  // (data is already scoped to this signed-in user in Firestore, so there's
  // no reason to hold changes back behind an explicit save step).
  function persistCurrentSong() {
    if (!currentSong) return;
    const existingIndex = songs.findIndex((s) => s.id === currentSong.id);
    if (existingIndex >= 0) {
      songs[existingIndex] = currentSong;
    } else {
      songs.push(currentSong);
    }
    saveSongs(songs);
  }

  function renderLabelColors() {
    const extra = currentSong ? currentSong.segments : null;
    const labels = collectLabels(songs, extra);
    renderLabelColorPanel(labelColorPanel, labels, () => {
      renderSegmentList();
    });
  }

  function pctFor(seconds) {
    if (!currentSong || currentSong.duration <= 0) return 0;
    return Math.min(100, Math.max(0, (seconds / currentSong.duration) * 100));
  }

  function renderRuler() {
    ruler.innerHTML = '';
    if (!currentSong) return;
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const t = (currentSong.duration * i) / steps;
      const span = document.createElement('span');
      span.style.left = `${(i / steps) * 100}%`;
      span.textContent = formatTime(t);
      ruler.appendChild(span);
    }
  }

  function renderSegmentList() {
    segmentList.innerHTML = '';
    if (!currentSong || currentSong.segments.length === 0) {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'まだ要素が登録されていません。上のバーをドラッグして追加してください。';
      segmentList.appendChild(note);
      return;
    }
    currentSong.segments
      .slice()
      .sort((a, b) => a.start - b.start)
      .forEach((seg) => {
        const row = document.createElement('div');
        row.className = 'segment-row';

        const label = document.createElement('div');
        label.className = 'seg-label';
        label.textContent = seg.label;
        label.style.color = getLabelColor(seg.label);

        const track = document.createElement('div');
        track.className = 'track';
        const fill = document.createElement('div');
        fill.className = 'fill';
        fill.style.left = `${pctFor(seg.start)}%`;
        fill.style.width = `${Math.max(0.5, pctFor(seg.end) - pctFor(seg.start))}%`;
        fill.style.background = getLabelColor(seg.label);
        track.appendChild(fill);

        const time = document.createElement('div');
        time.className = 'seg-time';
        time.textContent = `${formatTime(seg.start)}-${formatTime(seg.end)}`;

        const del = document.createElement('button');
        del.className = 'icon danger';
        del.textContent = '削除';
        del.addEventListener('click', () => {
          currentSong.segments = currentSong.segments.filter((s) => s.id !== seg.id);
          persistCurrentSong();
          renderSegmentList();
          renderLabelColors();
        });

        row.appendChild(label);
        row.appendChild(track);
        row.appendChild(time);

        segmentList.appendChild(row);

        const delRow = document.createElement('div');
        delRow.style.gridColumn = '1 / -1';
        delRow.style.display = 'flex';
        delRow.style.justifyContent = 'flex-end';
        delRow.style.marginTop = '-4px';
        delRow.style.marginBottom = '4px';
        delRow.appendChild(del);
        segmentList.appendChild(delRow);
      });
  }

  function showTimeline() {
    timelineWrap.classList.add('active');
    renderRuler();
    renderSegmentList();
    renderLabelColors();
    // Open the add-segment form with a sensible default range right away,
    // so an item can be added by typing alone without ever dragging.
    showSegmentForm(0, Math.min(10, currentSong.duration), { focus: false });
  }

  function hideTimeline() {
    timelineWrap.classList.remove('active');
  }

  function showSegmentForm(startSec, endSec, opts) {
    pendingSelection = { start: startSec, end: endSec };
    segLabelInput.value = '';
    segStartInput.value = formatTime(startSec);
    segEndInput.value = formatTime(endSec);
    segCategoryInput.value = '';
    segForm.classList.add('active');
    selectHint.style.display = 'none';
    selectPreview.style.display = 'block';
    selectPreview.style.left = `${pctFor(startSec)}%`;
    selectPreview.style.width = `${Math.max(0.5, pctFor(endSec) - pctFor(startSec))}%`;
    if (!opts || opts.focus !== false) segLabelInput.focus();
  }

  // --- Drag-to-select on the timeline track ---
  let dragging = false;
  // The drag anchor is stored as a TIME (seconds), not a raw pixel, and is
  // resolved from the track's position at the moment the drag starts. If the
  // track then shifts mid-drag (e.g. the mobile keyboard closing reflows the
  // page), later pixel-to-time conversions use a freshly-measured rect, so
  // the selection stays correct instead of drifting from a stale pixel anchor.
  let dragStartTime = 0;

  function timeFromClientX(clientX) {
    const rect = selectTrack.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * currentSong.duration;
  }

  function handleDragStart(clientX) {
    if (!currentSong) return;
    dragging = true;
    dragStartTime = timeFromClientX(clientX);
    selectHint.style.display = 'none';
    selectPreview.style.display = 'block';
    selectPreview.style.left = `${pctFor(dragStartTime)}%`;
    selectPreview.style.width = '0%';
    // Dismiss the on-screen keyboard (mobile) so it doesn't swallow this tap
    // and so it isn't left covering the screen while dragging. This can
    // shift the track's on-screen position, which is why dragStartTime was
    // already resolved above instead of being stored as a pixel offset.
    if (document.activeElement && segForm.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  function handleDragMove(clientX) {
    if (!dragging || !currentSong) return;
    const currentTime = timeFromClientX(clientX);
    const leftPct = pctFor(Math.min(dragStartTime, currentTime));
    const rightPct = pctFor(Math.max(dragStartTime, currentTime));
    selectPreview.style.left = `${leftPct}%`;
    selectPreview.style.width = `${Math.max(0, rightPct - leftPct)}%`;
  }

  function handleDragEnd(clientX) {
    if (!dragging || !currentSong) return;
    dragging = false;
    const currentTime = timeFromClientX(clientX);
    let start = Math.min(dragStartTime, currentTime);
    let end = Math.max(dragStartTime, currentTime);
    if (end - start < 1) {
      end = Math.min(currentSong.duration, start + Math.max(1, currentSong.duration * 0.02));
    }
    start = Math.round(start);
    end = Math.round(end);
    if (end <= start) {
      selectPreview.style.display = 'none';
      selectHint.style.display = 'flex';
      return;
    }
    showSegmentForm(start, end);
  }

  // Mouse (desktop)
  selectTrack.addEventListener('mousedown', (e) => handleDragStart(e.clientX));
  window.addEventListener('mousemove', (e) => handleDragMove(e.clientX));
  window.addEventListener('mouseup', (e) => handleDragEnd(e.clientX));

  // Touch (mobile) — preventDefault on move so the page doesn't scroll while dragging.
  selectTrack.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return;
      handleDragStart(e.touches[0].clientX);
    },
    { passive: true }
  );
  window.addEventListener(
    'touchmove',
    (e) => {
      if (!dragging) return;
      e.preventDefault();
      handleDragMove(e.touches[0].clientX);
    },
    { passive: false }
  );
  window.addEventListener('touchend', (e) => {
    if (!dragging) return;
    handleDragEnd(e.changedTouches[0].clientX);
  });

  // Keep the highlighted preview bar in sync when the start/end fields are
  // hand-edited, not just while dragging.
  function syncPreviewFromInputs() {
    if (!currentSong) return;
    const start = parseTime(segStartInput.value);
    const end = parseTime(segEndInput.value);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    const leftPct = pctFor(Math.min(start, end));
    const rightPct = pctFor(Math.max(start, end));
    selectPreview.style.display = 'block';
    selectPreview.style.left = `${leftPct}%`;
    selectPreview.style.width = `${Math.max(0, rightPct - leftPct)}%`;
  }
  segStartInput.addEventListener('input', syncPreviewFromInputs);
  segEndInput.addEventListener('input', syncPreviewFromInputs);

  // Auto-fill the category field from a previously-registered label, without
  // clobbering anything the user has already typed into it.
  segLabelInput.addEventListener('input', () => {
    if (segCategoryInput.value.trim() !== '') return;
    const existing = getLabelCategory(segLabelInput.value.trim());
    if (existing) segCategoryInput.value = existing;
  });

  btnAddSegment.addEventListener('click', () => {
    const label = segLabelInput.value.trim();
    const start = parseTime(segStartInput.value);
    const end = parseTime(segEndInput.value);
    if (!label) {
      alert('要素名を入力してください');
      return;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      alert('開始・終了の時間が正しくありません');
      return;
    }
    if (start < 0 || end > currentSong.duration) {
      alert('曲の長さの範囲内で入力してください');
      return;
    }
    if (segCategoryInput.value.trim()) {
      setLabelCategory(label, segCategoryInput.value.trim());
    }
    currentSong.segments.push({ id: uid(), label, start, end });
    persistCurrentSong();
    // Keep the form open on the same time range so another label can be
    // added to it right away (the same range can hold multiple items).
    segLabelInput.value = '';
    segCategoryInput.value = '';
    segLabelInput.focus();
    renderSegmentList();
    renderLabelColors();
  });

  btnCancelSegment.addEventListener('click', () => {
    // Just clear the label/category fields — no need to collapse the form.
    segLabelInput.value = '';
    segCategoryInput.value = '';
  });

  // --- Song lifecycle ---
  btnStart.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const duration = parseTime(durationInput.value);
    if (!name) {
      alert('曲名を入力してください');
      return;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      alert('曲の長さを m:ss の形式で入力してください（例: 3:30）');
      return;
    }
    if (currentSong && editingExistingId) {
      currentSong.name = name;
      currentSong.duration = duration;
    } else {
      currentSong = { id: uid(), name, duration, segments: [] };
    }
    persistCurrentSong();
    showTimeline();
  });

  btnReset.addEventListener('click', () => {
    resetEditor();
  });

  function resetEditor() {
    currentSong = null;
    editingExistingId = null;
    nameInput.value = '';
    durationInput.value = '';
    btnReset.style.display = 'none';
    editingNote.style.display = 'none';
    hideTimeline();
  }

  btnSaveSong.addEventListener('click', () => {
    // Every change is already persisted as it happens (persistCurrentSong),
    // so this just confirms the empty-segments case and closes the editor.
    if (!currentSong) return;
    if (currentSong.segments.length === 0) {
      if (!confirm('要素が1つも登録されていません。このまま完了しますか？')) return;
    }
    renderSongList();
    resetEditor();
    renderLabelColors();
  });

  function renderSongList() {
    songListEl.innerHTML = '';
    if (songs.length === 0) {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'まだ曲が追加されていません。';
      songListEl.appendChild(note);
      return;
    }
    songs.forEach((song, idx) => {
      const card = document.createElement('div');
      card.className = 'song-card';

      const swatch = document.createElement('div');
      swatch.className = 'swatch';
      swatch.style.background = colorForSongIndex(idx);

      const info = document.createElement('div');
      info.className = 'info';
      const nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = song.name;
      const metaEl = document.createElement('div');
      metaEl.className = 'meta';
      metaEl.textContent = `${formatTime(song.duration)} ・ 要素数 ${song.segments.length}`;
      info.appendChild(nameEl);
      info.appendChild(metaEl);

      const actions = document.createElement('div');
      actions.className = 'actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'secondary icon';
      editBtn.textContent = '編集';
      editBtn.addEventListener('click', () => {
        currentSong = JSON.parse(JSON.stringify(song));
        editingExistingId = song.id;
        nameInput.value = song.name;
        durationInput.value = formatTime(song.duration);
        btnReset.style.display = 'inline-block';
        editingNote.style.display = 'block';
        showTimeline();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'danger icon';
      delBtn.textContent = '削除';
      delBtn.addEventListener('click', () => {
        if (!confirm(`「${song.name}」を削除しますか？`)) return;
        songs = songs.filter((s) => s.id !== song.id);
        saveSongs(songs);
        renderSongList();
        if (editingExistingId === song.id) resetEditor();
        renderLabelColors();
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      card.appendChild(swatch);
      card.appendChild(info);
      card.appendChild(actions);
      songListEl.appendChild(card);
    });
  }

  renderSongList();
  renderLabelColors();
}

initAuthGate(startAddPage);
