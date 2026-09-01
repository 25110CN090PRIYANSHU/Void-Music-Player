// =====================================================
// VOID MUSIC PLAYER — MAX EDITION
// Local library + YouTube IFrame playback
// =====================================================

const $ = (id) => document.getElementById(id);

const searchInput = $("searchInput"),
  searchButton = $("searchButton"),
  searchSuggestions = $("searchSuggestions");
const resultsContainer = $("results"),
  loading = $("loading"),
  errorMessage = $("errorMessage");
const sectionTitle = $("sectionTitle"),
  sectionLabel = $("sectionLabel"),
  resultActions = $("resultActions");
const exploreButton = $("exploreButton"),
  themeButton = $("themeButton"),
  settingsNav = $("settingsNav");
const mobileMenuButton = $("mobileMenuButton");
const mobileNavOverlay = $("mobileNavOverlay");
const mobileSidebar = document.querySelector(".sidebar");
const playResultsButton = $("playResultsButton"),
  shuffleResultsButton = $("shuffleResultsButton");
const playButton = $("playButton"),
  previousButton = $("previousButton"),
  nextButton = $("nextButton");
const shuffleButton = $("shuffleButton"),
  repeatButton = $("repeatButton"),
  volume = $("volume"),
  muteButton = $("muteButton");
const progress = $("progress"),
  currentTime = $("currentTime"),
  duration = $("duration");
const playerTitle = $("playerTitle"),
  playerArtist = $("playerArtist"),
  playerThumbnail = $("playerThumbnail");
const favoriteButton = $("favoriteButton"),
  playingIndicator = $("playingIndicator"),
  nowPlaying = $("nowPlaying");
const queueOpenButton = $("queueOpenButton"),
  fullscreenPlayerButton = $("fullscreenPlayerButton"),
  playerMoreButton = $("playerMoreButton");
const queuePanel = $("queuePanel"),
  queueOverlay = $("queueOverlay"),
  closeQueue = $("closeQueue"),
  queueList = $("queueList"),
  queueCount = $("queueCount"),
  clearQueue = $("clearQueue");
const nowPlayingModal = $("nowPlayingModal"),
  modalThumbnail = $("modalThumbnail"),
  modalTitle = $("modalTitle"),
  modalArtist = $("modalArtist");
const modalProgress = $("modalProgress"),
  modalCurrent = $("modalCurrent"),
  modalDuration = $("modalDuration");
const modalPlay = $("modalPlay"),
  modalPrev = $("modalPrev"),
  modalNext = $("modalNext"),
  modalShuffle = $("modalShuffle"),
  modalRepeat = $("modalRepeat");
const lyricsModal = $("lyricsModal"),
  lyricsTitle = $("lyricsTitle"),
  lyricsText = $("lyricsText");
const contextMenu = $("contextMenu"),
  toastContainer = $("toastContainer");
const playlistModal = $("playlistModal"),
  playlistNameInput = $("playlistNameInput"),
  savePlaylistButton = $("savePlaylistButton");
const addToPlaylistModal = $("addToPlaylistModal"),
  addPlaylistSongTitle = $("addPlaylistSongTitle"),
  playlistChoices = $("playlistChoices");
const shortcutsModal = $("shortcutsModal");
const profileMenu = $("profileMenu"),
  profileInitial = $("profileInitial"),
  profileAvatarLarge = $("profileAvatarLarge"),
  profileName = $("profileName"),
  profileEmail = $("profileEmail"),
  avatarInput = $("avatarInput"),
  logoutButton = $("logoutButton");

async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "/login.html";
  }
}

let songs = [];
let currentIndex = -1;
let currentSong = null;
let player = null;
let playerReady = false;
let isPlaying = false;
let isShuffle = false;
let repeatMode = "off"; // off | all | one
let isMuted = false;
let previousVolume = 80;
let progressTimer = null;
let activePage = "home";
let activeCollection = "search";
let activeContextSong = null;
let queue = load("voidQueue", []);
let favorites = load("voidFavorites", []);
let recent = load("voidRecent", []);
let searchHistory = load("voidSearchHistory", []);
let playlists = load("voidPlaylists", {});
let settings = Object.assign(
  { theme: "dark", autoplayQueue: true, rememberVolume: true },
  load("voidSettings", {}),
);

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function userInitial(name = "P") {
  return name.trim().split(/\s+/)[0]?.charAt(0).toUpperCase() || "P";
}
function updateProfileUI(user) {
  if (!user) return;
  const initial = userInitial(user.name || user.email);
  profileInitial.textContent = initial;
  profileAvatarLarge.textContent = initial;
  profileName.textContent = user.name || user.email.split("@")[0];
  profileEmail.textContent = user.email;
  const image = localStorage.getItem(`voidProfileImage:${user.id}`);
  [profileInitial, profileAvatarLarge].forEach((el) => {
    el.style.backgroundImage = image ? `url("${image}")` : "";
    el.classList.toggle("has-image", Boolean(image));
  });
}
async function loadProfile() {
  try {
    const response = await fetch("/api/auth/me");
    if (!response.ok) return;
    const data = await response.json();
    localStorage.setItem("voidUser", JSON.stringify(data.user));
    updateProfileUI(data.user);
  } catch {
    try {
      updateProfileUI(JSON.parse(localStorage.getItem("voidUser")));
    } catch {}
  }
}
function escapeHTML(v) {
  const d = document.createElement("div");
  d.textContent = v ?? "";
  return d.innerHTML;
}
function cleanTitle(t = "") {
  return t
    .replace(/\s*\([^)]*(official|video|audio|lyrics|lyric)[^)]*\)/gi, "")
    .replace(/\s*\[[^\]]*(official|video|audio|lyrics|lyric)[^\]]*\]/gi, "")
    .trim();
}
function formatTime(sec) {
  sec = Math.floor(sec || 0);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
function showToast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 250);
  }, 2200);
}
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.remove("hidden");
}
function hideError() {
  errorMessage.classList.add("hidden");
}
function showLoading(v) {
  loading.classList.toggle("hidden", !v);
}
function persistAll() {
  save("voidFavorites", favorites);
  save("voidQueue", queue);
  save("voidRecent", recent);
  save("voidPlaylists", playlists);
  save("voidSettings", settings);
}

function songKey(song) {
  return song?.id || "";
}
function isFavorite(song) {
  return !!song && favorites.some((x) => x.id === song.id);
}
function addFavorite(song) {
  if (!song?.id) return;
  if (!isFavorite(song)) {
    favorites.unshift(normalizeSong(song));
    save("voidFavorites", favorites);
    showToast("Added to Favorites ♥");
  }
  updateFavoriteButton();
  updateBadges();
  renderFavoritesIfOpen();
}
function removeFavorite(song) {
  favorites = favorites.filter((x) => x.id !== song.id);
  save("voidFavorites", favorites);
  updateFavoriteButton();
  updateBadges();
  renderFavoritesIfOpen();
  showToast("Removed from Favorites");
}
function toggleFavorite(song) {
  isFavorite(song) ? removeFavorite(song) : addFavorite(song);
}

function normalizeSong(song) {
  return {
    id: song.id,
    title: song.title || "Unknown title",
    channel: song.channel || "YouTube",
    thumbnail:
      song.thumbnail || `https://i.ytimg.com/vi/${song.id}/hqdefault.jpg`,
    publishedAt: song.publishedAt || "",
  };
}

function addToQueue(song) {
  if (!song?.id) return;
  if (queue.some((x) => x.id === song.id)) {
    showToast("Already in queue");
    return;
  }
  queue.push(normalizeSong(song));
  save("voidQueue", queue);
  renderQueue();
  updateBadges();
  showToast("Added to queue");
}
function removeQueueAt(i) {
  if (i < 0 || i >= queue.length) return;
  queue.splice(i, 1);
  save("voidQueue", queue);
  renderQueue();
  updateBadges();
  showToast("Removed from queue");
}
function moveQueue(i, j) {
  if (j < 0 || j >= queue.length) return;
  const [x] = queue.splice(i, 1);
  queue.splice(j, 0, x);
  save("voidQueue", queue);
  renderQueue();
}
function clearQueueAll() {
  queue = [];
  save("voidQueue", queue);
  renderQueue();
  updateBadges();
  showToast("Queue cleared");
}

function addRecent(song) {
  if (!song?.id) return;
  recent = recent.filter((x) => x.id !== song.id);
  recent.unshift({ ...normalizeSong(song), playedAt: Date.now() });
  recent = recent.slice(0, 50);
  save("voidRecent", recent);
  if (activePage === "recent") renderRecent();
}

function createPlaylist(name) {
  const clean = name.trim();
  if (!clean) return;
  if (playlists[clean]) {
    showToast("A playlist with that name already exists");
    return;
  }
  playlists[clean] = [];
  save("voidPlaylists", playlists);
  closeAllModals();
  renderPlaylists();
  showToast(`Created "${clean}"`);
}
function addSongToPlaylist(name, song) {
  if (!playlists[name]) return;
  if (playlists[name].some((x) => x.id === song.id)) {
    showToast("Song already in playlist");
    return;
  }
  playlists[name].push(normalizeSong(song));
  save("voidPlaylists", playlists);
  closeAllModals();
  renderPlaylists();
  showToast(`Added to ${name}`);
}
function deletePlaylist(name) {
  delete playlists[name];
  save("voidPlaylists", playlists);
  renderPlaylists();
  showToast("Playlist deleted");
}
function playCollection(collection, index = 0, shuffle = false) {
  if (!collection?.length) {
    showToast("Nothing to play");
    return;
  }
  activeCollection = "custom";
  currentIndex = shuffle
    ? Math.floor(Math.random() * collection.length)
    : index;
  const song = collection[currentIndex];
  songs = [...collection];
  playSong(currentIndex);
}

window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player("youtubePlayer", {
    height: "1",
    width: "1",
    videoId: "",
    playerVars: {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      modestbranding: 1,
      rel: 0,
    },
    events: {
      onReady: handlePlayerReady,
      onStateChange: handlePlayerState,
      onError: handlePlayerError,
    },
  });
};
function handlePlayerReady(event) {
  playerReady = true;
  const saved = settings.rememberVolume
    ? Number(localStorage.getItem("voidVolume") || 80)
    : 80;
  volume.value = saved;
  previousVolume = saved;
  event.target.setVolume(saved);
  updateMuteIcon();
}
function handlePlayerState(event) {
  if (!window.YT) return;
  switch (event.data) {
    case YT.PlayerState.PLAYING:
      setPlayingUI(true);
      startProgressUpdater();
      break;
    case YT.PlayerState.BUFFERING:
      // Keep the clock alive while YouTube is buffering; the API can expose
      // advancing time before it sends PLAYING again.
      startProgressUpdater();
      break;
    case YT.PlayerState.PAUSED:
      setPlayingUI(false);
      stopProgressUpdater();
      break;
    case YT.PlayerState.ENDED:
      setPlayingUI(false);
      stopProgressUpdater();
      progress.value = 0;
      modalProgress.value = 0;
      currentTime.textContent = "0:00";
      modalCurrent.textContent = "0:00";
      if (repeatMode === "one") {
        playCurrent();
        return;
      }
      if (settings.autoplayQueue && queue.length) {
        const idx = queue.findIndex((x) => x.id === currentSong?.id);
        const nextIdx = idx >= 0 ? idx + 1 : 0;
        if (nextIdx < queue.length) {
          playQueueSong(nextIdx);
          return;
        }
      }
      nextSong();
      break;
  }
}
function setPlayingUI(playing) {
  isPlaying = playing;
  playButton.textContent = playing ? "❚❚" : "▶";
  modalPlay.textContent = playing ? "❚❚" : "▶";
  nowPlaying.classList.toggle("playing", playing);
  [modalShuffle, shuffleButton].forEach((b) =>
    b.classList.toggle("active", isShuffle),
  );
  [modalRepeat, repeatButton].forEach((b) =>
    b.classList.toggle("active", repeatMode !== "off"),
  );
}
function handlePlayerError(event) {
  console.error("YouTube player error:", event.data);
  stopProgressUpdater();
  showError("This video cannot be played. Try another result.");
  setPlayingUI(false);
}

async function searchSongs() {
  const query = searchInput.value.trim();
  if (!query) {
    searchInput.focus();
    return;
  }
  showLoading(true);
  hideError();
  resultsContainer.innerHTML = "";
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Search failed");
    searchHistory = [
      query,
      ...searchHistory.filter(
        (item) => item.toLowerCase() !== query.toLowerCase(),
      ),
    ].slice(0, 8);
    save("voidSearchHistory", searchHistory);
    songs = data.results || [];
    activeCollection = "search";
    currentIndex = -1;
    sectionLabel.textContent = "SEARCH RESULTS";
    sectionTitle.textContent = `Results for "${query}"`;
    resultActions.classList.toggle("hidden", !songs.length);
    renderSongs();
    showPage("home");
  } catch (e) {
    console.error(e);
    showError(e.message || "Something went wrong");
  } finally {
    showLoading(false);
  }
}
function renderSongs() {
  resultsContainer.innerHTML = "";
  if (!songs.length) {
    resultsContainer.innerHTML = `<div class="empty-state"><div class="empty-icon">⌕</div><h3>No songs found</h3><p>Try another artist, song or album.</p></div>`;
    return;
  }
  songs.forEach((song, index) =>
    resultsContainer.appendChild(createSongCard(song, index)),
  );
}
function createSongCard(song, index) {
  const card = document.createElement("article");
  card.className = "song-card";
  card.innerHTML = `<img class="song-thumbnail" src="${escapeHTML(song.thumbnail)}" alt="">
      <div class="card-actions">
        <button class="card-action favorite-card-action ${isFavorite(song) ? "favorited" : ""}" title="Favorite">${isFavorite(song) ? "♥" : "♡"}</button>
        <button class="card-action queue-card-action" title="Add to queue">＋</button>
        <button class="card-action playlist-card-action" title="Add to playlist">▣</button>
      </div>
      <div class="song-info"><div class="song-title">${escapeHTML(cleanTitle(song.title))}</div><span class="song-channel">${escapeHTML(song.channel)}</span></div>`;
  card.addEventListener("click", () => playSong(index));
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openContextMenu(song, e.clientX, e.clientY);
  });
  card.querySelector(".favorite-card-action").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(song);
    renderSongs();
  });
  card.querySelector(".queue-card-action").addEventListener("click", (e) => {
    e.stopPropagation();
    addToQueue(song);
  });
  card.querySelector(".playlist-card-action").addEventListener("click", (e) => {
    e.stopPropagation();
    openAddToPlaylist(song);
  });
  return card;
}

function playSong(index) {
  if (index < 0 || index >= songs.length) return;
  if (!playerReady) {
    showError("YouTube player is still loading. Please try again.");
    return;
  }
  currentIndex = index;
  currentSong = normalizeSong(songs[index]);
  playerTitle.textContent = cleanTitle(currentSong.title);
  playerArtist.textContent = currentSong.channel;
  playerThumbnail.src = currentSong.thumbnail;
  modalTitle.textContent = cleanTitle(currentSong.title);
  modalArtist.textContent = currentSong.channel;
  modalThumbnail.src = currentSong.thumbnail;
  progress.value = 0;
  modalProgress.value = 0;
  setRangeProgress(progress, 0);
  setRangeProgress(modalProgress, 0);
  currentTime.textContent = "0:00";
  modalCurrent.textContent = "0:00";
  duration.textContent = "0:00";
  modalDuration.textContent = "0:00";
  updateFavoriteButton();
  addRecent(currentSong);
  player.loadVideoById(currentSong.id);
  setPlayingUI(true);
  // YouTube may emit PLAYING before duration metadata is available.
  startProgressUpdater();
}
function playCurrent() {
  if (currentIndex === -1) {
    if (songs.length) playSong(0);
    return;
  }
  if (playerReady && currentSong) player.loadVideoById(currentSong.id);
}
function nextSong() {
  if (!songs.length) return;
  let next;
  if (isShuffle) next = Math.floor(Math.random() * songs.length);
  else next = (currentIndex + 1) % songs.length;
  if (songs.length > 1 && next === currentIndex)
    next = (next + 1) % songs.length;
  playSong(next);
}
function previousSong() {
  if (!songs.length) return;
  if (playerReady && player.getCurrentTime() > 3) {
    player.seekTo(0, true);
    return;
  }
  let prev = (currentIndex - 1 + songs.length) % songs.length;
  playSong(prev);
}
function playQueueSong(index) {
  if (index < 0 || index >= queue.length) return;
  const target = queue[index];
  const existing = songs.findIndex((x) => x.id === target.id);
  if (existing >= 0) {
    playSong(existing);
    return;
  }
  songs = [target];
  activeCollection = "queue";
  currentIndex = 0;
  playSong(0);
}
function nextFromQueue() {
  if (!queue.length) {
    nextSong();
    return;
  }
  const idx = queue.findIndex((x) => x.id === currentSong?.id);
  if (idx >= 0 && idx + 1 < queue.length) {
    playQueueSong(idx + 1);
    return;
  }
  playQueueSong(0);
}

playButton.addEventListener("click", () => {
  if (!playerReady) return;
  if (currentIndex === -1) {
    if (songs.length) playSong(0);
    return;
  }
  isPlaying ? player.pauseVideo() : player.playVideo();
});
nextButton.addEventListener("click", nextSong);
previousButton.addEventListener("click", previousSong);
shuffleButton.addEventListener("click", toggleShuffle);
repeatButton.addEventListener("click", cycleRepeat);
modalPlay.addEventListener("click", () => playButton.click());
modalNext.addEventListener("click", nextSong);
modalPrev.addEventListener("click", previousSong);
modalShuffle.addEventListener("click", toggleShuffle);
modalRepeat.addEventListener("click", cycleRepeat);
function toggleShuffle() {
  isShuffle = !isShuffle;
  setPlayingUI(isPlaying);
  showToast(isShuffle ? "Shuffle on" : "Shuffle off");
}
function cycleRepeat() {
  repeatMode =
    repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
  repeatButton.title = `Repeat: ${repeatMode}`;
  showToast(`Repeat ${repeatMode}`);
  setPlayingUI(isPlaying);
}

favoriteButton.addEventListener(
  "click",
  () => currentSong && toggleFavorite(currentSong),
);
volume.addEventListener("input", () => {
  const v = Number(volume.value);
  if (v > 0) previousVolume = v;
  if (playerReady) {
    player.unMute();
    player.setVolume(v);
  }
  isMuted = v === 0;
  if (settings.rememberVolume) localStorage.setItem("voidVolume", v);
  updateMuteIcon();
});
muteButton.addEventListener("click", () => {
  if (!playerReady) return;
  if (isMuted || Number(volume.value) === 0) {
    const v = previousVolume || 80;
    volume.value = v;
    player.unMute();
    player.setVolume(v);
    isMuted = false;
  } else {
    previousVolume = Number(volume.value) || 80;
    volume.value = 0;
    player.mute();
    isMuted = true;
  }
  updateMuteIcon();
});
function updateMuteIcon() {
  const v = Number(volume.value);
  muteButton.textContent = isMuted || v === 0 ? "🔇" : v < 50 ? "🔉" : "🔊";
  muteButton.title = isMuted ? "Unmute" : "Mute";
}
function changeVolume(amount) {
  let v = Math.max(0, Math.min(100, Number(volume.value) + amount));
  volume.value = v;
  if (playerReady) {
    player.unMute();
    player.setVolume(v);
  }
  isMuted = v === 0;
  if (v > 0) previousVolume = v;
  if (settings.rememberVolume) localStorage.setItem("voidVolume", v);
  updateMuteIcon();
}

function startProgressUpdater() {
  stopProgressUpdater();
  updateProgress();
  progressTimer = setInterval(updateProgress, 400);
}
function stopProgressUpdater() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}
function updateProgress() {
  if (!playerReady || !currentSong) return;
  let total = 0;
  let cur = 0;
  try {
    total = Number(player.getDuration()) || 0;
    cur = Number(player.getCurrentTime()) || 0;
  } catch {
    return;
  }
  if (!total || !Number.isFinite(total)) return;
  const pct = Math.min(100, Math.max(0, (cur / total) * 100));
  progress.value = pct;

  modalProgress.value = pct;
  setRangeProgress(progress, pct);
  setRangeProgress(modalProgress, pct);
  currentTime.textContent = formatTime(cur);
  duration.textContent = formatTime(total);
  modalCurrent.textContent = formatTime(cur);
  modalDuration.textContent = formatTime(total);
}
function setRangeProgress(range, pct) {
  if (!range) return;
  const active =
    getComputedStyle(document.body).getPropertyValue("--text").trim() || "#fff";
  range.style.background = `linear-gradient(to right, ${active} 0%, ${active} ${pct}%, #333 ${pct}%, #333 100%)`;
}
function seekFromRange(value) {
  if (!playerReady || currentIndex === -1) return;
  const total = player.getDuration();
  if (total) player.seekTo((Number(value) / 100) * total, true);
}
progress.addEventListener("input", () => {
  if (playerReady && currentIndex !== -1) {
    const total = player.getDuration();
    if (total) {
      const t = (Number(progress.value) / 100) * total;
      currentTime.textContent = formatTime(t);
      setRangeProgress(progress, Number(progress.value));
    }
  }
});
progress.addEventListener("change", () => seekFromRange(progress.value));
modalProgress.addEventListener("input", () => {
  modalProgress.value = progress.value;
  progress.value = modalProgress.value;
  setRangeProgress(progress, Number(progress.value));
  setRangeProgress(modalProgress, Number(modalProgress.value));
  const total = playerReady ? player.getDuration() : 0;
  if (total)
    modalCurrent.textContent = formatTime(
      (Number(modalProgress.value) / 100) * total,
    );
});
modalProgress.addEventListener("change", () =>
  seekFromRange(modalProgress.value),
);

function updateFavoriteButton() {
  const yes = currentSong && isFavorite(currentSong);
  favoriteButton.textContent = yes ? "♥" : "♡";
  favoriteButton.classList.toggle("favorited", yes);
  favoriteButton.title = yes ? "Remove from Favorites" : "Add to Favorites";
}
function updateBadges() {
  $("favoriteBadge").textContent = favorites.length;
  $("queueBadge").textContent = queue.length;
  queueCount.textContent = `${queue.length} ${queue.length === 1 ? "song" : "songs"}`;
}

function renderQueue() {
  updateBadges();
  queueList.innerHTML = "";
  if (!queue.length) {
    queueList.innerHTML = `<div class="empty-state"><div class="empty-icon">♫</div><h3>Queue is empty</h3><p>Add songs from search results or the player.</p></div>`;
    return;
  }
  queue.forEach((song, i) => {
    const row = document.createElement("div");
    row.className =
      "queue-row" + (song.id === currentSong?.id ? " current" : "");
    row.innerHTML = `<span class="queue-number">${i + 1}</span><img src="${escapeHTML(song.thumbnail)}" alt=""><div class="q-info"><div class="q-title">${escapeHTML(cleanTitle(song.title))}</div><div class="q-sub">${escapeHTML(song.channel)}</div></div><div class="q-actions"><button class="q-action" title="Up">↑</button><button class="q-action" title="Down">↓</button><button class="q-action" title="Remove">×</button></div>`;
    row.addEventListener("click", (e) => {
      if (e.target.closest(".q-action")) return;
      playQueueSong(i);
    });
    row.querySelectorAll(".q-action")[0].addEventListener("click", (e) => {
      e.stopPropagation();
      moveQueue(i, i - 1);
    });
    row.querySelectorAll(".q-action")[1].addEventListener("click", (e) => {
      e.stopPropagation();
      moveQueue(i, i + 1);
    });
    row.querySelectorAll(".q-action")[2].addEventListener("click", (e) => {
      e.stopPropagation();
      removeQueueAt(i);
    });
    queueList.appendChild(row);
  });
}
function openQueue() {
  renderQueue();
  queuePanel.classList.add("open");
  queueOverlay.classList.add("open");
}
function closeQueuePanel() {
  queuePanel.classList.remove("open");
  queueOverlay.classList.remove("open");
}
queueOpenButton.addEventListener("click", openQueue);
closeQueue.addEventListener("click", closeQueuePanel);
queueOverlay.addEventListener("click", closeQueuePanel);
clearQueue.addEventListener("click", clearQueueAll);

function renderLibraryList(
  container,
  items,
  emptyTitle,
  emptyText,
  emptyIcon = "♡",
  allowRemove = true,
) {
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emptyIcon}</div><h3>${emptyTitle}</h3><p>${emptyText}</p></div>`;
    return;
  }
  items.forEach((song, i) => {
    const row = document.createElement("div");
    row.className = "library-row";
    row.innerHTML = `<span class="row-number">${i + 1}</span><img class="row-thumb" src="${escapeHTML(song.thumbnail)}" alt=""><div class="row-main"><div class="row-title">${escapeHTML(cleanTitle(song.title))}</div><div class="row-sub">${escapeHTML(song.channel)}</div></div><div class="row-actions"><button class="row-action play-row" title="Play">▶</button><button class="row-action queue-row-btn" title="Queue">＋</button><button class="row-action playlist-row-btn" title="Add to playlist">▣</button>${allowRemove ? '<button class="row-action remove-row" title="Remove">×</button>' : ""}</div>`;
    row
      .querySelector(".play-row")
      .addEventListener("click", () => playCollection(items, i));
    row
      .querySelector(".queue-row-btn")
      .addEventListener("click", () => addToQueue(song));
    row
      .querySelector(".playlist-row-btn")
      .addEventListener("click", () => openAddToPlaylist(song));
    if (allowRemove)
      row.querySelector(".remove-row").addEventListener("click", () => {
        removeLibraryItem(container, song);
      });
    row.addEventListener("dblclick", () => playCollection(items, i));
    container.appendChild(row);
  });
}
function removeLibraryItem(container, song) {
  if (container === $("favoritesList")) removeFavorite(song);
  else if (container === $("recentList")) {
    recent = recent.filter((x) => x.id !== song.id);
    save("voidRecent", recent);
    renderRecent();
    showToast("Removed from history");
  }
}
function removeSearchHistory(query) {
  searchHistory = searchHistory.filter((item) => item !== query);
  save("voidSearchHistory", searchHistory);
  renderSearchSuggestions();
  showToast("Search removed");
}
function renderFavorites() {
  $("favoritesSubtitle").textContent =
    `${favorites.length} ${favorites.length === 1 ? "saved song" : "saved songs"}`;
  renderLibraryList(
    $("favoritesList"),
    favorites,
    "No favorites yet",
    "Click the heart on any song to save it here.",
    "♥",
    true,
  );
}
function renderFavoritesIfOpen() {
  if (activePage === "favorites") renderFavorites();
}
function renderRecent() {
  $("recentSubtitle").textContent = `${recent.length} songs`;
  renderLibraryList(
    $("recentList"),
    recent,
    "No listening history yet",
    "Play a song and it will appear here.",
    "◷",
    true,
  );
}
function renderQueuePage() {
  $("queueSubtitle").textContent = `${queue.length} songs`;
  renderLibraryList(
    $("queuePageList"),
    queue,
    "Queue is empty",
    "Add songs from search results.",
    "♫",
    false,
  );
}

function renderPlaylists() {
  const grid = $("playlistsGrid");
  grid.innerHTML = "";
  const names = Object.keys(playlists);
  if (!names.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">▣</div><h3>No playlists</h3><p>Create your first playlist to start organizing music.</p></div>`;
    return;
  }
  names.forEach((name) => {
    const items = playlists[name];
    const card = document.createElement("div");
    card.className = "playlist-card";
    card.innerHTML = `<div class="playlist-art">♫</div><h3>${escapeHTML(name)}</h3><p>${items.length} ${items.length === 1 ? "song" : "songs"}</p><div class="playlist-actions"><button class="secondary-button play-pl">▶ Play</button><button class="secondary-button del-pl">Delete</button></div>`;
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      openPlaylist(name);
    });
    card.querySelector(".play-pl").addEventListener("click", () => {
      if (items.length) playCollection(items, 0, false);
      else showToast("Playlist is empty");
    });
    card.querySelector(".del-pl").addEventListener("click", () => {
      if (confirm(`Delete "${name}"?`)) deletePlaylist(name);
    });
    grid.appendChild(card);
  });
}
function openPlaylist(name) {
  const items = playlists[name] || [];
  showToast(`${name}: ${items.length} songs`);
  if (items.length) playCollection(items, 0, false);
}
function openCreatePlaylist() {
  playlistNameInput.value = "";
  playlistModal.classList.remove("hidden");
  setTimeout(() => playlistNameInput.focus(), 50);
}
function openAddToPlaylist(song) {
  activeContextSong = song;
  addPlaylistSongTitle.textContent = cleanTitle(song.title);
  playlistChoices.innerHTML = "";
  const names = Object.keys(playlists);
  if (!names.length) {
    playlistChoices.innerHTML = `<div class="empty-state"><p>Create a playlist first.</p></div>`;
  }
  names.forEach((name) => {
    const b = document.createElement("button");
    b.className = "playlist-choice";
    b.innerHTML = `<span>${escapeHTML(name)}</span><span>${playlists[name].length} songs</span>`;
    b.addEventListener("click", () => addSongToPlaylist(name, song));
    playlistChoices.appendChild(b);
  });
  addToPlaylistModal.classList.remove("hidden");
}

function showPage(page) {
  activePage = page;
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active-page"));
  const target = $(`${page}Page`);
  if (target) target.classList.add("active-page");
  document
    .querySelectorAll(".nav-item[data-page]")
    .forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  if (page === "favorites") renderFavorites();
  if (page === "recent") renderRecent();
  if (page === "queue") {
    renderQueuePage();
    openQueue();
  }
  if (page === "playlists") renderPlaylists();
  if (page === "home") {
  }
  closeMobileMenu();
}
document
  .querySelectorAll(".nav-item[data-page]")
  .forEach((btn) =>
    btn.addEventListener("click", () => showPage(btn.dataset.page)),
  );
settingsNav.addEventListener("click", () => showPage("settings"));

function openMobileMenu() {
  mobileSidebar.classList.add("mobile-open");
  mobileNavOverlay.classList.add("open");
  mobileMenuButton.setAttribute("aria-expanded", "true");
  document.body.classList.add("menu-open");
}
function closeMobileMenu() {
  mobileSidebar.classList.remove("mobile-open");
  mobileNavOverlay.classList.remove("open");
  mobileMenuButton.setAttribute("aria-expanded", "false");
  document.body.classList.remove("menu-open");
}
mobileMenuButton.addEventListener("click", () => {
  mobileSidebar.classList.contains("mobile-open")
    ? closeMobileMenu()
    : openMobileMenu();
});
mobileNavOverlay.addEventListener("click", closeMobileMenu);

function renderSearchSuggestions() {
  const q = searchInput.value.trim().toLowerCase();
  searchSuggestions.innerHTML = "";
  if (!q) {
    renderSearchHistorySuggestions();
    return;
  }
  const pool = [...recent, ...favorites];
  const seen = new Set();
  const matches = [];
  searchHistory.forEach((query) => {
    if (query.toLowerCase().includes(q) && !seen.has(query)) {
      seen.add(query);
      matches.push({
        title: query,
        channel: "Search history",
        historyQuery: query,
      });
    }
  });
  pool.forEach((s) => {
    const t = `${s.title} ${s.channel}`.toLowerCase();
    if (t.includes(q) && !seen.has(s.title)) {
      seen.add(s.title);
      matches.push(s);
    }
  });
  [
    ["Bollywood songs", "latest Bollywood songs"],
    ["Hindi songs", "latest Hindi songs"],
    ["English pop", "popular English pop songs"],
    ["Lo-fi music", "lofi chill beats"],
    ["Workout music", "workout music mix"],
    ["Devotional music", "latest devotional songs"],
    ["Hip-hop and rap", "best hip hop rap songs"],
    ["Classical piano", "best classical piano music"],
  ].forEach(([label, query]) => {
    if (
      label.toLowerCase().includes(q) &&
      !matches.some((item) => item.historyQuery === query)
    ) {
      matches.push({
        title: label,
        channel: "Suggested search",
        historyQuery: query,
        keywordSuggestion: true,
      });
    }
  });
  if (!matches.length) {
    searchSuggestions.classList.add("hidden");
    return;
  }
  matches.slice(0, 6).forEach((s) => {
    const d = document.createElement("div");
    d.className = `suggestion${s.historyQuery && !s.keywordSuggestion ? " history-suggestion" : ""}`;
    if (s.historyQuery) {
      if (s.keywordSuggestion) {
        d.textContent = `⌕ ${s.title}`;
      } else {
        d.innerHTML = `<span>◷ ${escapeHTML(s.historyQuery)}</span><button class="history-delete" type="button" aria-label="Delete search">×</button>`;
        d.querySelector(".history-delete").addEventListener(
          "click",
          (event) => {
            event.stopPropagation();
            removeSearchHistory(s.historyQuery);
          },
        );
      }
    } else {
      d.textContent = `${cleanTitle(s.title)} — ${s.channel}`;
    }
    d.addEventListener("click", () => {
      searchInput.value = s.historyQuery || cleanTitle(s.title);
      searchSuggestions.classList.add("hidden");
      searchSongs();
    });
    searchSuggestions.appendChild(d);
  });
  searchSuggestions.classList.remove("hidden");
}
function renderSearchHistorySuggestions() {
  if (!searchHistory.length) {
    searchSuggestions.classList.add("hidden");
    return;
  }
  searchSuggestions.innerHTML = "";
  searchHistory.slice(0, 5).forEach((query) => {
    const d = document.createElement("div");
    d.className = "suggestion history-suggestion";
    d.setAttribute("role", "button");
    d.tabIndex = 0;
    d.innerHTML = `<span>◷ ${escapeHTML(query)}</span><button class="history-delete" type="button" aria-label="Delete search">×</button>`;
    d.querySelector(".history-delete").addEventListener("click", (event) => {
      event.stopPropagation();
      removeSearchHistory(query);
    });
    d.addEventListener("click", () => {
      searchInput.value = query;
      searchSuggestions.classList.add("hidden");
      searchSongs();
    });
    d.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") d.click();
    });
    searchSuggestions.appendChild(d);
  });
  const heading = document.createElement("div");
  heading.className = "suggestion-heading";
  heading.textContent = "SEARCH HISTORY";
  searchSuggestions.prepend(heading);
  searchSuggestions.classList.remove("hidden");
}
function getListeningTypes() {
  const text = [
    ...searchHistory,
    ...recent.map((song) => `${song.title} ${song.channel}`),
  ]
    .join(" ")
    .toLowerCase();
  const types = [
    [
      "Bollywood",
      "latest Bollywood songs",
      /bollywood|hindi|tollywood|tamil|telugu/gi,
    ],
    ["Pop", "popular pop songs", /pop|hits|top 50/gi],
    ["Lo-fi & chill", "lofi chill beats", /lofi|lo-fi|chill|study|focus/gi],
    ["Workout", "workout music mix", /workout|gym|fitness|motivation/gi],
    [
      "Devotional",
      "devotional music",
      /bhajan|devotional|mantra|qawwali|spiritual/gi,
    ],
    ["Hip-hop & rap", "hip hop rap songs", /hip.?hop|rap|trap|eminem/gi],
    ["Rock", "best rock songs", /rock|metal|punk/gi],
    ["Classical", "best classical piano music", /classical|piano|orchestra/gi],
  ];
  const ranked = types
    .map(([label, query, pattern]) => ({
      label,
      query,
      score: (text.match(pattern) || []).length,
    }))
    .sort((a, b) => b.score - a.score);
  const listened = ranked.filter((item) => item.score > 0).slice(0, 5);
  return listened.length
    ? listened
    : ranked.slice(0, 5).map(({ label, query }) => ({ label, query }));
}
function renderExploreSuggestions() {
  const suggestions = getListeningTypes();
  searchSuggestions.innerHTML = `<div class="suggestion-heading">YOUR LISTENING MIX</div>`;
  suggestions.forEach(({ label, query }) => {
    const d = document.createElement("button");
    d.className = "suggestion explore-suggestion";
    d.type = "button";
    d.innerHTML = `<span>${escapeHTML(label)}</span><small>${escapeHTML(query)}</small>`;
    d.addEventListener("click", () => {
      searchInput.value = query;
      searchSuggestions.classList.add("hidden");
      searchSongs();
    });
    searchSuggestions.appendChild(d);
  });
  searchSuggestions.classList.remove("hidden");
}
searchInput.addEventListener("input", renderSearchSuggestions);
searchInput.addEventListener("focus", renderSearchSuggestions);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    searchSuggestions.classList.add("hidden");
    searchSongs();
  }
});
searchButton.addEventListener("click", () => {
  searchSuggestions.classList.add("hidden");
  searchSongs();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-container"))
    searchSuggestions.classList.add("hidden");
});
exploreButton.addEventListener("click", () => {
  showPage("home");
  searchInput.focus();
  renderExploreSuggestions();
  document
    .querySelector(".header")
    .scrollIntoView({ behavior: "smooth", block: "start" });
});

playResultsButton.addEventListener("click", () =>
  playCollection(songs, 0, false),
);
shuffleResultsButton.addEventListener("click", () =>
  playCollection(songs, 0, true),
);
$("playFavoritesButton").addEventListener("click", () =>
  playCollection(favorites, 0, false),
);
$("shuffleFavoritesButton").addEventListener("click", () =>
  playCollection(favorites, 0, true),
);
$("clearRecentButton").addEventListener("click", () => {
  recent = [];
  save("voidRecent", recent);
  renderRecent();
  showToast("History cleared");
});
$("clearQueuePageButton").addEventListener("click", clearQueueAll);
$("createPlaylistButton").addEventListener("click", openCreatePlaylist);
savePlaylistButton.addEventListener("click", () =>
  createPlaylist(playlistNameInput.value),
);
playlistNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") createPlaylist(playlistNameInput.value);
});

function applyTheme() {
  document.body.classList.toggle("light-mode", settings.theme === "light");
  $("themeSelect").value = settings.theme;
}
themeButton.addEventListener("click", () => {
  settings.theme = settings.theme === "dark" ? "light" : "dark";
  save("voidSettings", settings);
  applyTheme();
});
$("themeSelect").addEventListener("change", (e) => {
  settings.theme = e.target.value;
  save("voidSettings", settings);
  applyTheme();
});
$("autoplayToggle").addEventListener("change", (e) => {
  settings.autoplayQueue = e.target.checked;
  save("voidSettings", settings);
});
$("rememberVolumeToggle").addEventListener("change", (e) => {
  settings.rememberVolume = e.target.checked;
  save("voidSettings", settings);
});
function initSettings() {
  $("autoplayToggle").checked = settings.autoplayQueue;
  $("rememberVolumeToggle").checked = settings.rememberVolume;
  applyTheme();
}

function openNowPlaying() {
  nowPlayingModal.classList.remove("hidden");
}
fullscreenPlayerButton.addEventListener("click", openNowPlaying);
$("openPlayerButton").addEventListener("click", openNowPlaying);
function openLyrics() {
  lyricsTitle.textContent = currentSong
    ? cleanTitle(currentSong.title)
    : "Lyrics";
  lyricsText.textContent = currentSong
    ? `Lyrics for "${cleanTitle(currentSong.title)}" are not automatically fetched by this build. Use the official YouTube video or connect a licensed lyrics provider.`
    : "Play a song first.";
  lyricsModal.classList.add("lyrics-fullscreen");
  lyricsModal.classList.remove("hidden");
}
$("lyricsButton").addEventListener("click", openLyrics);
$("modalQueueButton").addEventListener("click", () => {
  closeAllModals();
  openQueue();
});
$("shortcutsButton").addEventListener("click", () =>
  shortcutsModal.classList.remove("hidden"),
);
document
  .querySelectorAll("[data-close-modal]")
  .forEach((el) => el.addEventListener("click", closeAllModals));
function closeAllModals() {
  document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
}

$("clearFavoritesButton").addEventListener("click", () => {
  if (confirm("Clear all favorites?")) {
    favorites = [];
    save("voidFavorites", favorites);
    updateFavoriteButton();
    updateBadges();
    renderFavoritesIfOpen();
    showToast("Favorites cleared");
  }
});
$("profileButton").addEventListener("click", (event) => {
  event.stopPropagation();
  profileMenu.classList.toggle("hidden");
  $("profileButton").setAttribute(
    "aria-expanded",
    String(!profileMenu.classList.contains("hidden")),
  );
});
avatarInput.addEventListener("change", () => {
  const file = avatarInput.files?.[0];
  let user;
  try {
    user = JSON.parse(localStorage.getItem("voidUser"));
  } catch {}
  if (!file || !user) return;
  const reader = new FileReader();
  reader.onload = () => {
    localStorage.setItem(`voidProfileImage:${user.id}`, reader.result);
    updateProfileUI(user);
    showToast("Profile picture updated");
  };
  reader.readAsDataURL(file);
});
logoutButton.addEventListener("click", logout);
document.addEventListener("click", (event) => {
  if (
    !event.target.closest("#profileMenu") &&
    !event.target.closest("#profileButton")
  ) {
    profileMenu.classList.add("hidden");
    $("profileButton").setAttribute("aria-expanded", "false");
  }
});
$("resetAppButton").addEventListener("click", () => {
  if (!confirm("Reset all local VOID data?")) return;
  [
    "voidFavorites",
    "voidQueue",
    "voidRecent",
    "voidPlaylists",
    "voidSettings",
    "voidVolume",
  ].forEach((k) => localStorage.removeItem(k));
  location.reload();
});

function openContextMenu(song, x, y) {
  activeContextSong = song;
  contextMenu.style.left = Math.min(x, window.innerWidth - 210) + "px";
  contextMenu.style.top = Math.min(y, window.innerHeight - 220) + "px";
  contextMenu.classList.remove("hidden");
}
contextMenu.addEventListener("click", (e) => {
  const action = e.target.closest("button")?.dataset.action;
  if (!action || !activeContextSong) return;
  const s = activeContextSong;
  if (action === "favorite") toggleFavorite(s);
  if (action === "queue") addToQueue(s);
  if (action === "playlist") openAddToPlaylist(s);
  if (action === "play") {
    const idx = songs.findIndex((x) => x.id === s.id);
    if (idx >= 0) playSong(idx);
    else {
      songs = [s];
      currentIndex = 0;
      playSong(0);
    }
  }
  contextMenu.classList.add("hidden");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#contextMenu")) contextMenu.classList.add("hidden");
});
playerMoreButton.addEventListener("click", (e) => {
  if (currentSong) openContextMenu(currentSong, e.clientX, e.clientY);
});

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input,textarea,select")) return;
  if (e.key === "Escape") {
    closeAllModals();
    closeQueuePanel();
    contextMenu.classList.add("hidden");
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    playButton.click();
  }
  if (e.code === "ArrowLeft" && playerReady && currentIndex !== -1)
    player.seekTo(Math.max(0, player.getCurrentTime() - 5), true);
  if (e.code === "ArrowRight" && playerReady && currentIndex !== -1)
    player.seekTo(
      Math.min(player.getDuration(), player.getCurrentTime() + 5),
      true,
    );
  if (e.code === "ArrowUp") {
    e.preventDefault();
    changeVolume(5);
  }
  if (e.code === "ArrowDown") {
    e.preventDefault();
    changeVolume(-5);
  }
  if (e.key.toLowerCase() === "s") toggleShuffle();
  if (e.key.toLowerCase() === "r") cycleRepeat();
  if (e.key.toLowerCase() === "f" && currentSong) toggleFavorite(currentSong);
  if (e.key.toLowerCase() === "q") openQueue();
});

updateBadges();
renderQueue();
renderFavorites();
renderRecent();
renderQueuePage();
renderPlaylists();
initSettings();
updateMuteIcon();
loadProfile();
console.log("VOID Music Player — MAX edition loaded.");
