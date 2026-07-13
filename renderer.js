// Home-screen click handling.
//
// Tile <a> elements are routed as follows:
//   - external http(s) links  → window.kiosk.openURL  (controlled browser)
//   - the .poweroff link      → open the shutdown confirmation modal
//   - "#" placeholders        → silently no-op (so they don't jump to top)
//   - internal links (e.g. resources.html) → normal navigation

// The main process also intercepts navigation as a safety net.
(function () {
  function showShutdownModal() {
    if (window.jQuery) window.jQuery("#shutdownModal").modal("show");
  }

  function wire(a) {
    // Power-off icon → confirmation modal.
    if (a.closest(".poweroff")) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        showShutdownModal();
      });
      return;
    }

    const href = a.getAttribute("href") || "";

    // Local PDF link (e.g. ./assets/user-guide.pdf) → open in the controlled
    // browser via the same IPC the sector-PDF submenu uses. Main's open-doc
    // handler normalizes the path against APP_ROOT.
    if (/\.pdf$/i.test(href) && !/^https?:\/\//i.test(href)) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        if (window.kiosk) window.kiosk.openDoc(href);
      });
      return;
    }

    if (/^https?:\/\//i.test(href)) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        if (window.kiosk) window.kiosk.openURL(href);
      });
    } else if (href === "#" || href === "") {
      a.addEventListener("click", function (e) {
        e.preventDefault();
      });
    }
    // Internal links such as resources.html fall through to normal navigation.
  }

  function hideShutdownModal() {
    if (window.jQuery) window.jQuery("#shutdownModal").modal("hide");
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("a").forEach(wire);

    const modal = document.getElementById("shutdownModal");
    if (!modal) return;

    // Wire the modal's "Yes" button → tell the main process to shutdown.
    const confirm = modal.querySelector("#confirmShutdownBtn");
    if (confirm) {
      confirm.addEventListener("click", function () {
        if (window.kiosk && window.kiosk.shutdown) window.kiosk.shutdown();
      });
    }

    // Explicitly wire every dismiss control inside the modal (the × close button
    // and the "No" button). Belt-and-suspenders for Bootstrap's data-api, which
    // sometimes doesn't fire reliably depending on stacking / pointer-events.
    modal.querySelectorAll('[data-dismiss="modal"]').forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        hideShutdownModal();
      });
    });

    // Click on the dark backdrop area (outside .modal-dialog) also closes it.
    modal.addEventListener("click", function (e) {
      if (e.target === modal) hideShutdownModal();
    });

    // --- Feedback dropdown menu (top-right icon) -----------------------------
    // The Feedback icon toggles a small two-item menu: "Feedback" opens the
    // feedback URL (via the standard wire() path since it's an http link) and
    // "Contact Support" opens the contact modal below.
    const fbTrigger = document.getElementById("openFeedbackMenu");
    const fbMenu = document.getElementById("feedbackMenu");
    if (fbTrigger && fbMenu) {
      const closeMenu = function () {
        fbMenu.classList.remove("show");
        fbTrigger.setAttribute("aria-expanded", "false");
      };
      fbTrigger.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation(); // don't let the outside-click handler close us
        const willShow = !fbMenu.classList.contains("show");
        fbMenu.classList.toggle("show", willShow);
        fbTrigger.setAttribute("aria-expanded", willShow ? "true" : "false");
      });
      // Click outside → close.
      document.addEventListener("click", function (e) {
        if (!fbMenu.classList.contains("show")) return;
        if (fbMenu.contains(e.target) || fbTrigger.contains(e.target)) return;
        closeMenu();
      });
      // Any menu-item click → close (whichever action then runs).
      fbMenu.querySelectorAll(".feedback-menu-item").forEach(function (item) {
        item.addEventListener("click", closeMenu);
      });
    }

    // --- Contact Support modal ----------------------------------------------
    const contactModal = document.getElementById("contactModal");
    const contactTrigger = document.getElementById("openContactModal");
    if (contactTrigger) {
      contactTrigger.addEventListener("click", function (e) {
        e.preventDefault();
        if (window.jQuery) window.jQuery("#contactModal").modal("show");
      });
    }
    if (contactModal) {
      const hideContact = function () {
        if (window.jQuery) window.jQuery("#contactModal").modal("hide");
      };
      contactModal.querySelectorAll('[data-dismiss="modal"]').forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          hideContact();
        });
      });
      contactModal.addEventListener("click", function (e) {
        if (e.target === contactModal) hideContact();
      });
    }
  });

  const desktopBtn = document.getElementById("showDesktopBtn");
  desktopBtn.addEventListener("click", (e) => {
    window.kiosk.showDesktopBtn();
  });

  const bhasiniSmritinLogo = document.getElementById("openBhasiniSmritiLogo");
  bhasiniSmritinLogo.addEventListener("click", (e) => {
    window.kiosk.openBhasiniSmritiExe();
  });

  // Toggle the launch loader overlay in response to main-process signals.
  // Main sends `true` right before spawning SMRITI_V3.exe and `false` when
  // its window appears (or on timeout / spawn failure).
  if (window.kiosk && window.kiosk.onBhasiniLoading) {
    const loader = document.getElementById("bhasiniLoader");
    if (loader) {
      window.kiosk.onBhasiniLoading(function (isLoading) {
        loader.classList.toggle("show", !!isLoading);
      });
    }
  }

  // Auto-update notice. Main streams status as updates are checked/downloaded.
  // We only surface the "ready" state to the screen — a maintainer applies it
  // with Ctrl+Alt+Shift+U. Other states are kept quiet so the kiosk face stays
  // clean for the public.
  if (window.kiosk && window.kiosk.onUpdateStatus) {
    const toast = document.getElementById("updateToast");
    const toastText = document.getElementById("updateToastText");
    if (toast && toastText) {
      window.kiosk.onUpdateStatus(function (status) {
        if (status && status.state === "ready") {
          toastText.textContent =
            "Update " +
            (status.version ? "v" + status.version + " " : "") +
            "ready — press Ctrl+Alt+Shift+U to install";
          toast.classList.add("show");
        } else if (status && status.state === "error") {
          toast.classList.remove("show");
        }
      });
    }
  }
})();
