// Customer QR (modern): map + wallet passes + history + auth
(function () {
  "use strict";

  const STORAGE_KEY = "customer_session_v1";
  const STORAGE_KEY_V2 = "customer_session_v2"; // backward-compat read
  const LEGACY_FAVORITES_KEY = "customer_favorites_v1";
  const WALLET_KEY_PREFIX = "customer_wallet_v1:"; // + customerAddressLower

  const REWARD_THRESHOLD = 10;

  const el = {
    buildBadge: document.getElementById("buildBadge"),
    sessionBadge: document.getElementById("sessionBadge"),
    logoutBtn: document.getElementById("logoutBtn"),

    authPanel: document.getElementById("authPanel"),
    mainPanel: document.getElementById("mainPanel"),

    modeRegister: document.getElementById("modeRegister"),
    modeLogin: document.getElementById("modeLogin"),
    registerFields: document.getElementById("registerFields"),
    username: document.getElementById("username"),
    email: document.getElementById("email"),
    password: document.getElementById("password"),
    confirmPassword: document.getElementById("confirmPassword"),
    confirmPasswordWrap: document.getElementById("confirmPasswordWrap"),
    authSubmit: document.getElementById("authSubmit"),
    authMsg: document.getElementById("authMsg"),

    mainModeHome: document.getElementById("mainModeHome"),
    mainModeMap: document.getElementById("mainModeMap"),
    mainModeWallet: document.getElementById("mainModeWallet"),
    mainModeHistory: document.getElementById("mainModeHistory"),
    layoutGrid: document.getElementById("layoutGrid"),

    mapPanel: document.getElementById("mapPanel"),
    cafeMap: document.getElementById("cafeMap"),
    mapList: document.getElementById("mapList"),

    discoverPick: document.getElementById("discoverPick"),
    discoverPickName: document.getElementById("discoverPickName"),
    discoverPickAddr: document.getElementById("discoverPickAddr"),
    discoverPickAddBtn: document.getElementById("discoverPickAddBtn"),

    walletPanel: document.getElementById("walletPanel"),
    walletSubtitle: document.getElementById("walletSubtitle"),
    walletEmpty: document.getElementById("walletEmpty"),
    walletList: document.getElementById("walletList"),

    historyPanel: document.getElementById("historyPanel"),
    historySubtitle: document.getElementById("historySubtitle"),
    historyError: document.getElementById("historyError"),
    historyEmpty: document.getElementById("historyEmpty"),
    historyList: document.getElementById("historyList"),

    cafeModalBackdrop: document.getElementById("cafeModalBackdrop"),
    cafeModalClose: document.getElementById("cafeModalClose"),
    cafeModalName: document.getElementById("cafeModalName"),
    cafeModalAddr: document.getElementById("cafeModalAddr"),
    cafeModalImageWrap: document.getElementById("cafeModalImageWrap"),
    cafeModalImage: document.getElementById("cafeModalImage"),
    cafeModalGallery: document.getElementById("cafeModalGallery"),
    cafeModalAbout: document.getElementById("cafeModalAbout"),
    cafeModalAboutEmpty: document.getElementById("cafeModalAboutEmpty"),
    cafeModalAddBtn: document.getElementById("cafeModalAddBtn"),
    cafeModalProfileLink: document.getElementById("cafeModalProfileLink"),
  };

  const DEFAULT_API_BASE =
    location.protocol === "file:"
      ? "http://127.0.0.1:3000"
      : `${location.origin}/api`;
  const apiBase = DEFAULT_API_BASE;

  /** @type {{customer_id?:string, username?:string, email?:string, address?:string}|null} */
  let session = null;

  /** @type {Array<{id:number,name:string|null,address:string|null,cafeAddress:string|null,lat:number|null,lng:number|null,about:string|null,hasLogo:boolean,cardTheme:string}>} */
  let cafes = [];
  /** @type {Map<string, any>} */
  const cafesByCafeAddress = new Map();
  /** @type {Map<number, any>} */
  const cafesById = new Map();

  // Wallet state (shared by carousel + stack)
  const walletState = {
    mode: "stack",
    cards: [],
    stackDrag: null,
    ignoreClickUntil: 0,
    scrollStopTimer: null,
  };

  function nowMs() {
    return Date.now();
  }

  function clamp(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function isIOS() {
    try {
      const ua = navigator.userAgent || "";
      return /iP(hone|ad|od)/.test(ua);
    } catch (e) {
      return false;
    }
  }

  function applyWalletStackVisibility(scroller) {
    if (!scroller) return;
    const cards = Array.from(scroller.querySelectorAll(".passCard"));
    for (let i = 0; i < cards.length; i++) {
      const node = cards[i];
      node.style.display = i === 0 ? "block" : "none";
      if (i === 0) {
        node.style.setProperty("--wheel-tx", "0px");
        node.style.setProperty("--wheel-rz", "0deg");
        node.style.setProperty("--wheel-opacity", "1");
      }
    }
  }

  function enableWalletStackMode(scroller) {
    if (!scroller) return;
    walletState.mode = "stack";
    scroller.classList.add("isStack");
    applyWalletStackVisibility(scroller);

    function cycleTopToBottom(scroller2, direction) {
      const cardEl = scroller2.querySelector(".passCard");
      if (!cardEl) return;
      cardEl.classList.add("isSwapping");

      const out = (direction || 1) * 340;
      cardEl.style.setProperty("--wheel-tx", `${out}px`);
      cardEl.style.setProperty("--wheel-opacity", "0");

      window.setTimeout(() => {
        try {
          const first = walletState.cards.shift();
          if (first) walletState.cards.push(first);
          if (cardEl.parentElement === scroller2) scroller2.appendChild(cardEl);
        } catch (e) {}

        try {
          cardEl.classList.remove("isSwapping");
          cardEl.style.setProperty("--wheel-tx", "0px");
          cardEl.style.setProperty("--wheel-opacity", "1");
          cardEl.style.setProperty("--wheel-rz", "0deg");
        } catch (e2) {}
        applyWalletStackVisibility(scroller2);
      }, 160);
    }

    function onPointerDown(ev) {
      const top = scroller.querySelector(".passCard");
      if (!top) return;
      walletState.stackDrag = {
        id: ev.pointerId,
        startX: ev.clientX,
        startY: ev.clientY,
        lastX: ev.clientX,
        lastY: ev.clientY,
        moved: false,
        activeEl: top,
      };
      try {
        top.setPointerCapture(ev.pointerId);
      } catch (e) {}
    }

    function onPointerMove(ev) {
      const d = walletState.stackDrag;
      if (!d || d.id !== ev.pointerId) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      d.lastX = ev.clientX;
      d.lastY = ev.clientY;

      if (!d.moved) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dy) > Math.abs(dx) * 1.2) {
          walletState.stackDrag = null;
          return;
        }
        d.moved = true;
        scroller.classList.add("isDragging");
      }

      const card = d.activeEl;
      const tx = clamp(dx, -260, 260);
      const rz = clamp(dx / 18, -10, 10);
      const op = 1 - Math.min(0.55, Math.abs(dx) / 520);
      card.style.setProperty("--wheel-tx", `${tx.toFixed(2)}px`);
      card.style.setProperty("--wheel-rz", `${rz.toFixed(2)}deg`);
      card.style.setProperty("--wheel-opacity", `${op.toFixed(3)}`);
    }

    function onPointerUp(ev) {
      const d = walletState.stackDrag;
      if (!d || d.id !== ev.pointerId) return;
      walletState.stackDrag = null;
      scroller.classList.remove("isDragging");

      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      const moved = !!d.moved;
      const card = d.activeEl;
      if (!card) return;

      const w = Math.max(1, card.getBoundingClientRect().width || 0);
      const threshold = Math.min(110, Math.max(70, w * 0.22));

      if (moved && Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy)) {
        walletState.ignoreClickUntil = nowMs() + 260;
        cycleTopToBottom(scroller, dx >= 0 ? 1 : -1);
        return;
      }

      card.style.setProperty("--wheel-tx", "0px");
      card.style.setProperty("--wheel-rz", "0deg");
      card.style.setProperty("--wheel-opacity", "1");
      if (moved) walletState.ignoreClickUntil = nowMs() + 180;
    }

    scroller.addEventListener("pointerdown", onPointerDown, { passive: true });
    scroller.addEventListener("pointermove", onPointerMove, { passive: true });
    scroller.addEventListener("pointerup", onPointerUp, { passive: true });
    scroller.addEventListener("pointercancel", onPointerUp, { passive: true });
  }

  function enableWalletCarouselMode(scroller) {
    if (!scroller) return;
    walletState.mode = "carousel";
    scroller.classList.remove("isStack");

    const onScroll = () => {
      setWalletScrolling(scroller, true);
      scheduleWalletWheel(scroller);
      if (walletState.scrollStopTimer) {
        window.clearTimeout(walletState.scrollStopTimer);
      }
      walletState.scrollStopTimer = window.setTimeout(() => {
        setWalletScrolling(scroller, false);
      }, 140);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", () => scheduleWalletWheel(scroller), {
      passive: true,
    });
    scheduleWalletWheel(scroller);
  }

  function createPassCard(card) {
    const pass = document.createElement("div");
    pass.className = "passCard";
    pass.setAttribute("data-cafe", String(card.cafeAddress || ""));
    pass.setAttribute("data-pass-theme", String(card.cardTheme || "paper"));

    const flip = document.createElement("div");
    flip.className = "passFlip";

    const main = document.createElement("button");
    main.className = "passMain";
    main.type = "button";

    const head = document.createElement("div");
    head.className = "passHead";

    const left = document.createElement("div");
    left.style.minWidth = "0";

    const title = document.createElement("h4");
    title.className = "passTitle";
    title.textContent = card.cafeName || "Café";

    const sub = document.createElement("div");
    sub.className = "passSub";
    const stampCount = clamp(card.netStamps || 0, 0, 999);
    sub.textContent = `${clamp(stampCount, 0, REWARD_THRESHOLD)} / ${REWARD_THRESHOLD} Stempel`;

    left.appendChild(title);
    left.appendChild(sub);

    const right = document.createElement("div");
    right.className = "passRight";

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent =
      stampCount >= REWARD_THRESHOLD
        ? "Voll"
        : `${clamp(stampCount, 0, REWARD_THRESHOLD)}/${REWARD_THRESHOLD}`;
    right.appendChild(badge);

    const logoWrap = document.createElement("div");
    logoWrap.className = "passLogoWrap";
    const logo = document.createElement("img");
    logo.className = "passLogo";
    logo.alt = "";
    logo.loading = "lazy";
    logo.decoding = "async";
    logoWrap.appendChild(logo);
    right.appendChild(logoWrap);

    head.appendChild(left);
    head.appendChild(right);

    const hint = document.createElement("div");
    hint.className = "passHint";
    hint.textContent = "Tippe für den QR-Code";

    const grid = buildStampGrid(stampCount);

    main.appendChild(head);
    main.appendChild(hint);
    main.appendChild(grid);

    const qr = document.createElement("div");
    qr.className = "passQr";

    const qrHint = document.createElement("div");
    qrHint.className = "passHint";
    qrHint.textContent =
      stampCount >= REWARD_THRESHOLD
        ? "Belohnung einlösen"
        : "Zeig den QR an der Kasse";

    const qrBox = document.createElement("div");
    qrBox.className = "passQrBox";
    qrBox.setAttribute("role", "button");
    qrBox.setAttribute("aria-label", "QR schließen");

    const canvas = document.createElement("canvas");
    qrBox.appendChild(canvas);
    qr.appendChild(qrHint);
    qr.appendChild(qrBox);

    flip.appendChild(main);
    flip.appendChild(qr);
    pass.appendChild(flip);

    const state = {
      qrRendered: false,
      qrText: "",
      logoLoaded: false,
    };

    async function ensureLogo() {
      if (state.logoLoaded) return;
      state.logoLoaded = true;
      try {
        if (card.cafeId == null) return;
        const cafeId = Number(card.cafeId);
        if (!Number.isFinite(cafeId) || cafeId <= 0) return;
        const profile = await getCafeProfile(cafeId);
        if (!profile || !profile.logoDataUrl) return;
        logo.src = String(profile.logoDataUrl);
        logoWrap.style.display = "flex";
        logo.addEventListener(
          "load",
          () => {
            try {
              scheduleWalletWheel(el.walletList);
            } catch (e) {}
          },
          { once: true },
        );
      } catch (e) {}
    }

    async function ensureQr() {
      const stamps = clamp(card.netStamps || 0, 0, 999);
      const action = stamps >= REWARD_THRESHOLD ? "redeem" : "stamp";
      const redeemToken = action === "redeem" ? `rt_${randomHex(16)}` : "";

      state.qrText = buildScannerUrl({
        customerAddr: session && session.address ? session.address : "",
        customerName:
          session && (session.username || session.email)
            ? session.username || session.email
            : "",
        cafeAddr: card.cafeAddress || "",
        action,
        redeemToken,
      });
      await renderQrToCanvas(canvas, state.qrText);
      state.qrRendered = true;
    }

    function openCard() {
      if (nowMs() < walletState.ignoreClickUntil) return;
      pass.classList.add("open");
      void ensureQr();
    }

    function closeCard() {
      pass.classList.remove("open");
    }

    main.addEventListener("click", (ev) => {
      try {
        ev.stopPropagation();
      } catch (e) {}
      if (nowMs() < walletState.ignoreClickUntil) return;
      if (pass.classList.contains("open")) closeCard();
      else openCard();
      void ensureLogo();
    });

    qrBox.addEventListener("click", (ev) => {
      try {
        ev.stopPropagation();
      } catch (e) {}
      closeCard();
    });

    // Lazy-load logo once inserted.
    window.setTimeout(() => void ensureLogo(), 30);

    return pass;
  }

  async function refreshWallet() {
    if (!el.walletList || !el.walletEmpty) return;
    if (!session || !session.address) {
      el.walletList.innerHTML = "";
      el.walletEmpty.style.display = "block";
      walletState.cards = [];
      return;
    }

    const saved = loadWalletCafeAddresses();

    const renderCards = (cards) => {
      walletState.cards = Array.isArray(cards) ? cards : [];
      el.walletList.innerHTML = "";

      if (!walletState.cards.length) {
        el.walletEmpty.style.display = "block";
        // Empty wallet: keep carousel mode so strict checks don't expect a visible stack card.
        walletState.mode = "carousel";
        el.walletList.classList.remove("isStack");
        return;
      }

      el.walletEmpty.style.display = "none";
      for (const card of walletState.cards) {
        el.walletList.appendChild(createPassCard(card));
      }

      if (WALLET_MODE === "stack" || (WALLET_MODE === "auto" && isIOS())) {
        enableWalletStackMode(el.walletList);
      } else {
        enableWalletCarouselMode(el.walletList);
      }

      window.setTimeout(() => scheduleWalletWheel(el.walletList), 0);
      window.setTimeout(() => scheduleWalletWheel(el.walletList), 60);
    };

    // Fast path: render placeholders from saved favorites immediately (no API wait).
    if (saved.length) {
      const placeholders = saved
        .map((cafeAddr) => {
          const cafeMeta =
            cafesByCafeAddress.get(normalizeAddr(cafeAddr)) || null;
          return {
            cafeAddress:
              cafeMeta && cafeMeta.cafeAddress
                ? cafeMeta.cafeAddress
                : cafeAddr,
            cafeName:
              (cafeMeta && cafeMeta.name) || cafeNameByAddress(cafeAddr),
            cafeId:
              cafeMeta && Number.isFinite(Number(cafeMeta.id))
                ? Number(cafeMeta.id)
                : null,
            netStamps: 0,
            lastActivityTs: 0,
            cardTheme: (cafeMeta && cafeMeta.cardTheme) || "paper",
          };
        })
        .filter((x) => !!x.cafeAddress);
      renderCards(placeholders);
    }

    let cardsSummary = [];
    try {
      const addr = encodeURIComponent(session.address);
      const data = await apiFetch(`/customers/${addr}/cards?eventsPerCafe=5`);
      cardsSummary = data && Array.isArray(data.cards) ? data.cards : [];
    } catch (e) {
      cardsSummary = [];
    }

    const byCafe = new Map();

    for (const c of cardsSummary) {
      const cafeAddr = normalizeAddr(c.cafeAddress);
      if (!cafeAddr) continue;
      byCafe.set(cafeAddr, c);
    }

    for (const cafeAddr of saved) {
      if (byCafe.has(cafeAddr)) continue;
      byCafe.set(cafeAddr, {
        cafeAddress: cafeAddr,
        cafeName: null,
        cafeId: null,
        stats: { netStamps: 0, lastActivityTs: null },
        recentEvents: [],
      });
    }

    const merged = Array.from(byCafe.values()).map((raw) => {
      const cafeAddr = normalizeAddr(raw.cafeAddress);
      const cafeMeta = cafesByCafeAddress.get(cafeAddr) || null;
      const netStamps = raw && raw.stats ? Number(raw.stats.netStamps || 0) : 0;
      const lastTs =
        raw && raw.stats ? Number(raw.stats.lastActivityTs || 0) : 0;
      const cafeId =
        raw.cafeId != null
          ? Number(raw.cafeId)
          : cafeMeta
            ? Number(cafeMeta.id)
            : null;
      return {
        cafeAddress:
          cafeMeta && cafeMeta.cafeAddress
            ? cafeMeta.cafeAddress
            : raw.cafeAddress,
        cafeName:
          (cafeMeta && cafeMeta.name) ||
          raw.cafeName ||
          cafeNameByAddress(raw.cafeAddress),
        cafeId: Number.isFinite(cafeId) ? cafeId : null,
        netStamps: Number.isFinite(netStamps) ? netStamps : 0,
        lastActivityTs: Number.isFinite(lastTs) ? lastTs : 0,
        cardTheme: (cafeMeta && cafeMeta.cardTheme) || "paper",
      };
    });

    merged.sort((a, b) => {
      if ((b.lastActivityTs || 0) !== (a.lastActivityTs || 0))
        return (b.lastActivityTs || 0) - (a.lastActivityTs || 0);
      return String(a.cafeName || "").localeCompare(String(b.cafeName || ""));
    });

    renderCards(merged);
  }

  function hideDiscoverPick() {
    if (!el.discoverPick) return;
    el.discoverPick.style.display = "none";
    pickedCafe = null;
  }

  function showDiscoverPick(cafe) {
    pickedCafe = cafe;
    if (el.discoverPickName)
      el.discoverPickName.textContent =
        cafe && cafe.name ? String(cafe.name) : "Café";
    if (el.discoverPickAddr)
      el.discoverPickAddr.textContent =
        cafe && cafe.address ? String(cafe.address) : "";
    if (el.discoverPick) el.discoverPick.style.display = "block";
  }

  function teardownMap() {
    try {
      if (leafletMarkers && leafletMarkers.length) {
        for (const m of leafletMarkers) {
          try {
            m.remove();
          } catch (e) {}
        }
      }
      leafletMarkers = [];
    } catch (e) {}
    try {
      if (leafletMap) leafletMap.remove();
    } catch (e) {}
    leafletMap = null;
  }

  function initMapIfReady() {
    if (!el.cafeMap) return;
    if (leafletMap) return;
    if (!window.L || !window.L.map) return;
    if (!cafes.length) return;

    const firstWithPos = cafes.find(
      (c) => Number.isFinite(c.lat) && Number.isFinite(c.lng),
    );
    const center = firstWithPos
      ? [firstWithPos.lat, firstWithPos.lng]
      : [52.52, 13.405];

    leafletMap = window.L.map(el.cafeMap, {
      zoomControl: false,
      attributionControl: false,
    }).setView(center, firstWithPos ? 14 : 5);

    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(leafletMap);

    leafletMap.on("click", () => hideDiscoverPick());

    for (const cafe of cafes) {
      if (!Number.isFinite(cafe.lat) || !Number.isFinite(cafe.lng)) continue;
      const marker = window.L.marker([cafe.lat, cafe.lng]);
      marker.addTo(leafletMap);
      marker.on("click", () => {
        showDiscoverPick(cafe);
      });
      leafletMarkers.push(marker);
    }
  }

  function renderMapList() {
    if (!el.mapList) return;
    if (!cafes.length) {
      el.mapList.textContent = "Noch keine Cafés.";
      return;
    }
    el.mapList.innerHTML = "";
    const list = document.createElement("div");
    list.className = "stack";
    list.style.gap = "8px";

    for (const cafe of cafes.slice(0, 12)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn secondary";
      btn.textContent = cafe.name ? String(cafe.name) : "Café";
      btn.addEventListener("click", () => openCafeModal(cafe));
      list.appendChild(btn);
    }
    el.mapList.appendChild(list);
  }

  function closeCafeModal() {
    if (!el.cafeModalBackdrop) return;
    el.cafeModalBackdrop.style.display = "none";
  }

  async function openCafeModal(cafe) {
    if (!el.cafeModalBackdrop) return;
    if (el.cafeModalName)
      el.cafeModalName.textContent =
        cafe && cafe.name ? String(cafe.name) : "Café";
    if (el.cafeModalAddr)
      el.cafeModalAddr.textContent =
        cafe && cafe.address ? String(cafe.address) : "";
    if (el.cafeModalAbout) el.cafeModalAbout.style.display = "none";
    if (el.cafeModalAboutEmpty) el.cafeModalAboutEmpty.style.display = "none";
    if (el.cafeModalImageWrap) el.cafeModalImageWrap.style.display = "none";
    if (el.cafeModalGallery) el.cafeModalGallery.innerHTML = "";

    if (el.cafeModalProfileLink) {
      el.cafeModalProfileLink.href =
        cafe && cafe.id
          ? `/cafe-public.html?id=${encodeURIComponent(String(cafe.id))}`
          : "#";
    }

    el.cafeModalBackdrop.style.display = "flex";

    try {
      const profile = await getCafeProfile(cafe.id);
      if (profile) {
        const about = profile.about ? String(profile.about).trim() : "";
        if (about && el.cafeModalAbout) {
          el.cafeModalAbout.textContent = about;
          el.cafeModalAbout.style.display = "block";
        } else if (el.cafeModalAboutEmpty) {
          el.cafeModalAboutEmpty.style.display = "block";
        }

        const images = Array.isArray(profile.images)
          ? profile.images.filter(Boolean)
          : [];
        if (images.length && el.cafeModalImage && el.cafeModalImageWrap) {
          el.cafeModalImage.src = images[0];
          el.cafeModalImageWrap.style.display = "block";
        }
        if (images.length > 1 && el.cafeModalGallery) {
          for (const src of images.slice(1, 6)) {
            const img = document.createElement("img");
            img.src = src;
            img.alt = "";
            img.loading = "lazy";
            img.decoding = "async";
            img.addEventListener("click", () => {
              try {
                if (el.cafeModalImage) el.cafeModalImage.src = src;
                if (el.cafeModalImageWrap)
                  el.cafeModalImageWrap.style.display = "block";
              } catch (e) {}
            });
            el.cafeModalGallery.appendChild(img);
          }
        }
      }
    } catch (e) {}

    if (el.cafeModalAddBtn) {
      el.cafeModalAddBtn.onclick = () => {
        addCafeToWallet(cafe.cafeAddress);
        closeCafeModal();
        navSetActive("wallet");
        scrollToPanel(el.walletPanel);
      };
    }
  }

  async function bootAuthed() {
    // Render wallet immediately (from favorites) without waiting on cafes.
    await refreshWallet().catch(() => {});

    const cafesPromise = loadCafes().catch(() => {});
    await cafesPromise;
    renderMapList();

    // Re-render wallet once cafes are known (names/themes/logos).
    await refreshWallet().catch(() => {});

    // Leaflet is loaded with defer; poll until ready.
    let tries = 0;
    const timer = window.setInterval(() => {
      tries++;
      initMapIfReady();
      if (leafletMap || tries > 40) {
        window.clearInterval(timer);
      }
    }, 120);

    await refreshWallet().catch(() => {});

    if (activeNav === "history") {
      if (el.historyPanel) el.historyPanel.style.display = "block";
      await refreshHistory().catch(() => {});
    }
  }

  function wireNavigation() {
    if (el.mainModeHome) {
      el.mainModeHome.addEventListener("click", () => {
        navSetActive("home");
        if (el.historyPanel) el.historyPanel.style.display = "none";
        scrollToPanel(el.mapPanel);
      });
    }
    if (el.mainModeMap) {
      el.mainModeMap.addEventListener("click", () => {
        navSetActive("map");
        if (el.historyPanel) el.historyPanel.style.display = "none";
        scrollToPanel(el.mapPanel);
      });
    }
    if (el.mainModeWallet) {
      el.mainModeWallet.addEventListener("click", () => {
        navSetActive("wallet");
        if (el.historyPanel) el.historyPanel.style.display = "none";
        scrollToPanel(el.walletPanel);
      });
    }
    if (el.mainModeHistory) {
      el.mainModeHistory.addEventListener("click", () => {
        navSetActive("history");
        if (el.historyPanel) el.historyPanel.style.display = "block";
        void refreshHistory();
        scrollToPanel(el.historyPanel);
      });
    }
  }

  function wireModalAndPick() {
    if (el.discoverPickAddBtn) {
      el.discoverPickAddBtn.addEventListener("click", () => {
        if (!pickedCafe) return;
        addCafeToWallet(pickedCafe.cafeAddress);
        hideDiscoverPick();
        navSetActive("wallet");
        scrollToPanel(el.walletPanel);
      });
    }
    if (el.cafeModalClose) {
      el.cafeModalClose.addEventListener("click", closeCafeModal);
    }
    if (el.cafeModalBackdrop) {
      el.cafeModalBackdrop.addEventListener("click", (ev) => {
        if (ev.target === el.cafeModalBackdrop) closeCafeModal();
      });
    }
  }

  function wireAuth() {
    if (el.modeRegister)
      el.modeRegister.addEventListener("click", () => setAuthMode("register"));
    if (el.modeLogin)
      el.modeLogin.addEventListener("click", () => setAuthMode("login"));
    if (el.authSubmit)
      el.authSubmit.addEventListener("click", () => void handleAuthSubmit());
  }

  function wireLogout() {
    if (!el.logoutBtn) return;
    el.logoutBtn.addEventListener("click", () => {
      clearSession();
      teardownMap();
      if (el.historyPanel) el.historyPanel.style.display = "none";
      if (el.walletList) el.walletList.innerHTML = "";
      if (el.walletEmpty) el.walletEmpty.style.display = "block";
      navSetActive("home");
      setAuthedUI();
    });
  }

  function main() {
    if (isIOS()) {
      try {
        document.documentElement.classList.add("ios");
      } catch (e) {}
    }
    setBuildBadge();
    wireAuth();
    wireLogout();
    wireNavigation();
    wireModalAndPick();

    const s = loadSession();
    if (s) saveSession(s);
    setAuthedUI();
    setAuthMode("register");
    navSetActive("home");

    if (session && session.address) {
      void bootAuthed().finally(setBootOk);
    } else {
      setBootOk();
    }
  }

  main();
})();
/*
 * Legacy customer app (flippable stamp card) — DISABLED.
 *
 * This block was accidentally concatenated onto the modern wallet UI script.
 * Leaving it here (commented) to keep the diff small and to avoid accidental
 * reintroduction. It must not execute because it overrides DOM/state.
 
// Customer app (no manual wallet input): signup/login with username+email,
// then show a flippable stamp card and cafe-bound QR.
(function () {
  const STORAGE_KEY = "customer_session_v1";
  const CAFE_SELECTION_KEY = "customer_selected_cafe_v1";

  const el = {
    buildBadge: document.getElementById("buildBadge"),
    sessionBadge: document.getElementById("sessionBadge"),
    logoutBtn: document.getElementById("logoutBtn"),

    authPanel: document.getElementById("authPanel"),
    mainPanel: document.getElementById("mainPanel"),

    modeRegister: document.getElementById("modeRegister"),
    modeLogin: document.getElementById("modeLogin"),
    registerFields: document.getElementById("registerFields"),
    username: document.getElementById("username"),
    email: document.getElementById("email"),
    password: document.getElementById("password"),
    confirmPassword: document.getElementById("confirmPassword"),
    confirmPasswordWrap: document.getElementById("confirmPasswordWrap"),
    authSubmit: document.getElementById("authSubmit"),
    authMsg: document.getElementById("authMsg"),
    credsPanel: document.getElementById("credsPanel"),

    welcomeBadge: document.getElementById("welcomeBadge"),
    addressLine: document.getElementById("addressLine"),
    cafeSelect: document.getElementById("cafeSelect"),
    cafeTitle: document.getElementById("cafeTitle"),
    cafeLogo: document.getElementById("cafeLogo"),
    cafeAbout: document.getElementById("cafeAbout"),
    stampCountBadge: document.getElementById("stampCountBadge"),
    stampGrid: document.getElementById("stampGrid"),
    flipCard: document.getElementById("flipCard"),
    qrCafeBadge: document.getElementById("qrCafeBadge"),
    qrTitle: document.getElementById("qrTitle"),
    qrModeSeg: document.getElementById("qrModeSeg"),
    qrModeStamp: document.getElementById("qrModeStamp"),
    qrModeRedeem: document.getElementById("qrModeRedeem"),
    qrCanvas: document.getElementById("qrCanvas"),
    qrHint: document.getElementById("qrHint"),

    redeemNotice: document.getElementById("redeemNotice"),
    redeemActions: document.getElementById("redeemActions"),
    showRedeemQrBtn: document.getElementById("showRedeemQrBtn"),

    mainModeSeg: document.getElementById("mainModeSeg"),
    mainModeCard: document.getElementById("mainModeCard"),
    mainModeWallet: document.getElementById("mainModeWallet"),
    mainModeHistory: document.getElementById("mainModeHistory"),

    historyPanel: document.getElementById("historyPanel"),
    historyCloseBtn: document.getElementById("historyCloseBtn"),
    historySubtitle: document.getElementById("historySubtitle"),
    historyError: document.getElementById("historyError"),
    historyEmpty: document.getElementById("historyEmpty"),
    historyList: document.getElementById("historyList"),

    walletPanel: document.getElementById("walletPanel"),
    walletCloseBtn: document.getElementById("walletCloseBtn"),
    walletSubtitle: document.getElementById("walletSubtitle"),
    walletEmpty: document.getElementById("walletEmpty"),
    walletList: document.getElementById("walletList"),
  };

  const DEFAULT_API_BASE =
    location.protocol === "file:"
      ? "http://127.0.0.1:3000"
      : `${location.origin}/api`;

  let apiBase = DEFAULT_API_BASE;
  let mode = "register";
  let session = null; // { customer_id, username, email, address }
  let cafes = []; // { id, name, address }
  let selectedCafe = null;
  let selectedCafeProfile = null; // { about, logoDataUrl, redeemMessage }
  let pendingCafeFromUrl = null;
  let historyOpen = false;
  let mainMode = "card"; // 'card' | 'wallet' | 'history'
  let lastHistoryEvents = [];

  const REWARD_THRESHOLD = 10;
  let currentStampCount = 0;
  let sse = null;
  let toastEl = null;
  let toastTimer = null;
  let lastFullToastKey = null;
  let qrMode = "stamp"; // 'stamp' | 'redeem'
  let activeRedeemToken = null;
  let activeRedeemTokenKey = "";

  function normalizeAddr(v) {
    return v ? String(v).toLowerCase() : "";
  }

  function formatTs(ts) {
    const n = Number(ts);
    const d = Number.isFinite(n) ? new Date(n) : new Date(String(ts || ""));
    if (!d || Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  }

  function shortHash(h) {
    const s = String(h || "");
    if (!s) return "";
    if (s.length <= 14) return s;
    return `${s.slice(0, 8)}…${s.slice(-6)}`;
  }

  function cafeNameByAddress(addr) {
    const a = normalizeAddr(addr);
    const c = cafes.find(
      (x) =>
        normalizeAddr(x.cafeAddress) === a || normalizeAddr(x.address) === a
    );
    return c ? c.name : addr ? String(addr) : "(unbekannt)";
  }

  function setMainMode(nextMode) {
    const m =
      nextMode === "wallet"
        ? "wallet"
        : nextMode === "history"
        ? "history"
        : "card";
    mainMode = m;
    historyOpen = mainMode === "history";

    if (el.mainModeCard)
      el.mainModeCard.classList.toggle("active", mainMode === "card");
    if (el.mainModeWallet)
      el.mainModeWallet.classList.toggle("active", mainMode === "wallet");
    if (el.mainModeHistory)
      el.mainModeHistory.classList.toggle("active", mainMode === "history");

    if (el.flipCard)
      el.flipCard.style.display = mainMode === "card" ? "block" : "none";
    if (el.historyPanel)
      el.historyPanel.style.display = mainMode === "history" ? "block" : "none";
    if (el.walletPanel)
      el.walletPanel.style.display = mainMode === "wallet" ? "block" : "none";

    if (mainMode === "history") {
      try {
        if (el.historyPanel)
          el.historyPanel.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      } catch (e) {}
    } else if (mainMode === "wallet") {
      try {
        if (el.walletPanel)
          el.walletPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {}
    }
  }

  function setHistoryOpen(open) {
    setMainMode(open ? "history" : "card");
  }

  function clearHistoryUi() {
    if (el.historyError) {
      el.historyError.style.display = "none";
      el.historyError.textContent = "";
    }
    if (el.historyEmpty) el.historyEmpty.style.display = "none";
    if (el.historyList) el.historyList.innerHTML = "";
  }

  function clearWalletUi() {
    if (el.walletEmpty) el.walletEmpty.style.display = "none";
    if (el.walletList) el.walletList.innerHTML = "";
  }

  function renderHistory(events) {
    clearHistoryUi();
    if (!el.historyList) return;

    const filtered = Array.isArray(events) ? events.slice() : [];
    const cafeFilter = selectedCafe
      ? normalizeAddr(selectedCafe.cafeAddress || selectedCafe.address)
      : "";
    const visible = cafeFilter
      ? filtered.filter((ev) => normalizeAddr(ev.cafe) === cafeFilter)
      : filtered;

    if (el.historySubtitle) {
      el.historySubtitle.textContent = cafeFilter
        ? `Nur für: ${selectedCafe ? selectedCafe.name : "Café"}`
        : "Letzte Transaktionen (mehrere Stempel werden zusammengefasst).";
    }

    if (!visible.length) {
      if (el.historyEmpty) el.historyEmpty.style.display = "block";
      return;
    }

    const groups = new Map();
    for (const ev of visible) {
      const tx = normalizeAddr(ev.txhash);
      const cafeAddr = normalizeAddr(ev.cafe);
      const key = tx ? `${tx}|${cafeAddr}` : `ts:${String(ev.ts)}|${cafeAddr}`;
      const delta = Number(ev.delta || 0);
      const prev = groups.get(key);
      if (!prev) {
        groups.set(key, {
          cafe: ev.cafe || null,
          txhash: ev.txhash || null,
          ts: ev.ts,
          delta,
        });
      } else {
        prev.delta += delta;
        const prevTs = Number(prev.ts);
        const curTs = Number(ev.ts);
        if (
          Number.isFinite(curTs) &&
          (!Number.isFinite(prevTs) || curTs > prevTs)
        ) {
          prev.ts = ev.ts;
        }
      }
    }

    const list = Array.from(groups.values()).sort((a, b) => {
      const ta = Number(a.ts);
      const tb = Number(b.ts);
      if (Number.isFinite(ta) && Number.isFinite(tb)) return tb - ta;
      return String(b.ts || "").localeCompare(String(a.ts || ""));
    });

    for (const item of list) {
      const row = document.createElement("div");
      row.className = "historyItem";

      const delta = Number(item.delta || 0);
      const badge = document.createElement("span");
      badge.className = "badge";
      const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
      badge.textContent = `${sign}${Math.abs(delta)} Stempel`;

      const left = document.createElement("div");
      left.className = "historyLeft";

      const main = document.createElement("div");
      main.className = "historyMain";

      const cafeLine = document.createElement("div");
      cafeLine.className = "historyCafe";
      cafeLine.textContent = cafeNameByAddress(item.cafe);

      const meta = document.createElement("div");
      meta.className = "historyMeta";
      meta.textContent = formatTs(item.ts);

      main.appendChild(cafeLine);
      main.appendChild(meta);
      left.appendChild(badge);
      left.appendChild(main);

      const tx = document.createElement("div");
      tx.className = "historyTx";
      tx.textContent = item.txhash ? `Tx ${shortHash(item.txhash)}` : "";

      row.appendChild(left);
      row.appendChild(tx);
      el.historyList.appendChild(row);
    }
  }

  function renderWallet(events) {
    clearWalletUi();
    if (!el.walletList) return;

    const filtered = Array.isArray(events) ? events.slice() : [];
    const cafeFilter = selectedCafe
      ? normalizeAddr(selectedCafe.cafeAddress || selectedCafe.address)
      : "";
    const visible = cafeFilter
      ? filtered.filter((ev) => normalizeAddr(ev.cafe) === cafeFilter)
      : filtered;

    const redeems = visible.filter((ev) => {
      const typ = String((ev && ev.event_type) || "").toLowerCase();
      const delta = Number(ev && ev.delta != null ? ev.delta : 0);
      const status = String((ev && ev.status) || "").toLowerCase();
      const looksLikeRedeem = typ === "redeem" || delta < 0;
      const looksConfirmed = !status || status === "confirmed";
      return looksLikeRedeem && looksConfirmed;
    });

    if (el.walletSubtitle) {
      el.walletSubtitle.textContent = cafeFilter
        ? `Nur für: ${
            selectedCafe ? selectedCafe.name : "Café"
          } — Eingelöste Karten (ohne QR-Code).`
        : "Eingelöste Karten (ohne QR-Code).";
    }

    if (!redeems.length) {
      if (el.walletEmpty) el.walletEmpty.style.display = "block";
      return;
    }

    const groups = new Map();
    for (const ev of redeems) {
      const tx = normalizeAddr(ev.txhash);
      const cafeAddr = normalizeAddr(ev.cafe);
      const key = tx ? `${tx}|${cafeAddr}` : `ts:${String(ev.ts)}|${cafeAddr}`;
      const prev = groups.get(key);
      if (!prev) {
        groups.set(key, {
          cafe: ev.cafe || null,
          txhash: ev.txhash || null,
          ts: ev.ts,
        });
      } else {
        const prevTs = Number(prev.ts);
        const curTs = Number(ev.ts);
        if (
          Number.isFinite(curTs) &&
          (!Number.isFinite(prevTs) || curTs > prevTs)
        ) {
          prev.ts = ev.ts;
        }
      }
    }

    const list = Array.from(groups.values()).sort((a, b) => {
      const ta = Number(a.ts);
      const tb = Number(b.ts);
      if (Number.isFinite(ta) && Number.isFinite(tb)) return tb - ta;
      return String(b.ts || "").localeCompare(String(a.ts || ""));
    });

    let i = 0;
    for (const item of list) {
      i++;
      const row = document.createElement("div");
      row.className = "historyItem walletItem";

      const left = document.createElement("div");
      left.className = "historyLeft";

      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = `Eingelöst #${i}`;

      const main = document.createElement("div");
      main.className = "historyMain";

      const cafeLine = document.createElement("div");
      cafeLine.className = "historyCafe";
      cafeLine.textContent = cafeNameByAddress(item.cafe);

      const meta = document.createElement("div");
      meta.className = "historyMeta";
      meta.textContent = formatTs(item.ts);

      main.appendChild(cafeLine);
      main.appendChild(meta);
      left.appendChild(badge);
      left.appendChild(main);

      const tx = document.createElement("div");
      tx.className = "historyTx";
      tx.textContent = item.txhash ? `Tx ${shortHash(item.txhash)}` : "";

      const voidStamp = document.createElement("div");
      voidStamp.className = "walletVoid";
      voidStamp.textContent = "ENTWERTET";

      row.appendChild(left);
      row.appendChild(tx);
      row.appendChild(voidStamp);
      el.walletList.appendChild(row);
    }
  }

  async function refreshHistory() {
    if (mainMode !== "history" && mainMode !== "wallet") return;
    if (!session || !session.address) {
      lastHistoryEvents = [];
      renderHistory([]);
      renderWallet([]);
      return;
    }

    clearHistoryUi();
    clearWalletUi();
    try {
      const addr = encodeURIComponent(session.address);
      const events = await apiFetch(`/stamps/history/${addr}`);
      lastHistoryEvents = Array.isArray(events) ? events : [];
      renderHistory(lastHistoryEvents);
      renderWallet(lastHistoryEvents);
    } catch (e) {
      if (el.historyError) {
        el.historyError.style.display = "block";
        el.historyError.textContent =
          "Historie konnte nicht geladen werden. " +
          String(e && e.message ? e.message : e);
      }
    }
  }

  function saveSelectedCafeAddress(address) {
    try {
      if (!address) {
        localStorage.removeItem(CAFE_SELECTION_KEY);
        return;
      }
      localStorage.setItem(CAFE_SELECTION_KEY, String(address));
    } catch (e) {}
  }

  function loadSelectedCafeAddress() {
    try {
      const v = localStorage.getItem(CAFE_SELECTION_KEY);
      return v ? String(v) : null;
    } catch (e) {
      return null;
    }
  }

  function setBuildBadge() {
    if (!el.buildBadge) return;
    el.buildBadge.textContent = `v ${new Date().toLocaleString()}`;
  }

  function showMsg(kind, text) {
    if (!el.authMsg) return;
    el.authMsg.style.display = "block";
    el.authMsg.className = `notice ${kind === "danger" ? "danger" : ""}`;
    el.authMsg.textContent = text;
  }

  function clearMsg() {
    if (!el.authMsg) return;
    el.authMsg.style.display = "none";
    el.authMsg.textContent = "";
  }

  function clearCreds() {
    if (!el.credsPanel) return;
    el.credsPanel.style.display = "none";
    el.credsPanel.textContent = "";
  }

  function ensureToastEl() {
    if (toastEl) return toastEl;
    try {
      const div = document.createElement("div");
      div.id = "customerEventToast";
      div.className = "notice";
      div.style.position = "fixed";
      div.style.top = "16px";
      div.style.right = "16px";
      div.style.maxWidth = "360px";
      div.style.zIndex = "9999";
      div.style.display = "none";
      div.style.whiteSpace = "pre-line";
      div.style.cursor = "default";
      document.body.appendChild(div);
      toastEl = div;
    } catch (e) {
      toastEl = null;
    }
    return toastEl;
  }

  function showToast(kind, text, ms) {
    const t = ensureToastEl();
    if (!t) return;
    if (toastTimer) {
      try {
        clearTimeout(toastTimer);
      } catch (e) {}
      toastTimer = null;
    }
    const k = String(kind || "info").toLowerCase();
    t.className = `notice ${k}`;
    t.textContent = String(text || "");
    t.style.display = "block";
    toastTimer = setTimeout(() => {
      try {
        t.style.display = "none";
      } catch (e) {}
    }, Math.max(1200, Number(ms || 2600)));
  }

  function maybeShowFullCardToast(stamps) {
    const n = Number(stamps || 0);
    if (!Number.isFinite(n)) return;
    if (n < REWARD_THRESHOLD) return;

    const cafeAddr = selectedCafe
      ? normalizeAddr(selectedCafe.cafeAddress)
      : "";
    const userAddr = session ? normalizeAddr(session.address) : "";
    const key = `${userAddr}|${cafeAddr}|${REWARD_THRESHOLD}`;
    if (lastFullToastKey === key) return;
    lastFullToastKey = key;

    const cafeName = selectedCafe ? selectedCafe.name : "Café";
    const custom =
      selectedCafeProfile && selectedCafeProfile.redeemMessage
        ? String(selectedCafeProfile.redeemMessage).trim()
        : "";
    const lines = [`🎁 Karte voll bei ${cafeName}!`];
    if (custom) lines.push(custom);
    lines.push("Lass dir dein Getränk schenken.");
    const msg = lines.join("\n");
    showToast("success", msg, 3800);
  }

  function setQrMode(nextMode) {
    const m = nextMode === "redeem" ? "redeem" : "stamp";
    qrMode = m;
    if (el.qrModeStamp)
      el.qrModeStamp.classList.toggle("active", qrMode === "stamp");
    if (el.qrModeRedeem)
      el.qrModeRedeem.classList.toggle("active", qrMode === "redeem");
    void renderQR();
  }

  function updateRedeemUi() {
    const full = currentStampCount >= REWARD_THRESHOLD;
    const cafeName = selectedCafe ? selectedCafe.name : "Café";
    const custom =
      selectedCafeProfile && selectedCafeProfile.redeemMessage
        ? String(selectedCafeProfile.redeemMessage).trim()
        : "";

    if (el.redeemNotice) {
      if (full) {
        const lines = [`🎁 Karte voll bei ${cafeName}!`];
        if (custom) lines.push(custom);
        lines.push("Lass dir dein Getränk schenken.");
        const msg = lines.join("\n");
        el.redeemNotice.style.display = "block";
        el.redeemNotice.textContent = msg;
      } else {
        el.redeemNotice.style.display = "none";
        el.redeemNotice.textContent = "";
      }
    }

    if (el.redeemActions) {
      el.redeemActions.style.display = full ? "flex" : "none";
    }

    if (el.qrModeSeg) {
      el.qrModeSeg.style.display = full ? "inline-flex" : "none";
    }

    // If card isn't full, force stamp QR
    if (!full && qrMode !== "stamp") {
      qrMode = "stamp";
      if (el.qrModeStamp) el.qrModeStamp.classList.add("active");
      if (el.qrModeRedeem) el.qrModeRedeem.classList.remove("active");
    }
  }

  function showCreds(data) {
    if (!el.credsPanel) return;
    if (!data) return;

    const lines = [];
    if (data.username) lines.push(`Username: ${data.username}`);
    if (data.email) lines.push(`E-Mail: ${data.email}`);
    if (data.customer_id) lines.push(`Customer ID: ${data.customer_id}`);
    if (data.address) lines.push(`Kunden-Adresse: ${data.address}`);

    el.credsPanel.className = "notice";
    el.credsPanel.style.display = "block";
    el.credsPanel.textContent = lines.join("\n");
  }

  function setMode(nextMode) {
    mode = nextMode;
    if (el.modeRegister)
      el.modeRegister.classList.toggle("active", mode === "register");
    if (el.modeLogin) el.modeLogin.classList.toggle("active", mode === "login");
    if (el.registerFields)
      el.registerFields.style.display = mode === "register" ? "block" : "none";
    if (el.authSubmit)
      el.authSubmit.textContent =
        mode === "register" ? "Account erstellen" : "Einloggen";

    if (el.confirmPasswordWrap)
      el.confirmPasswordWrap.style.display =
        mode === "register" ? "block" : "none";

    if (el.password) {
      el.password.autocomplete =
        mode === "register" ? "new-password" : "current-password";
    }

    clearMsg();
    clearCreds();
  }

  function saveSession(s) {
    session = s;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.address || !parsed.email) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clearSession() {
    session = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  function setAuthedUI() {
    const isAuthed = !!session;
    if (el.logoutBtn)
      el.logoutBtn.style.display = isAuthed ? "inline-flex" : "none";
    if (el.authPanel) el.authPanel.style.display = isAuthed ? "none" : "block";
    if (el.mainPanel) el.mainPanel.style.display = isAuthed ? "block" : "none";
    if (el.sessionBadge) {
      el.sessionBadge.textContent = isAuthed
        ? `Eingeloggt: ${session.username || session.email}`
        : "Nicht eingeloggt";
    }
    if (isAuthed) {
      if (el.welcomeBadge)
        el.welcomeBadge.textContent = `Willkommen, ${
          session.username || ""
        }`.trim();
      // Keep wallet address out of the main UI (still stored for QR + stamping)
      if (el.addressLine) el.addressLine.textContent = "";
    }
  }

  async function apiFetch(path, init) {
    const url = `${apiBase}${path}`;
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function loadCafes() {
    const data = await apiFetch("/cafes/public");
    const list = Array.isArray(data) ? data : data.cafes || [];
    cafes = list
      .map((c) => ({
        id: c.id,
        name: c.name || "(ohne Namen)",
        address: c.address,
        cafeAddress: c.cafeAddress || null,
        hasLogo: !!c.hasLogo,
        about: c.about || null,
      }))
      .filter((c) => c.address);

    if (!el.cafeSelect) return;
    el.cafeSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Café auswählen…";
    el.cafeSelect.appendChild(placeholder);

    for (const cafe of cafes) {
      const opt = document.createElement("option");
      opt.value = cafe.cafeAddress || cafe.address;
      opt.textContent = cafe.name;
      el.cafeSelect.appendChild(opt);
    }

    // Apply selection priority: URL param -> previous selection -> auto-select single cafe
    const preferred =
      pendingCafeFromUrl ||
      (selectedCafe && (selectedCafe.cafeAddress || selectedCafe.address)) ||
      loadSelectedCafeAddress() ||
      (cafes.length === 1 ? cafes[0].cafeAddress || cafes[0].address : null);

    if (preferred) {
      setSelectedCafeByAddress(preferred);
      if (selectedCafe && (selectedCafe.cafeAddress || selectedCafe.address)) {
        el.cafeSelect.value = selectedCafe.cafeAddress || selectedCafe.address;
      }
    }

    // Friendly UX when no cafes exist yet
    try {
      const notice = document.getElementById("noCafesNotice");
      if (notice) notice.style.display = cafes.length ? "none" : "block";
    } catch (e) {}
  }

  async function loadSelectedCafeProfile() {
    selectedCafeProfile = null;

    if (!selectedCafe || !selectedCafe.id) {
      renderSelectedCafeProfile(null);
      return;
    }

    try {
      const data = await apiFetch(
        `/cafes/public/${encodeURIComponent(selectedCafe.id)}`
      );
      const cafeInfo = data && data.cafe ? data.cafe : null;
      selectedCafeProfile = {
        about: cafeInfo && cafeInfo.about ? String(cafeInfo.about) : null,
        logoDataUrl:
          cafeInfo && cafeInfo.logoDataUrl
            ? String(cafeInfo.logoDataUrl)
            : null,
        redeemMessage:
          cafeInfo && cafeInfo.redeemMessage
            ? String(cafeInfo.redeemMessage)
            : null,
      };
      renderSelectedCafeProfile(selectedCafeProfile);
      updateRedeemUi();
    } catch (e) {
      // Non-fatal: still allow stamping/QR if profile fetch fails
      renderSelectedCafeProfile(null);
      updateRedeemUi();
    }
  }

  function renderSelectedCafeProfile(profile) {
    try {
      if (el.cafeLogo) {
        if (profile && profile.logoDataUrl) {
          el.cafeLogo.src = profile.logoDataUrl;
          el.cafeLogo.style.display = "block";
        } else {
          el.cafeLogo.removeAttribute("src");
          el.cafeLogo.style.display = "none";
        }
      }

      if (el.cafeAbout) {
        const txt =
          profile && profile.about ? String(profile.about).trim() : "";
        if (txt) {
          el.cafeAbout.textContent = txt;
          el.cafeAbout.style.display = "block";
        } else {
          el.cafeAbout.textContent = "";
          el.cafeAbout.style.display = "none";
        }
      }
    } catch (e) {}
  }

  function renderStampGrid(count) {
    const totalSlots = 10;
    const n = Math.max(0, Math.min(totalSlots, Number(count || 0)));
    if (el.stampCountBadge)
      el.stampCountBadge.textContent = `${n} / ${totalSlots}`;
    if (!el.stampGrid) return;
    el.stampGrid.innerHTML = "";

    const stampSvgFilled = `
      <svg class="stampIcon" viewBox="0 0 100 100" role="img" aria-hidden="true">
        <defs>
          <filter id="stampNoise" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" stitchTiles="stitch" result="noise" />
            <feColorMatrix type="matrix" values="0 0 0 0 0.95  0 0 0 0 0.90  0 0 0 0 0.86  0 0 0 0.35 0" result="n" />
            <feBlend in="SourceGraphic" in2="n" mode="multiply" />
          </filter>
        </defs>
        <circle cx="50" cy="50" r="44" fill="currentColor" filter="url(#stampNoise)"></circle>
        <circle cx="50" cy="50" r="40" fill="none" stroke="var(--brand-50)" stroke-width="3" opacity="0.9"></circle>
        <!-- coffee bean -->
        <path d="M40 18 C22 34 22 66 40 82" fill="none" stroke="var(--brand-50)" stroke-width="7" stroke-linecap="round"></path>
        <path d="M60 18 C78 34 78 66 60 82" fill="none" stroke="var(--brand-50)" stroke-width="7" stroke-linecap="round"></path>
        <path d="M50 16 C44 34 44 66 50 84" fill="none" stroke="var(--brand-50)" stroke-width="3" stroke-linecap="round" opacity="0.7"></path>
      </svg>
    `.trim();

    const stampSvgEmpty = `
      <svg class="stampIcon" viewBox="0 0 100 100" role="img" aria-hidden="true">
        <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" stroke-width="4" opacity="0.45"></circle>
        <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" stroke-width="2" opacity="0.20"></circle>
        <path d="M40 18 C22 34 22 66 40 82" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" opacity="0.35"></path>
        <path d="M60 18 C78 34 78 66 60 82" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" opacity="0.35"></path>
        <path d="M50 16 C44 34 44 66 50 84" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity="0.25"></path>
      </svg>
    `.trim();

    for (let i = 0; i < totalSlots; i++) {
      const cell = document.createElement("div");
      const isFilled = i < n;
      cell.className = "stamp" + (isFilled ? " filled" : " empty");
      cell.innerHTML = isFilled ? stampSvgFilled : stampSvgEmpty;
      cell.setAttribute(
        "aria-label",
        isFilled ? `Stempel ${i + 1} (gesetzt)` : `Stempel ${i + 1} (leer)`
      );

      cell.addEventListener("click", (ev) => {
        try {
          ev.stopPropagation();
        } catch (e) {}
        if (!session) return;
        setMainMode("history");
        refreshHistory();
      });
      el.stampGrid.appendChild(cell);
    }
  }

  async function refreshStamps() {
    if (!session || !selectedCafe) {
      currentStampCount = 0;
      renderStampGrid(0);
      return 0;
    }
    const addr = encodeURIComponent(session.address);
    const cafeId = selectedCafe.cafeAddress || "";
    if (!cafeId) {
      currentStampCount = 0;
      renderStampGrid(0);
      updateRedeemUi();
      return 0;
    }
    const cafe = encodeURIComponent(cafeId);
    const data = await apiFetch(`/stamps/${addr}?fallback=1&cafe=${cafe}`);
    const stamps = data && (data.stamps ?? data.count ?? 0);
    const n = Math.max(0, Number(stamps || 0));
    currentStampCount = Number.isFinite(n) ? n : 0;
    renderStampGrid(currentStampCount);
    updateRedeemUi();
    return currentStampCount;
  }

  async function refreshAfterLiveEvent() {
    try {
      const before = currentStampCount;
      const after = await refreshStamps();
      if (before < REWARD_THRESHOLD && after >= REWARD_THRESHOLD) {
        maybeShowFullCardToast(after);
      }
    } catch (e) {}

    try {
      await loadSelectedCafeProfile();
    } catch (e) {}

    try {
      await refreshHistory();
    } catch (e) {}
  }

  function stopEventStream() {
    if (!sse) return;
    try {
      sse.close();
    } catch (e) {}
    sse = null;
  }

  function startEventStream() {
    if (sse) return;
    if (!session || !session.address) return;
    if (typeof EventSource === "undefined") return;

    const url = `${apiBase}/events/stream`;
    try {
      sse = new EventSource(url);
    } catch (e) {
      sse = null;
      return;
    }

    sse.onmessage = (msg) => {
      if (!msg || !msg.data) return;
      let ev;
      try {
        ev = JSON.parse(msg.data);
      } catch (e) {
        return;
      }

      const myAddr = session ? normalizeAddr(session.address) : "";
      const evUser = normalizeAddr(ev && ev.user);
      if (!myAddr || !evUser || evUser !== myAddr) return;

      const cafeFilter = selectedCafe
        ? normalizeAddr(selectedCafe.cafeAddress)
        : "";
      const evCafe = normalizeAddr(ev && ev.cafe);
      if (cafeFilter && evCafe && evCafe !== cafeFilter) return;

      const delta = Number(ev && ev.delta != null ? ev.delta : 0);
      const typ = String((ev && ev.event_type) || "").toLowerCase();
      const status = String((ev && ev.status) || "").toLowerCase();
      const cafeName = cafeNameByAddress(ev && ev.cafe);

      if (typ === "stamp") {
        const d = Number.isFinite(delta) ? delta : 1;
        showToast(
          "success",
          `Stempel erhalten: +${Math.max(1, d)}\n${cafeName}`
        );
        void refreshAfterLiveEvent();
      } else if (typ === "redeem") {
        if (status === "failed") {
          showToast("danger", `Einlösung fehlgeschlagen\n${cafeName}`);
        } else if (status === "submitted") {
          showToast("info", `Einlösung gesendet\n${cafeName}`);
        } else {
          showToast(
            "success",
            `🎁 Eingelöst!\n${cafeName}\nLass dir dein Getränk schenken.`,
            4200
          );
        }
        void refreshAfterLiveEvent();
      }
    };

    sse.onerror = () => {
      // Let EventSource auto-reconnect; no UI noise.
    };
  }

  function setSelectedCafeByAddress(address) {
    const wanted = String(address || "").toLowerCase();
    const match = cafes.find(
      (c) =>
        (c.cafeAddress && c.cafeAddress.toLowerCase() === wanted) ||
        (c.address && c.address.toLowerCase() === wanted)
    );
    selectedCafe = match || null;
    selectedCafeProfile = null;

    // Reset QR mode on cafe switch
    qrMode = "stamp";
    if (el.qrModeStamp) el.qrModeStamp.classList.add("active");
    if (el.qrModeRedeem) el.qrModeRedeem.classList.remove("active");

    if (selectedCafe && (selectedCafe.cafeAddress || selectedCafe.address)) {
      saveSelectedCafeAddress(selectedCafe.cafeAddress || selectedCafe.address);
      try {
        if (el.cafeSelect)
          el.cafeSelect.value =
            selectedCafe.cafeAddress || selectedCafe.address;
      } catch (e) {}
    }

    if (el.cafeTitle)
      el.cafeTitle.textContent = selectedCafe
        ? selectedCafe.name
        : "Wähle ein Café";
    if (el.qrCafeBadge)
      el.qrCafeBadge.textContent = selectedCafe ? selectedCafe.name : "Café";

    // Render whatever we already have (may be null), then load full profile
    renderSelectedCafeProfile(
      selectedCafe
        ? {
            about: selectedCafe.about || null,
            logoDataUrl: null,
            redeemMessage: null,
          }
        : null
    );

    refreshHistory();
    updateRedeemUi();
  }

  function getQrAppsBase() {
    const protocol =
      location.protocol === "http:" || location.protocol === "https:"
        ? location.protocol
        : "http:";

    let hostname = location.hostname || "localhost";
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1";
    if (isLocalhost) {
      try {
        const lanIp = String(localStorage.getItem("lanIp") || "").trim();
        if (lanIp) hostname = lanIp;
      } catch (e) {}
    }

    // Prefer the current port (when served via apps server), otherwise default.
    const port = location.port ? String(location.port) : "8080";
    return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
  }

  async function ensureLanIpForQr() {
    try {
      let hostname = location.hostname || "localhost";
      const isLocalhost =
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1";
      if (!isLocalhost) return;

      const existing = String(localStorage.getItem("lanIp") || "").trim();

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1500);
      const resp = await fetch("/__lanip", {
        cache: "no-store",
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(t);
      if (!resp || !resp.ok) return;
      const data = await resp.json().catch(() => null);
      const ip = data && data.ip ? String(data.ip).trim() : "";
      if (ip && ip !== existing) localStorage.setItem("lanIp", ip);
    } catch (e) {}
  }

  function buildCafeBoundLink() {
    if (!session || !selectedCafe) return null;
    const cafeScannerUrl = `${getQrAppsBase()}/cafe-scanner-new.html`;
    const u = new URL(cafeScannerUrl);
    u.searchParams.set("customer", session.address);
    u.searchParams.set("customerName", session.username || "");
    // IMPORTANT: `cafe` must be the café identifier (0x...), not the physical address.
    if (selectedCafe.cafeAddress) {
      u.searchParams.set("cafe", selectedCafe.cafeAddress);
    }
    return u.toString();
  }

  function buildRedeemLink() {
    if (!session || !selectedCafe) return null;
    const cafeScannerUrl = `${getQrAppsBase()}/cafe-scanner-new.html`;
    const u = new URL(cafeScannerUrl);
    u.searchParams.set("customer", session.address);
    u.searchParams.set("customerName", session.username || "");
    // IMPORTANT: `cafe` must be the café identifier (0x...), not the physical address.
    if (selectedCafe.cafeAddress) {
      u.searchParams.set("cafe", selectedCafe.cafeAddress);
    }
    u.searchParams.set("action", "redeem");

    // Single-use redeem token (one QR => one redeem attempt)
    try {
      const cafeAddr = selectedCafe.cafeAddress || selectedCafe.address || "";
      const userAddr = session.address || "";
      const key = `${String(userAddr).toLowerCase()}|${String(
        cafeAddr
      ).toLowerCase()}`;
      if (!activeRedeemToken || activeRedeemTokenKey !== key) {
        const bytes = new Uint8Array(16);
        (window.crypto || crypto).getRandomValues(bytes);
        activeRedeemToken = Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        activeRedeemTokenKey = key;
      }
      u.searchParams.set("rt", activeRedeemToken);
    } catch (e) {
      // If crypto isn't available, the server will fall back to stamp-balance checks.
    }
    return u.toString();
  }

  async function renderQR() {
    if (!el.qrCanvas) return;
    const qrBox = document.querySelector(".qrBox");
    const full = currentStampCount >= REWARD_THRESHOLD;

    await ensureLanIpForQr();

    const link =
      full && qrMode === "redeem" ? buildRedeemLink() : buildCafeBoundLink();
    if (!link) {
      // clear canvas
      const ctx = el.qrCanvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, el.qrCanvas.width, el.qrCanvas.height);
      if (el.qrHint)
        el.qrHint.textContent = "Wähle ein Café, um den QR-Code zu erzeugen.";
      return;
    }
    if (typeof QRCode === "undefined") {
      if (el.qrHint)
        el.qrHint.textContent = "QR library fehlt. /vendor/qrcode.min.js";
      return;
    }

    if (el.qrTitle) {
      el.qrTitle.textContent =
        full && qrMode === "redeem" ? "QR zum Einlösen" : "QR für den Barista";
    }

    if (el.qrHint) {
      el.qrHint.textContent =
        full && qrMode === "redeem"
          ? "Zeige diesen QR im ausgewählten Café, um die Belohnung einzulösen."
          : "Zeige diesen QR dem Barista im ausgewählten Café.";
    }

    // Ensure crisp rendering at a size that fits the card
    let size = 240;
    try {
      const available = qrBox ? qrBox.clientWidth : 0;
      // Subtract a bit for padding/border
      const fitted = available ? Math.floor(available - 32) : 0;
      size = Math.max(180, Math.min(260, fitted || 240));
    } catch (e) {}

    el.qrCanvas.width = size;
    el.qrCanvas.height = size;
    await QRCode.toCanvas(el.qrCanvas, link, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
    });
  }

  function setupFlip() {
    if (!el.flipCard) return;
    el.flipCard.addEventListener("click", async () => {
      el.flipCard.classList.toggle("flipped");
      // generate fresh QR if needed
      try {
        await renderQR();
      } catch (e) {}
    });
  }

  function setupHistory() {
    if (el.historyCloseBtn) {
      el.historyCloseBtn.addEventListener("click", () => {
        setHistoryOpen(false);
      });
    }

    if (el.walletCloseBtn) {
      el.walletCloseBtn.addEventListener("click", () => {
        setMainMode("card");
      });
    }
  }

  async function handleAuth() {
    clearMsg();
    clearCreds();
    const email = (el.email && el.email.value ? el.email.value : "").trim();
    const username = (
      el.username && el.username.value ? el.username.value : ""
    ).trim();
    const password =
      el.password && el.password.value ? String(el.password.value) : "";
    const confirmPassword =
      el.confirmPassword && el.confirmPassword.value
        ? String(el.confirmPassword.value)
        : "";

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      showMsg("danger", "Bitte eine gültige E-Mail eingeben.");
      return;
    }
    if (!password || password.length < 6) {
      showMsg("danger", "Passwort muss mindestens 6 Zeichen haben.");
      return;
    }

    try {
      if (mode === "register") {
        if (!username || username.length < 2) {
          showMsg("danger", "Bitte einen Username eingeben.");
          return;
        }
        if (password !== confirmPassword) {
          showMsg("danger", "Passwörter stimmen nicht überein.");
          return;
        }
        const data = await apiFetch("/customers/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, email, password }),
        });
        if (!data || !data.address) throw new Error("Registration failed");
        saveSession({
          customer_id: data.customer_id,
          username: data.username || username,
          email: data.email || email,
          address: data.address,
        });

        // Show account info once
        showCreds({
          customer_id: data.customer_id,
          username: data.username || username,
          email: data.email || email,
          address: data.address,
        });
      } else {
        const data = await apiFetch("/customers/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        saveSession({
          customer_id: data.customer_id,
          username: data.username || null,
          email: data.email || email,
          address: data.address,
        });
      }

      setAuthedUI();
      await loadCafes();
      await refreshStamps();
      await renderQR();
      startEventStream();
    } catch (e) {
      showMsg("danger", e && e.message ? e.message : "Fehler");
    }
  }

  function wireEvents() {
    if (el.modeRegister)
      el.modeRegister.addEventListener("click", () => setMode("register"));
    if (el.modeLogin)
      el.modeLogin.addEventListener("click", () => setMode("login"));
    if (el.authSubmit) el.authSubmit.addEventListener("click", handleAuth);
    if (el.logoutBtn)
      el.logoutBtn.addEventListener("click", () => {
        stopEventStream();
        clearSession();
        setAuthedUI();
        setMode("register");
        setMainMode("card");
      });

    if (el.mainModeCard)
      el.mainModeCard.addEventListener("click", (ev) => {
        try {
          ev.stopPropagation();
        } catch (e) {}
        setMainMode("card");
      });
    if (el.mainModeWallet)
      el.mainModeWallet.addEventListener("click", async (ev) => {
        try {
          ev.stopPropagation();
        } catch (e) {}
        setMainMode("wallet");
        await refreshHistory();
      });
    if (el.mainModeHistory)
      el.mainModeHistory.addEventListener("click", async (ev) => {
        try {
          ev.stopPropagation();
        } catch (e) {}
        setMainMode("history");
        await refreshHistory();
      });

    if (el.cafeSelect)
      el.cafeSelect.addEventListener("change", async () => {
        setSelectedCafeByAddress(el.cafeSelect.value);
        await loadSelectedCafeProfile();
        await refreshStamps();
        await renderQR();
      });

    if (el.showRedeemQrBtn)
      el.showRedeemQrBtn.addEventListener("click", async (ev) => {
        try {
          ev.stopPropagation();
        } catch (e) {}
        if (!el.flipCard) return;
        if (currentStampCount < REWARD_THRESHOLD) return;
        setQrMode("redeem");
        el.flipCard.classList.add("flipped");
        try {
          await renderQR();
        } catch (e) {}
      });

    if (el.qrModeStamp)
      el.qrModeStamp.addEventListener("click", (ev) => {
        try {
          ev.stopPropagation();
        } catch (e) {}
        setQrMode("stamp");
      });
    if (el.qrModeRedeem)
      el.qrModeRedeem.addEventListener("click", (ev) => {
        try {
          ev.stopPropagation();
        } catch (e) {}
        if (currentStampCount < REWARD_THRESHOLD) return;
        setQrMode("redeem");
      });
  }

  async function boot() {
    setBuildBadge();
    setMainMode("card");
    setupFlip();
    setupHistory();
    wireEvents();
    setMode("register");

    // Capture cafe preselect from URL early (before loadCafes)
    try {
      const params = new URLSearchParams(location.search);
      const cafeAddr = params.get("cafe");
      pendingCafeFromUrl = cafeAddr ? String(cafeAddr) : null;
    } catch (e) {
      pendingCafeFromUrl = null;
    }

    session = loadSession();
    setAuthedUI();

    if (session) {
      try {
        await loadCafes();
        await loadSelectedCafeProfile();
      } catch (e) {
        // If API isn't reachable, allow UI to load; user can refresh after fixing
      }
    }

    // URL-based preference has been applied; clear it so future reloads use persisted selection.
    pendingCafeFromUrl = null;

    if (session) {
      try {
        await refreshStamps();
        await renderQR();
        startEventStream();
      } catch (e) {}
    } else {
      renderStampGrid(0);
    }
  }

  boot();
})();
*/
