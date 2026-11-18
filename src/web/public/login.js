const passwordInput = document.getElementById("password");
const toggleBtn = document.getElementById("toggle-password");
const errorEl = document.getElementById("login-error");

if (new URLSearchParams(location.search).get("expired")) {
  errorEl.textContent = "Your session expired. Please log in again.";
  errorEl.hidden = false;
}

toggleBtn?.addEventListener("click", () => {
  const isHidden = passwordInput.type === "password";
  passwordInput.type = isHidden ? "text" : "password";
  toggleBtn.textContent = isHidden ? "🙈" : "👁";
  toggleBtn.title = isHidden ? "Hide password" : "Show password";
  toggleBtn.setAttribute("aria-pressed", String(isHidden));
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const password = passwordInput.value;
  const btn = e.target.querySelector(".login-btn");

  btn.disabled = true;
  btn.textContent = "Logging in...";
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
    btn.textContent = "Login";
  }
});
