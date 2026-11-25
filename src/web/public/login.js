const passwordInput = document.getElementById("password");
const toggleBtn = document.getElementById("toggle-password");
const errorEl = document.getElementById("login-error");

if (new URLSearchParams(location.search).get("expired")) {
  errorEl.textContent = "Your session expired. Please log in again.";
  errorEl.hidden = false;
}

const EYE_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.1 6.1A16 16 0 0 0 2 12s3.5 7 10 7c1.2 0 2.3-.2 3.3-.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

toggleBtn?.addEventListener("click", () => {
  const isHidden = passwordInput.type === "password";
  passwordInput.type = isHidden ? "text" : "password";
  toggleBtn.innerHTML = isHidden ? EYE_OFF : EYE_ON;
  toggleBtn.title = isHidden ? "Hide password" : "Show password";
  toggleBtn.setAttribute("aria-label", toggleBtn.title);
  toggleBtn.setAttribute("aria-pressed", String(isHidden));
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
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
