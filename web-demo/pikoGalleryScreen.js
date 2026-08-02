/**
 * P7 · My Gallery — 展示已保存的画纸作品 + 多选
 */
(function () {
  'use strict';

  var objectUrls = [];
  var selectMode = false;
  var selectedIds = {};

  function el(id) { return document.getElementById(id); }

  function revokeUrls() {
    objectUrls.forEach(function (u) {
      try { URL.revokeObjectURL(u); } catch (e) { /* noop */ }
    });
    objectUrls = [];
  }

  function formatWhen(ts) {
    var d = new Date(ts || Date.now());
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var hh = String(d.getHours()).padStart(2, '0');
    var mi = String(d.getMinutes()).padStart(2, '0');
    return mm + '/' + dd + ' ' + hh + ':' + mi;
  }

  function selectedCount() {
    return Object.keys(selectedIds).length;
  }

  function syncSelectChrome() {
    var view = el('galleryView');
    var btn = el('galleryMenuBtn');
    var bar = el('gallerySelectBar');
    var countEl = el('gallerySelectCount');
    if (view) view.classList.toggle('is-selecting', selectMode);
    if (btn) {
      btn.classList.toggle('is-active', selectMode);
      btn.setAttribute('aria-pressed', selectMode ? 'true' : 'false');
      btn.title = selectMode ? '完成多选' : '多选';
      btn.setAttribute('aria-label', selectMode ? '完成多选' : '多选');
    }
    if (bar) bar.classList.toggle('hidden', !selectMode);
    if (countEl) countEl.textContent = selectedCount() + ' selected';
  }

  function setSelectMode(on) {
    selectMode = !!on;
    if (!selectMode) selectedIds = {};
    syncSelectChrome();
    // 重绘勾选态
    var grid = el('galleryGrid');
    if (!grid) return;
    grid.querySelectorAll('.gallery-card').forEach(function (card) {
      var id = card.dataset.artId;
      card.classList.toggle('is-selected', !!(id && selectedIds[id]));
      var check = card.querySelector('.gallery-card-check');
      if (check) check.hidden = !selectMode;
    });
  }

  function toggleCard(id, card) {
    if (!id) return;
    if (selectedIds[id]) delete selectedIds[id];
    else selectedIds[id] = true;
    if (card) card.classList.toggle('is-selected', !!selectedIds[id]);
    syncSelectChrome();
  }

  async function deleteSelected() {
    var ids = Object.keys(selectedIds);
    if (!ids.length || !window.GalleryStore) return;
    for (var i = 0; i < ids.length; i++) {
      await window.GalleryStore.delete(ids[i]);
    }
    selectedIds = {};
    await render();
    syncSelectChrome();
  }

  async function render() {
    var grid = el('galleryGrid');
    if (!grid) return;

    revokeUrls();
    grid.innerHTML = '';

    if (!window.GalleryStore) return;

    var list = await window.GalleryStore.list();
    if (!list.length) {
      setSelectMode(false);
      return;
    }

    list.forEach(function (art) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'gallery-card' + (selectedIds[art.id] ? ' is-selected' : '');
      card.dataset.artId = art.id;
      card.title = (art.title || 'Artwork') + ' · ' + formatWhen(art.createdAt);

      var check = document.createElement('span');
      check.className = 'gallery-card-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '✓';
      check.hidden = !selectMode;
      card.appendChild(check);

      if (art.imageBlob) {
        var url = URL.createObjectURL(art.imageBlob);
        objectUrls.push(url);
        var img = document.createElement('img');
        img.className = 'gallery-card-img';
        img.src = url;
        img.alt = art.title || 'Artwork';
        img.draggable = false;
        card.appendChild(img);
      }

      card.addEventListener('click', function () {
        if (!selectMode) return;
        toggleCard(art.id, card);
      });

      grid.appendChild(card);
    });

    syncSelectChrome();
  }

  function bind() {
    var menu = el('galleryMenuBtn');
    if (menu && !menu.dataset.bound) {
      menu.dataset.bound = '1';
      menu.addEventListener('click', function () {
        setSelectMode(!selectMode);
      });
    }

    var del = el('galleryDeleteBtn');
    if (del && !del.dataset.bound) {
      del.dataset.bound = '1';
      del.addEventListener('click', function () {
        if (!selectedCount()) return;
        deleteSelected();
      });
    }

    document.addEventListener('piko:screen', function (event) {
      if (!event.detail) return;
      if (event.detail.screen === 'gallery') {
        render();
      } else {
        setSelectMode(false);
      }
    });
  }

  window.PikoGalleryScreen = { render: render, setSelectMode: setSelectMode };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
