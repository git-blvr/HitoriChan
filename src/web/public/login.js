const passwordInput = document.getElementById("password");
const toggleBtn = document.getElementById("toggle-password");

toggleBtn?.addEventListener("click", () => {
  const isHidden = passwordInput.type === "password";
  passwordInput.type = isHidden ? "text" : "password";
  toggleBtn.textContent = isHidden ? "🙈" : "👁";
  toggleBtn.title = isHidden ? "Hide password" : "Show password";
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value;
  const password = passwordInput.value;
  const errorEl = document.getElementById("login-error");
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
