(function () {
  let songs = loadSongs();
  const body = document.getElementById('overview-body');
  const labelColorPanel = document.getElementById('label-color-panel');

  function renderLabelColors() {
    renderLabelColorPanel(labelColorPanel, collectLabels(songs), () => render());
  }

  function moveSong(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= songs.length) return;
    const tmp = songs[index];
    songs[index] = songs[target];
    songs[target] = tmp;
    saveSongs(songs);
    render();
  }

  function deleteSong(id) {
    const song = songs.find((s) => s.id === id);
    if (!song) return;
    if (!confirm(`「${song.name}」をアルバムから削除しますか？`)) return;
    songs = songs.filter((s) => s.id !== id);
    saveSongs(songs);
    render();
  }

  function render() {
    body.innerHTML = '';
    songs = loadSongs();

    if (songs.length === 0) {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'まだ曲が追加されていません。「曲を追加」ページから登録してください。';
      body.appendChild(note);
      renderLabelColors();
      return;
    }

    const total = totalDuration(songs);

    // total bar
    const totalWrap = document.createElement('div');
    totalWrap.className = 'total-bar-wrap';
    const totalMeta = document.createElement('div');
    totalMeta.className = 'total-meta';
    totalMeta.innerHTML = `<span>アルバム全体</span><span>${formatTime(total)}</span>`;
    const totalTrack = document.createElement('div');
    totalTrack.className = 'track';
    let cum = 0;
    songs.forEach((song, idx) => {
      const fill = document.createElement('div');
      fill.className = 'fill';
      fill.style.left = `${(cum / total) * 100}%`;
      fill.style.width = `${(song.duration / total) * 100}%`;
      fill.style.background = colorForSongIndex(idx);
      totalTrack.appendChild(fill);
      cum += song.duration;
    });
    totalWrap.appendChild(totalMeta);
    totalWrap.appendChild(totalTrack);
    body.appendChild(totalWrap);

    // legend for songs
    const legend = document.createElement('div');
    legend.className = 'legend';
    songs.forEach((song, idx) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.style.background = colorForSongIndex(idx);
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(song.name));
      legend.appendChild(chip);
    });
    body.appendChild(legend);

    // song order list: header only, for reordering/removing songs
    const songListBlock = document.createElement('div');
    songListBlock.className = 'overview-block';
    const songListHeading = document.createElement('h3');
    songListHeading.className = 'section-heading';
    songListHeading.textContent = '曲の並び順';
    songListBlock.appendChild(songListHeading);
    const songListWrap = document.createElement('div');
    songListWrap.className = 'song-order-list';
    songs.forEach((song, idx) => {
      const head = document.createElement('div');
      head.className = 'head song-order-row';
      const swatch = document.createElement('div');
      swatch.className = 'swatch';
      swatch.style.background = colorForSongIndex(idx);
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = song.name;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${formatTime(song.duration)} ・ 要素数 ${song.segments.length}`;

      const reorder = document.createElement('div');
      reorder.className = 'reorder';
      const upBtn = document.createElement('button');
      upBtn.className = 'secondary icon';
      upBtn.textContent = '↑';
      upBtn.disabled = idx === 0;
      upBtn.addEventListener('click', () => moveSong(idx, -1));
      const downBtn = document.createElement('button');
      downBtn.className = 'secondary icon';
      downBtn.textContent = '↓';
      downBtn.disabled = idx === songs.length - 1;
      downBtn.addEventListener('click', () => moveSong(idx, 1));
      const delBtn = document.createElement('button');
      delBtn.className = 'danger icon';
      delBtn.textContent = '削除';
      delBtn.addEventListener('click', () => deleteSong(song.id));
      reorder.appendChild(upBtn);
      reorder.appendChild(downBtn);
      reorder.appendChild(delBtn);

      head.appendChild(swatch);
      head.appendChild(name);
      head.appendChild(meta);
      head.appendChild(reorder);
      songListWrap.appendChild(head);
    });
    songListBlock.appendChild(songListWrap);
    body.appendChild(songListBlock);

    // element rows: same label merged into one row even across different songs
    const elementsBlock = document.createElement('div');
    elementsBlock.className = 'overview-block';
    const elementsHeading = document.createElement('h3');
    elementsHeading.className = 'section-heading';
    elementsHeading.textContent = '要素の流れ';
    elementsBlock.appendChild(elementsHeading);

    const elementRows = document.createElement('div');
    elementRows.className = 'sub-rows';

    // song boundary offsets (skip the very start and very end)
    const boundaries = [];
    let boundaryAcc = 0;
    songs.forEach((song, i) => {
      boundaryAcc += song.duration;
      if (i < songs.length - 1) boundaries.push(boundaryAcc);
    });

    function appendBoundaries(track) {
      boundaries.forEach((b) => {
        const line = document.createElement('div');
        line.className = 'song-boundary';
        line.style.left = `${(b / total) * 100}%`;
        track.appendChild(line);
      });
    }

    const globalGroups = groupSegmentsByCategoryAcrossAlbum(songs);
    if (globalGroups.length === 0) {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'まだ要素が登録されていません。';
      elementRows.appendChild(note);
    } else {
      globalGroups.forEach(({ displayName, occurrences }) => {
        const row = document.createElement('div');
        row.className = 'sub-row';

        const label = document.createElement('div');
        label.className = 'seg-label';
        label.textContent = displayName;
        // labels sharing a category can have different colors, so only tint
        // the title when the row is a single un-categorized label.
        const distinctLabels = [...new Set(occurrences.map((o) => o.label))];
        if (distinctLabels.length === 1) {
          label.style.color = getLabelColor(distinctLabels[0]);
        }

        const track = document.createElement('div');
        track.className = 'track';
        occurrences.forEach((occ) => {
          const fill = document.createElement('div');
          fill.className = 'fill';
          fill.style.left = `${(occ.absStart / total) * 100}%`;
          fill.style.width = `${Math.max(0.3, ((occ.absEnd - occ.absStart) / total) * 100)}%`;
          fill.style.background = getLabelColor(occ.label);
          fill.title = `${occ.label} (${occ.songName} ${formatTime(occ.start)}-${formatTime(occ.end)})`;
          track.appendChild(fill);
        });
        appendBoundaries(track);

        row.appendChild(label);
        row.appendChild(track);
        elementRows.appendChild(row);

        // when a row merges multiple distinct labels under one category,
        // show a small legend so the colors are still identifiable.
        if (distinctLabels.length > 1) {
          const rowLegend = document.createElement('div');
          rowLegend.className = 'row-legend';
          distinctLabels.forEach((l) => {
            const chip = document.createElement('div');
            chip.className = 'chip';
            const dot = document.createElement('div');
            dot.className = 'dot';
            dot.style.background = getLabelColor(l);
            chip.appendChild(dot);
            chip.appendChild(document.createTextNode(l));
            rowLegend.appendChild(chip);
          });
          elementRows.appendChild(rowLegend);
        }
      });
    }
    elementsBlock.appendChild(elementRows);
    body.appendChild(elementsBlock);

    renderLabelColors();
  }

  render();

  // --- Backup / restore ---
  const btnExport = document.getElementById('btn-export');
  const btnImportTrigger = document.getElementById('btn-import-trigger');
  const importFileInput = document.getElementById('import-file-input');
  const importResult = document.getElementById('import-result');

  btnExport.addEventListener('click', () => {
    exportAlbumData();
  });

  btnImportTrigger.addEventListener('click', () => {
    importFileInput.click();
  });

  importFileInput.addEventListener('change', () => {
    const file = importFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { songsAdded } = importAlbumDataAppend(String(reader.result));
        importResult.textContent = `${songsAdded}曲を読み込み、末尾に追加しました。`;
        render();
      } catch (e) {
        importResult.textContent = `読み込みに失敗しました: ${e.message}`;
      } finally {
        importFileInput.value = '';
      }
    };
    reader.onerror = () => {
      importResult.textContent = 'ファイルの読み込みに失敗しました。';
      importFileInput.value = '';
    };
    reader.readAsText(file);
  });
})();
