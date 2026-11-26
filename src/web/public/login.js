const passwordInput = document.getElementById("password");
const toggleBtn = document.getElementById("toggle-password");
const errorEl = document.getElementById("login-error");
const discordBtn = document.getElementById("discord-login");
const discordNote = document.getElementById("discord-note");
const oauthOff = document.getElementById("oauth-off");
const loginForm = document.getElementById("login-form");

const ERROR_MESSAGES = {
  expired: "Your session expired. Please log in again.",
  no_guilds: "No manageable servers found. You must own or manage a server that has the bot.",
  oauth: "Discord sign-in failed. Please try again.",
  state: "Sign-in session expired. Please try again.",
  oauth_disabled: "Discord sign-in is not configured on this dashboard.",
};

const params = new URLSearchParams(location.search);
const errorCode = params.get("expired") ? "expired" : params.get("error");
if (errorEl && errorCode && ERROR_MESSAGES[errorCode]) {
  errorEl.textContent = ERROR_MESSAGES[errorCode];
  errorEl.hidden = false;
}

// Main page only — the Discord button always renders; when OAuth isn't
// configured it gets disabled and a note explains why.
if (discordBtn) {
  const oauthUnavailable = () => {
    discordBtn.classList.add("disabled");
    discordBtn.setAttribute("aria-disabled", "true");
    discordBtn.removeAttribute("href");
    if (oauthOff) oauthOff.hidden = false;
  };
  fetch("/auth/config")
    .then((res) => (res.ok ? res.json() : { oauth: false }))
    .then((cfg) => {
      if (cfg.oauth) {
        if (discordNote) discordNote.hidden = false;
      } else {
        oauthUnavailable();
      }
    })
    .catch(oauthUnavailable);
}

const EYE_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.1 6.1A16 16 0 0 0 2 12s3.5 7 10 7c1.2 0 2.3-.2 3.3-.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

if (toggleBtn && passwordInput) {
  toggleBtn.addEventListener("click", () => {
    const isHidden = passwordInput.type === "password";
    passwordInput.type = isHidden ? "text" : "password";
    toggleBtn.innerHTML = isHidden ? EYE_OFF : EYE_ON;
    toggleBtn.title = isHidden ? "Hide password" : "Show password";
    toggleBtn.setAttribute("aria-label", toggleBtn.title);
    toggleBtn.setAttribute("aria-pressed", String(isHidden));
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    const password = passwordInput.value;
    const btn = e.target.querySelector(".login-btn");

    btn.disabled = true;
    btn.textContent = "Signing in…";
    errorEl.hidden = true;

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        window.location.href = "/dashboard";
      } else {
        const data = await res.json().catch(() => ({}));
        errorEl.textContent = data.error || "Invalid credentials";
        errorEl.hidden = false;
      }
    } catch {
      errorEl.textContent = "Could not reach the server";
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  });
}
